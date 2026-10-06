"""
Fleet state + read models for the API.

Loads the synthetic floor (100 racks / 800 servers / 4,000 components),
telemetry, event log, 12-month incident history and spare-parts inventory
once, scores the whole fleet, and derives the aggregated views each
dashboard page needs. Every public method returns JSON-ready data.
"""
from __future__ import annotations

import json
import threading
from pathlib import Path

import numpy as np
import pandas as pd

from .agent.recommend import RecommendationAgent
from .knowledge.graph import FaultKnowledgeGraph
from .knowledge.retrieval import HybridRetriever
from .ml.features import COMPONENT_CHANNELS
from .ml.predict import score_fleet

REPO = Path(__file__).resolve().parents[2]
SYN, KB, INV = REPO / "data" / "synthetic", REPO / "data" / "kb", REPO / "data" / "inventory"
COMPONENTS = list(COMPONENT_CHANNELS)
CONTEXT_BOOST = {"dr_failover": 2.0, "migration": 1.5, "backup_window": 1.0, "maintenance_window": 0.0, "normal": 0.0}
TIER_ORDER = {"healthy": 0, "watch": 1, "warning": 2, "critical": 3}
PART_FAMILY = {"dimm": "memory", "disk_ssd": "storage", "disk_hdd": "storage", "psu": "power", "fan": "cooling",
               "nic": "network", "sfp": "network", "cable": "network"}


def records(df: pd.DataFrame) -> list[dict]:
    return json.loads(df.to_json(orient="records", date_format="iso"))


def r2(x, n=2):
    return None if x is None or (isinstance(x, float) and np.isnan(x)) else round(float(x), n)


class Fleet:
    def __init__(self):
        self.racks = pd.read_csv(SYN / "racks.csv")
        self.servers = pd.read_csv(SYN / "servers.csv")
        self.assets = pd.read_csv(SYN / "assets.csv")
        self.context = pd.read_csv(SYN / "operational_context.csv")
        self.facility = pd.read_csv(SYN / "facility_daily.csv")
        self.events = pd.read_parquet(SYN / "events.parquet")
        self.tel = {c: pd.read_parquet(SYN / "telemetry" / f"{c}.parquet") for c in COMPONENTS}
        self.srv_tel = pd.read_parquet(SYN / "telemetry" / "servers.parquet")
        self.incidents = pd.read_csv(KB / "incidents.csv", parse_dates=["opened_at", "resolved_at"])
        self.templates = pd.read_csv(KB / "templates.csv").set_index("template_id")
        self.skus = pd.read_csv(INV / "skus.csv")
        self.tx = pd.read_csv(INV / "transactions.csv")
        self.stock_daily = pd.read_csv(INV / "stock_daily.csv")
        eval_path = SYN / "_eval_current_degradation.csv"
        self.eval = pd.read_csv(eval_path) if eval_path.exists() else None

        self.state_of = dict(zip(self.context.rack_id, self.context.operational_state))
        self.scores, self.ai = score_fleet(self.tel)
        self._derive()

        g = self.incidents.groupby("template_id")
        self.fix_stats = pd.DataFrame({"n": g.size(), "durable_rate": g.outcome.apply(lambda s: (s == "resolved").mean()),
                                       "median_mttr_h": g.mttr_h.median(), "median_downtime_min": g.downtime_min.median(),
                                       "last_used": g.opened_at.max()})
        self.retriever = HybridRetriever.from_jsonl(durable_rate=self.fix_stats.durable_rate.to_dict())
        self.graph = FaultKnowledgeGraph.from_jsonl()
        self.agent = RecommendationAgent(self.retriever, self.graph, self.fix_stats, self.part_for)
        self._inventory()

    # ------------------------------------------------------------ derivation
    def _derive(self):
        a = self.assets.set_index("asset_id").join(self.scores[["risk_score", "tier", "anomaly_z", "health_index", "top_factors"]])
        a["state"] = a.rack_id.map(self.state_of)
        self.asset_view = a
        latest = self.srv_tel[self.srv_tel.timestamp == self.srv_tel.timestamp.max()].copy()
        latest["server_id"] = latest.server_id.astype(str)
        latest = latest.set_index("server_id").drop(columns=["timestamp"])
        piv = a.pivot_table(index="server_id", columns="component", values="risk_score")
        worst_idx = a.groupby("server_id")["risk_score"].idxmax()
        s = self.servers.set_index("server_id").join(latest)
        s = s.join(piv.add_prefix("risk_"))
        s["max_risk"] = piv.max(axis=1)
        s["worst_asset"] = worst_idx
        s["worst_component"] = s.worst_asset.map(a.component)
        s["n_at_risk"] = (a.risk_score >= 0.5).groupby(a.server_id).sum()
        a["tier_rank"] = a.tier.map(TIER_ORDER)
        tier_piv = a.pivot_table(index="server_id", columns="component", values="tier_rank")
        s = s.join(tier_piv.add_prefix("tier_"))
        rank_to_tier = {v: k for k, v in TIER_ORDER.items()}
        s["status"] = tier_piv.max(axis=1).map(rank_to_tier)
        s["health_index"] = a.groupby("server_id").health_index.min()
        s["state"] = s.rack_id.map(self.state_of)
        s["crit_score"] = s.criticality + s.state.map(CONTEXT_BOOST)
        self.server_now = s

        r = s.groupby("rack_id").agg(power_kw=("power_w", lambda x: x.sum() / 1000), avg_inlet=("inlet_temp_c", "mean"),
                                     max_inlet=("inlet_temp_c", "max"), max_risk=("max_risk", "max"),
                                     n_crit=("status", lambda x: (x == "critical").sum()),
                                     n_warn=("status", lambda x: (x == "warning").sum()),
                                     n_watch=("status", lambda x: (x == "watch").sum()), avg_cpu=("cpu_util_pct", "mean"))
        r = self.racks.set_index("rack_id").join(r)
        r["status"] = s.groupby("rack_id").status.agg(lambda x: max(x, key=TIER_ORDER.get))
        r["state"] = r.index.map(self.state_of)
        self.rack_now = r

    def part_for(self, template_id: str, asset_id: str) -> dict | None:
        if template_id not in self.templates.index or asset_id not in self.asset_view.index:
            return None
        part = self.templates.loc[template_id, "part"]
        if not isinstance(part, str):
            return None
        srv = self.asset_view.loc[asset_id, "server_id"]
        if part in COMPONENTS:
            sku = self.assets[(self.assets.server_id == srv) & (self.assets.component == part)].sku.iloc[0]
        else:
            tier = "ai" if self.asset_view.loc[asset_id, "workload"] == "ai" else "std"
            m = self.skus[(self.skus.part == part) & self.skus.fit.isin([tier, "any"])]
            if m.empty:
                return None
            sku = m.sku.iloc[0]
        return self.sku_card(sku, int(self.templates.loc[template_id, "qty"]))

    def sku_card(self, sku: str, qty: int = 1) -> dict | None:
        if not hasattr(self, "inv") or sku not in self.inv.index:
            return {"sku": sku, "qty": qty}
        i = self.inv.loc[sku]
        return dict(sku=sku, qty=qty, desc=i.desc, on_hand=int(i.on_hand), inbound_qty=int(i.inbound_qty),
                    next_arrival=i.next_arrival if isinstance(i.next_arrival, str) else None, status=i.status,
                    bin=i.bin, lead_time_days=int(i.lead_time_days), predicted_demand=r2(i.ml_demand, 1))

    def _inventory(self):
        inv = self.skus.set_index("sku").copy()
        avg = self.stock_daily.groupby("sku").on_hand.mean()
        inv["avg_on_hand"] = avg
        inv["daily_rate"] = inv.issued_12m / 365
        inv["turns"] = inv.issued_12m / inv.avg_on_hand.clip(lower=0.5)
        inv["turn_cycle_days"] = 365 / inv.turns.clip(lower=0.01)
        inv["days_of_cover"] = inv.on_hand / inv.daily_rate.clip(lower=1e-3)
        at_risk = self.asset_view[self.asset_view.risk_score >= 0.25]
        inv["ml_demand"] = at_risk.groupby("sku").risk_score.sum()
        inv["n_at_risk"] = (at_risk.risk_score >= 0.5).groupby(at_risk.sku).sum()
        inv[["ml_demand", "n_at_risk"]] = inv[["ml_demand", "n_at_risk"]].fillna(0)
        inv["baseline_30d"] = inv.daily_rate * 30
        arr = pd.to_datetime(inv.next_arrival, errors="coerce")
        now = pd.to_datetime(self.facility.date.max())
        inbound_30 = np.where(arr.notna() & (arr <= now + pd.Timedelta(days=30)), inv.inbound_qty, 0)
        inv["projected_30d"] = inv.on_hand + inbound_30 - inv.ml_demand - inv.baseline_30d
        inv["value_usd"] = inv.on_hand * inv.unit_cost
        need_now = np.ceil(inv.ml_demand.round(2))

        def status(row, need):
            if row.on_hand < need:
                return "stockout_risk"
            if row.on_hand + row.inbound_qty - row.ml_demand <= row.reorder_point:
                return "reorder"
            if row.days_of_cover > 240:
                return "overstock"
            return "healthy"
        inv["status"] = [status(row, need_now[k]) for k, row in inv.iterrows()]
        inv["family"] = inv.part.map(PART_FAMILY)
        self.inv = inv

    # ------------------------------------------------------------ views
    def overview(self) -> dict:
        s, fac = self.server_now, self.facility
        comp_tiers = self.scores.tier.value_counts().to_dict()
        srv_tiers = s.status.value_counts().to_dict()
        n = len(s)
        health = 100 * (1 - (srv_tiers.get("critical", 0) + 0.6 * srv_tiers.get("warning", 0) + 0.25 * srv_tiers.get("watch", 0)) / n)
        last30 = self.incidents[self.incidents.opened_at >= self.incidents.opened_at.max() - pd.Timedelta(days=30)]
        daily_inc = self.incidents.set_index("opened_at").resample("D").size().tail(30)
        it_kw = float(s.power_w.sum() / 1000)
        return dict(
            counts=dict(racks=len(self.racks), servers=n, components=len(self.assets)),
            component_tiers={k: int(comp_tiers.get(k, 0)) for k in TIER_ORDER},
            server_tiers={k: int(srv_tiers.get(k, 0)) for k in TIER_ORDER},
            health_score=round(health, 1),
            alerts=int((self.scores.risk_score >= 0.5).sum()), critical=int((self.scores.risk_score >= 0.75).sum()),
            it_power_kw=round(it_kw, 1), capacity_kw=float(self.racks.pdu_capacity_kw.sum()),
            pue=r2(fac.pue.iloc[-1], 3), facility_power_kw=round(it_kw * float(fac.pue.iloc[-1]), 1),
            avg_inlet_c=r2(s.inlet_temp_c.mean()), max_inlet_c=r2(s.inlet_temp_c.max()),
            hot_racks=int((self.rack_now.max_inlet > 27).sum()), avg_cpu_pct=r2(s.cpu_util_pct.mean(), 1),
            net_gbps=r2(s.net_throughput_gbps.sum(), 1), avg_packet_loss_pct=r2(s.packet_loss_pct.mean(), 4),
            sensitive_racks=int((self.context.operational_state != "normal").sum()),
            incidents_30d=int(len(last30)), mttr_30d_h=r2(last30.mttr_h.median()),
            sla_breaches_30d=int(last30.sla_breached.sum()),
            stock=dict(stockout_risk=int((self.inv.status == "stockout_risk").sum()), reorder=int((self.inv.status == "reorder").sum()),
                       value_usd=round(float(self.inv.value_usd.sum())), skus=len(self.inv)),
            model_auc_mean=round(float(np.mean([v["test_auc"] for v in self.ai.values()])), 4),
            spark=dict(dates=fac.date.tail(30).tolist(), it_power_kw=fac.it_power_kw.tail(30).round(1).tolist(),
                       pue=fac.pue.tail(30).round(3).tolist(), avg_inlet_c=fac.avg_inlet_c.tail(30).round(2).tolist(),
                       incidents=daily_inc.astype(int).tolist()),
            as_of=str(self.srv_tel.timestamp.max()),
        )

    def floor(self) -> dict:
        s = self.server_now.reset_index()
        slots = {}
        for _, x in s.iterrows():
            slots.setdefault(x.rack_id, []).append(dict(
                server_id=x.server_id, slot=int(x.slot), status=x.status, max_risk=r2(x.max_risk, 3),
                worst_component=x.worst_component, worst_asset=x.worst_asset, power_w=r2(x.power_w, 0),
                inlet=r2(x.inlet_temp_c, 1), cpu=r2(x.cpu_util_pct, 0), model=x.model, workload=x.workload,
                health=r2(x.health_index, 0), comps={c: r2(x[f"risk_{c}"], 3) for c in COMPONENTS},
                tiers={c: {0: "healthy", 1: "watch", 2: "warning", 3: "critical"}[int(x[f"tier_{c}"])] for c in COMPONENTS}))
        racks = []
        for rid, r in self.rack_now.iterrows():
            racks.append(dict(rack_id=rid, row=r.row, pos=int(r.pos), workload=r.workload, vendor=r.vendor, state=r.state,
                              cooling_zone=r.cooling_zone, power_kw=r2(r.power_kw, 2), capacity_kw=float(r.pdu_capacity_kw),
                              avg_inlet=r2(r.avg_inlet, 1), max_inlet=r2(r.max_inlet, 1), avg_cpu=r2(r.avg_cpu, 0),
                              max_risk=r2(r.max_risk, 3), status=r.status, n_crit=int(r.n_crit), n_warn=int(r.n_warn),
                              n_watch=int(r.n_watch), slots=sorted(slots[rid], key=lambda z: z["slot"])))
        return dict(rows=sorted(self.racks.row.unique().tolist()), racks_per_row=int(self.racks.pos.max()), racks=racks)

    def servers_view(self) -> list[dict]:
        cols = ["rack_id", "row", "slot", "workload", "vendor", "status", "state", "max_risk", "worst_component", "cpu_util_pct",
                "mem_util_pct", "power_w", "inlet_temp_c", "outlet_temp_c", "cpu_temp_c", "net_throughput_gbps",
                "net_latency_ms", "packet_loss_pct", "disk_latency_ms", "failed_logins_24h"]
        return records(self.server_now[cols].reset_index().round(3))

    def facility_view(self) -> list[dict]:
        return records(self.facility.round(3))

    def thermal_matrix(self) -> dict:
        t = self.srv_tel[["server_id", "timestamp", "inlet_temp_c"]].copy()
        t["rack_id"] = t.server_id.astype(str).str[:3]
        t["date"] = t.timestamp.dt.strftime("%Y-%m-%d")
        m = t.groupby(["rack_id", "date"]).inlet_temp_c.mean().unstack()
        return dict(racks=m.index.tolist(), dates=m.columns.tolist(), values=m.round(2).values.tolist())

    def model_telemetry(self) -> dict:
        out = dict(models=self.ai)
        if self.eval is not None:
            live = self.scores.loc[self.eval.asset_id, "risk_score"]
            alerts = self.scores[self.scores.risk_score >= 0.5]
            out["ground_truth"] = dict(note="Synthetic ground truth: live degradations injected by the generator.",
                                       injected=int(len(self.eval)), recall_at_0_5=r2((live >= 0.5).mean(), 3),
                                       recall_at_0_25=r2((live >= 0.25).mean(), 3),
                                       precision_at_0_5=r2(alerts.index.isin(self.eval.asset_id).mean(), 3))
        return out

    def workorders(self, min_risk: float = 0.25) -> list[dict]:
        av = self.asset_view
        a = av[(av.risk_score >= min_risk) | (av.tier != "healthy")].copy()
        srv = self.server_now
        a["crit_score"] = a.server_id.map(srv.crit_score)
        a["criticality"] = a.server_id.map(srv.criticality)
        a["part_status"] = a.sku.map(self.inv.status)
        a["on_hand"] = a.sku.map(self.inv.on_hand)
        comp_rep = self.incidents[self.incidents.part_sku.notna()].groupby("component")
        a["est_mttr_h"] = a.component.map(comp_rep.mttr_h.median())
        a["est_downtime_min"] = a.component.map(comp_rep.downtime_min.mean())
        bonus = a.part_status.map({"stockout_risk": 8, "reorder": 4}).fillna(0)
        signal = np.maximum(a.risk_score, np.clip(a.anomaly_z / 30, 0, 0.35))
        a["priority_score"] = (100 * signal * (0.55 + 0.09 * a.crit_score) + bonus).round(1)
        a["top_factor"] = a.top_factors.map(lambda f: f[0]["feature"] if f else None)
        cols = ["server_id", "rack_id", "slot", "component", "vendor", "workload", "risk_score", "anomaly_z", "health_index", "tier", "state", "criticality",
                "crit_score", "sku", "part_status", "on_hand", "est_mttr_h", "est_downtime_min", "priority_score", "top_factor"]
        a = a[cols].sort_values("priority_score", ascending=False).reset_index()
        return records(a.round(3))

    def forecast(self) -> list[dict]:
        a = self.asset_view
        out = []
        for c in COMPONENTS:
            sub = a[a.component == c]
            skus = sub[sub.risk_score >= 0.25].sku.unique()
            out.append(dict(component=c, expected_failures_72h=r2(sub[sub.risk_score >= 0.25].risk_score.sum(), 1),
                            alerts=int((sub.risk_score >= 0.5).sum()), watch=int(((sub.risk_score >= 0.25) & (sub.risk_score < 0.5)).sum()),
                            spares_on_hand=int(self.inv.loc[self.inv.index.isin(skus), "on_hand"].sum()) if len(skus) else 0,
                            skus_short=int(self.inv.loc[self.inv.index.isin(skus)].status.isin(["stockout_risk", "reorder"]).sum()) if len(skus) else 0,
                            incidents_12m=int((self.incidents.component == c).sum())))
        return out

    def asset_detail(self, asset_id: str, n: int = 120) -> dict | None:
        if asset_id not in self.asset_view.index:
            return None
        a = self.asset_view.loc[asset_id]
        comp = a.component
        tel = self.tel[comp]
        series = tel[tel.asset_id == asset_id].tail(n)
        srv = self.srv_tel[self.srv_tel.server_id == a.server_id].tail(n)
        extra = {"nic": "packet_loss_pct", "disk": "disk_latency_ms", "psu": "power_w", "fan": "cpu_temp_c", "dimm": "mem_util_pct"}[comp]
        srv_cols = list(dict.fromkeys(["inlet_temp_c", "power_w", "cpu_util_pct", extra]))
        hist = self.incidents[self.incidents.server_id == a.server_id].sort_values("opened_at", ascending=False).head(8)
        return dict(
            asset_id=asset_id, component=comp, server_id=a.server_id, rack_id=a.rack_id, slot=int(a.slot), vendor=a.vendor,
            model=a.model, workload=a.workload, state=a.state, risk_score=r2(a.risk_score, 4), tier=a.tier,
            anomaly_z=r2(a.anomaly_z, 2), health_index=r2(a.health_index, 0),
            top_factors=a.top_factors, sku=self.sku_card(a.sku) if isinstance(a.sku, str) else None,
            channels=COMPONENT_CHANNELS[comp],
            series=dict(timestamp=series.timestamp.dt.strftime("%Y-%m-%dT%H:%M").tolist(),
                        **{c: series[c].round(3).tolist() for c in COMPONENT_CHANNELS[comp]}),
            server_series=dict(timestamp=srv.timestamp.dt.strftime("%Y-%m-%dT%H:%M").tolist(),
                               **{c: srv[c].round(3).tolist() for c in srv_cols}),
            server_incidents=records(hist[["ticket_id", "opened_at", "component", "template_id", "priority", "outcome",
                                           "mttr_h", "downtime_min", "part_sku"]]),
        )

    def recommend(self, asset_id: str) -> dict | None:
        if asset_id not in self.asset_view.index:
            return None
        a = self.asset_view.loc[asset_id]
        rec = self.agent.recommend(asset_id, a.component, a.state, float(a.risk_score), a.top_factors)
        return dict(asset_id=asset_id, component=a.component, server_id=a.server_id, rack_id=a.rack_id,
                    risk_score=r2(a.risk_score, 4), tier=a.tier, operational_state=a.state, safety_note=rec.safety_note,
                    symptom_tags=rec.symptom_tags, steps=rec.steps, citations=rec.citations, confidence=rec.confidence)

    def copilot(self, query: str, component: str | None = None, top_k: int = 5) -> dict:
        cands = self.retriever.search(query, component=component, top_k=len(self.retriever.documents))
        floor = cands[0].score * 0.4 if cands else 0
        seen, picked = set(), []
        for r in cands:
            tid = r.doc["template_id"]
            if tid in seen or r.score < floor:
                continue
            seen.add(tid)
            picked.append(r)
            if len(picked) >= top_k:
                break
        # durable fixes first (relevance order kept), fixes that rarely held last
        rate = lambda r: self.agent._stats(r.doc["template_id"]).get("durable_rate", 1)
        picked = [r for r in picked if rate(r) >= 0.6] + [r for r in picked if rate(r) < 0.6]
        lines, cites = [], []
        for i, r in enumerate(picked, 1):
            st = self.agent._stats(r.doc["template_id"])
            track = f"used {st['n']}x, durable {st['durable_rate']:.0%}, MTTR {st['median_mttr_h']:.1f} h" if st else "procedure"
            lines.append(f"{i}. [{r.doc['doc_id']}] {r.doc['fix_action']} ({track})")
            cites.append({**self.agent._cite(r.doc, r.score), "stats": st})
        answer = (f"{len(picked)} distinct fixes found:\n" + "\n".join(lines)) if picked else "No relevant historical incidents found."
        return dict(query=query, answer=answer, citations=cites)

    def incidents_view(self) -> list[dict]:
        cols = ["ticket_id", "opened_at", "resolved_at", "rack_id", "server_id", "asset_id", "component", "template_id", "priority",
                "outcome", "mttr_h", "downtime_min", "part_sku", "part_qty", "technician", "op_state", "sla_breached", "symptom"]
        return records(self.incidents[cols])

    def events_view(self, days: int = 7, limit: int = 3000) -> list[dict]:
        cut = self.events.timestamp.max() - pd.Timedelta(days=days)
        return records(self.events[self.events.timestamp >= cut].head(limit))

    def inventory_view(self) -> list[dict]:
        inv = self.inv.reset_index()
        at_risk = self.asset_view[self.asset_view.risk_score >= 0.5].sort_values("risk_score", ascending=False)
        linked: dict[str, list] = {}
        for aid, row in at_risk.iterrows():
            linked.setdefault(row.sku, []).append({"asset_id": aid, "risk": r2(row.risk_score, 3), "state": row.state})
        inv["linked_assets"] = inv.sku.map(lambda k: linked.get(k, []))
        cols = ["sku", "desc", "brand", "part", "family", "fit", "unit_cost", "lead_time_days", "bin", "warehouse", "on_hand", "inbound_qty",
                "next_arrival", "safety_stock", "reorder_point", "reorder_qty", "issued_12m", "stockout_days_12m", "avg_on_hand",
                "turns", "turn_cycle_days", "days_of_cover", "ml_demand", "n_at_risk", "baseline_30d", "projected_30d", "value_usd",
                "status", "linked_assets"]
        order = {"stockout_risk": 0, "reorder": 1, "healthy": 2, "overstock": 3}
        inv = inv[cols].assign(_o=inv.status.map(order)).sort_values(["_o", "days_of_cover"]).drop(columns="_o")
        return records(inv.round(3))

    def inventory_history(self) -> dict:
        out = {}
        tx = self.tx
        for sku, d in self.stock_daily.groupby("sku"):
            t = tx[(tx.sku == sku) & tx.type.isin(["receipt", "order", "backorder"])]
            out[sku] = dict(date=d.date.tolist(), on_hand=d.on_hand.astype(int).tolist(), on_order=d.on_order.astype(int).tolist(),
                            events=records(t[["date", "type", "qty", "ref"]]),
                            issues_by_day=tx[(tx.sku == sku) & (tx.type == "issue")].groupby("date").qty.sum().astype(int).to_dict())
        return out

    def consumption(self) -> dict:
        u = self.incidents.dropna(subset=["part_sku"]).copy()
        u["family"] = u.part_sku.map(self.inv.family)
        u["month"] = u.opened_at.dt.strftime("%Y-%m")
        m = u.groupby(["month", "family"]).part_qty.sum().unstack(fill_value=0)
        if len(m) > 12:  # drop the partial first month of the 12-month window
            m = m.iloc[1:]
        return dict(months=m.index.tolist(), families=m.columns.tolist(), values=records(m.reset_index()))

    def graph_stats(self) -> dict:
        return self.graph.stats()


_lock = threading.Lock()
_fleet: Fleet | None = None


def get_fleet() -> Fleet:
    """Build the fleet once; concurrent first requests wait instead of each building it."""
    global _fleet
    if _fleet is None:
        with _lock:
            if _fleet is None:
                _fleet = Fleet()
    return _fleet
