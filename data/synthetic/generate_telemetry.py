"""
Synthetic telemetry generator for RackIQ -- v2, 100-rack floor.

Floor: 5 rows (A-E) x 20 racks x 8 servers = 800 servers, each monitored at
5 component points (DIMM, disk, PSU, NIC, fan) = 4,000 predicted components.
90 days of history at 6-hour cadence (360 readings per series).

Telemetry follows the MELT model (metrics, events, logs, traces):
  * Metrics  -- component health channels (ECC, SMART, PSU, NIC, fan) and
                server-level infrastructure metrics: CPU / memory utilization
                (profiling telemetry), power draw, inlet / outlet / CPU temps,
                network throughput, latency and packet loss (network
                telemetry), disk IOPS / latency (storage activity), failed
                authentication counts (security telemetry). Facility-level
                PUE and outside temperature, daily.
  * Events / logs -- BMC SEL threshold events, service interruptions, reboots,
                config changes (firmware), auth failures -- last 14 days.
  * Traces   -- NOT generated: end-to-end request tracing needs application
                instrumentation and is out of scope for a hardware copilot.
                Location and user telemetry are likewise excluded.
  * AI telemetry (drift, confidence, inference latency) is computed live by
    the backend about RackIQ's own models, not generated here.

Everything here is synthetic, generated with a fixed seed. Pre-failure
signatures are engineered so the models have real signal; a small rate of
transient spikes is added so the problem is not trivially separable.

Outputs (data/synthetic/):
  racks.csv, servers.csv, assets.csv, operational_context.csv,
  failure_events.csv, facility_daily.csv, _eval_current_degradation.csv,
  telemetry/{dimm,disk,psu,nic,fan}.parquet, telemetry/servers.parquet,
  events.parquet
"""
import numpy as np
import pandas as pd
from pathlib import Path

from catalog import (COMPONENTS, END, MODELS, PDU_CAPACITY_KW, POWER_W, RACKS_PER_ROW, ROW_WORKLOAD, ROWS,
                     SLOTS, WORKLOAD_CRITICALITY, component_part, resolve_sku, tier_of)

SEED = 42
OUT = Path(__file__).parent
TEL = OUT / "telemetry"
TEL.mkdir(exist_ok=True)

DAYS = 90
PER_DAY = 4
T = DAYS * PER_DAY
TIMESTAMPS = pd.date_range(end=END, periods=T, freq="6h")

# Must match TAIL_HOLDOUT_READINGS in backend/app/ml/features.py: the most
# recent readings are "live" and held out of training.
CURRENT_TAIL_READINGS = 16
P_CURRENTLY_DEGRADING = 0.02
P_HIST_FAIL = {"dimm": 0.07, "disk": 0.09, "psu": 0.06, "nic": 0.06, "fan": 0.08}
SPIKE_RATE = 0.004
EVENT_DAYS = 14
VENDORS = ["Dell", "HPE", "Lenovo"]


# ---------------------------------------------------------------- layout
def build_layout(rng):
    racks, servers, assets = [], [], []
    for row in ROWS:
        workload = ROW_WORKLOAD[row]
        tier = tier_of(workload)
        for pos in range(1, RACKS_PER_ROW + 1):
            rack_id = f"{row}{pos:02d}"
            vendor = VENDORS[(pos + ROWS.index(row)) % 3]
            racks.append(dict(rack_id=rack_id, row=row, pos=pos, workload=workload, tier=tier, vendor=vendor,
                              cooling_zone=f"CRAC-{(pos - 1) // 5 + 1}", pdu_capacity_kw=PDU_CAPACITY_KW[tier]))
            for slot in range(1, SLOTS + 1):
                server_id = f"{rack_id}-S{slot}"
                model = MODELS[(vendor, tier)]
                servers.append(dict(server_id=server_id, rack_id=rack_id, row=row, pos=pos, slot=slot, vendor=vendor,
                                    model=model, workload=workload, tier=tier,
                                    criticality=WORKLOAD_CRITICALITY[workload],
                                    serial=f"SN{rng.integers(10**7, 10**8)}"))
                for comp in COMPONENTS:
                    assets.append(dict(asset_id=f"{server_id}-{comp.upper()}", server_id=server_id, rack_id=rack_id,
                                       row=row, pos=pos, slot=slot, component=comp, vendor=vendor, model=model,
                                       workload=workload,
                                       sku=resolve_sku(component_part(comp), vendor, workload)))
    return pd.DataFrame(racks), pd.DataFrame(servers), pd.DataFrame(assets)


# ---------------------------------------------------------------- severity
def degradation_plan(n, comp, rng):
    """Per-asset historical failure and live-degradation schedule, plus the
    (n, T) severity matrix in [0, 1] and the degrade mask."""
    win = rng.integers(8, 40, n)
    tail_start = T - CURRENT_TAIL_READINGS
    hist = rng.random(n) < P_HIST_FAIL[comp]
    lo, hi = win + 4, tail_start - 2
    fail_idx = np.where(hist, (lo + rng.random(n) * (hi - lo)).astype(int), 0)

    cur = (~hist) & (rng.random(n) < P_CURRENTLY_DEGRADING)
    cur_start = tail_start + rng.integers(0, CURRENT_TAIL_READINGS - 4, n)
    cur_target = rng.uniform(0.1, 0.95, n)

    j = np.arange(T)[None, :]
    frac = (j - (fail_idx - win)[:, None]) / win[:, None]
    in_hist = hist[:, None] & (frac >= 0) & (frac <= 1)
    sev = np.where(in_hist, np.clip(frac, 0, 1) ** 1.5, 0.0)

    span = np.maximum(T - 1 - cur_start, 1)[:, None]
    cfrac = (j - cur_start[:, None]) / span * cur_target[:, None]
    in_cur = cur[:, None] & (j >= cur_start[:, None])
    sev = np.where(in_cur, np.clip(cfrac, 0, 1) ** 1.5, sev)
    return dict(hist=hist, fail_idx=fail_idx, win=win, cur=cur, cur_target=cur_target, sev=sev,
                deg=in_hist | in_cur)


def pois(rng, lam, shape=None):
    return rng.poisson(lam, shape).astype(np.float32)


def gen_component(comp, n, rng, inlet_bias):
    """Returns (channels dict of (n, T) arrays, plan)."""
    p = degradation_plan(n, comp, rng)
    s, d = p["sev"], p["deg"]
    shape = (n, T)
    spike = rng.random(shape) < SPIKE_RATE
    ib = inlet_bias  # (n, T) inlet offset from 22C, couples component temps to the room

    if comp == "dimm":
        ch = {
            "ecc_correctable_24h": pois(rng, 0.4, shape) + np.where(d, pois(rng, 2 + 40 * s), 0) + spike * pois(rng, 8, shape),
            "ecc_uncorrectable_24h": np.where(d, pois(rng, 3 * s), 0).astype(np.float32),
            "temp_c": rng.normal(42, 2.5, shape) + 0.3 * ib + 3 * s,
        }
    elif comp == "disk":
        ch = {
            "reallocated_sectors": pois(rng, 0.05, shape) + np.where(d, pois(rng, 1 + 15 * s), 0),
            "pending_sectors": pois(rng, 0.02, shape) + np.where(d, pois(rng, 1 + 8 * s), 0) + spike * pois(rng, 3, shape),
            "smart_read_error_rate": rng.normal(2, 0.5, shape) + 6 * s,
            "io_latency_ms": np.abs(rng.normal(1.2, 0.2, shape)) + 7 * s + spike * rng.uniform(2, 6, shape),
            "temp_c": rng.normal(38, 2.5, shape) + 0.3 * ib + 4 * s,
        }
    elif comp == "psu":
        ch = {
            "input_voltage_v": rng.normal(208, 1.5, shape) - 6 * s - spike * rng.uniform(3, 6, shape),
            "output_ripple_mv": rng.normal(20, 3, shape) + 40 * s,
            "fan_rpm": rng.normal(6000, 200, shape) - 1500 * s,
            "temp_c": rng.normal(45, 3, shape) + 0.4 * ib + 8 * s,
            "efficiency_pct": rng.normal(94, 0.4, shape) - 6 * s,
        }
    elif comp == "nic":
        ch = {
            "link_flap_count_24h": pois(rng, 0.1, shape) + np.where(d, pois(rng, 1 + 10 * s), 0) + spike * pois(rng, 3, shape),
            "crc_errors_24h": pois(rng, 0.3, shape) + np.where(d, pois(rng, 2 + 20 * s), 0),
            "packet_loss_pct": np.abs(rng.normal(0.01, 0.005, shape)) + 1.5 * s,
            "temp_c": rng.normal(40, 3, shape) + 0.3 * ib + 2 * s,
        }
    elif comp == "fan":
        ch = {
            "fan_rpm": rng.normal(8500, 250, shape) - 2500 * s + 40 * ib,
            "vibration_mm_s": np.abs(rng.normal(1.2, 0.15, shape)) + 4.5 * s + spike * rng.uniform(1, 2.5, shape),
            "motor_current_a": rng.normal(0.9, 0.05, shape) + 0.6 * s,
        }
    else:
        raise ValueError(comp)
    return {k: v.astype(np.float32) for k, v in ch.items()}, p


def to_long(ids, channels, id_col="asset_id"):
    n = len(ids)
    df = pd.DataFrame({
        id_col: pd.Categorical(np.repeat(np.asarray(ids), T)),
        "timestamp": np.tile(TIMESTAMPS.values, n),
    })
    for k, v in channels.items():
        df[k] = np.round(v.reshape(-1), 3)
    return df


# ---------------------------------------------------------------- main
def generate(seed=SEED):
    rng = np.random.default_rng(seed)
    racks, servers, assets = build_layout(rng)
    n_srv = len(servers)
    j = np.arange(T)
    hours = TIMESTAMPS.hour.values
    diurnal = np.sin(2 * np.pi * (hours - 9) / 24)[None, :]           # peak mid-afternoon
    weekend = (TIMESTAMPS.dayofweek.values >= 5)[None, :]
    night = ((hours >= 0) & (hours < 6))[None, :]

    # ---- room thermal field (server inlet temperature), (n_srv, T)
    pos = servers["pos"].values[:, None]
    row_idx = servers["row"].map({r: i for i, r in enumerate(ROWS)}).values[:, None]
    slot = servers["slot"].values[:, None]
    base_inlet = 21.0 + 0.4 * row_idx + 1.2 * ((pos == 1) | (pos == RACKS_PER_ROW)) + 0.22 * slot
    base_inlet = base_inlet + rng.normal(0, 0.4, (n_srv, 1))
    # CRAC-3 (racks 11-15) in rows C-D degrades over the last 30 days -> hot spot story.
    crac3 = ((pos >= 11) & (pos <= 15) & ((row_idx == 2) | (row_idx == 3)))
    ramp = np.clip((j - (T - 120)) / 120, 0, 1)[None, :]
    inlet = base_inlet + 0.6 * diurnal + crac3 * 4.2 * ramp + rng.normal(0, 0.35, (n_srv, T))
    inlet_bias_srv = inlet - 22.0

    # ---- component telemetry
    eval_rows, failure_rows = [], []
    comp_mats = {}
    for comp in COMPONENTS:
        sub = assets[assets.component == comp].reset_index(drop=True)  # same order as servers
        ch, plan = gen_component(comp, len(sub), rng, inlet_bias_srv)
        comp_mats[comp] = (ch, plan)
        to_long(sub.asset_id.values, ch).to_parquet(TEL / f"{comp}.parquet", compression="zstd", index=False)
        for i in np.where(plan["hist"])[0]:
            f = plan["fail_idx"][i]
            failure_rows.append(dict(asset_id=sub.asset_id[i], server_id=sub.server_id[i], rack_id=sub.rack_id[i],
                                     component=comp, vendor=sub.vendor[i], workload=sub.workload[i], sku=sub.sku[i],
                                     failure_timestamp=TIMESTAMPS[f].isoformat(),
                                     degrade_window_start=TIMESTAMPS[max(f - plan["win"][i], 0)].isoformat()))
        for i in np.where(plan["cur"])[0]:
            eval_rows.append(dict(asset_id=sub.asset_id[i], component=comp, target_severity=round(float(plan["cur_target"][i]), 3)))
        print(f"  {comp}: {plan['hist'].sum()} historical failures, {plan['cur'].sum()} live degradations")

    # Operational context: ~10% of racks in a sensitive window right now. Half of
    # them are racks that also have a live degradation -- failures surface during
    # migrations / backups / DR more often than not, which is the product's premise.
    degraded_racks = sorted({eval_row["asset_id"][:3] for eval_row in eval_rows})
    rack_ids = racks["rack_id"].values
    picks = list(rng.choice(degraded_racks, 6, replace=False))
    others = [r for r in rack_ids if r not in picks]
    picks += list(rng.choice(others, 5, replace=False))
    order = ["dr_failover", "migration", "backup_window", "dr_failover", "migration", "maintenance_window",
             "migration", "backup_window", "backup_window", "migration", "maintenance_window"]
    state_of = dict(zip(picks, order))
    states = np.array([state_of.get(r, "normal") for r in rack_ids], dtype=object)
    hot = np.array([list(rack_ids).index(r) for r in picks])
    context = pd.DataFrame({"rack_id": rack_ids, "operational_state": states, "as_of": END.isoformat()})
    srv_state = servers["rack_id"].map(dict(zip(context.rack_id, context.operational_state))).values

    # ---- server-level infrastructure telemetry
    wl = servers["workload"].values
    tier = servers["tier"].values
    cpu_base = pd.Series(wl).map({"web": 35, "virtualization": 48, "database": 52, "storage": 22, "ai": 74}).values[:, None]
    cpu_base = cpu_base + rng.normal(0, 6, (n_srv, 1))
    swing = np.where(wl == "ai", 6, 15)[:, None]
    mig = (srv_state == "migration")[:, None]
    bkp = (srv_state == "backup_window")[:, None]
    dr = (srv_state == "dr_failover")[:, None]
    live = (j >= T - 8)[None, :]  # sensitive windows are "now": last 2 days
    cpu = cpu_base + swing * diurnal - 6 * weekend + rng.normal(0, 5, (n_srv, T))
    cpu = cpu + live * (mig * 10 + dr * 18 + bkp * night * 12)
    cpu = np.clip(cpu, 2, 99)
    mem = np.clip(cpu_base * 0.7 + 25 + 0.2 * (cpu - cpu_base) + rng.normal(0, 3, (n_srv, T)), 10, 98)

    idle = np.where(tier == "ai", POWER_W["ai"][0], POWER_W["std"][0])[:, None]
    pmax = np.where(tier == "ai", POWER_W["ai"][1], POWER_W["std"][1])[:, None]
    psu_sev = comp_mats["psu"][1]["sev"]
    power = idle + (pmax - idle) * (cpu / 100) ** 0.9 + rng.normal(0, 15, (n_srv, T))
    power = power * (1 + 0.04 * psu_sev)
    outlet = inlet + 6 + 12 * (power - idle) / (pmax - idle) + rng.normal(0, 0.5, (n_srv, T))
    cpu_temp = inlet + 22 + 32 * cpu / 100 + rng.normal(0, 2, (n_srv, T))
    fan_avg = comp_mats["fan"][0]["fan_rpm"] * 0.65 + 90 * inlet_bias_srv + 22 * cpu

    net_base = pd.Series(wl).map({"web": 4, "virtualization": 6, "database": 3, "storage": 9, "ai": 18}).values[:, None]
    net = np.clip(net_base * (1 + 0.35 * diurnal) + live * (mig * 9 + bkp * night * 6 + dr * 7)
                  + rng.normal(0, 0.6, (n_srv, T)), 0.1, np.where(tier == "ai", 190, 48)[:, None])
    nic_sev = comp_mats["nic"][1]["sev"]
    latency = 0.12 + 0.015 * net + 2.2 * nic_sev + np.abs(rng.normal(0, 0.02, (n_srv, T)))
    pkt_loss = comp_mats["nic"][0]["packet_loss_pct"]
    iops_base = pd.Series(wl).map({"web": 12, "virtualization": 32, "database": 64, "storage": 95, "ai": 24}).values[:, None]
    iops = np.clip(iops_base * (1 + 0.3 * diurnal) + live * bkp * night * 40 + rng.normal(0, 3, (n_srv, T)), 0.5, None)
    disk_lat = comp_mats["disk"][0]["io_latency_ms"]
    # Security telemetry: background noise + two servers under a credential-stuffing episode last week.
    fails = pois(rng, 0.2, (n_srv, T))
    brute = rng.choice(n_srv, 2, replace=False)
    fails[brute, T - 28:T - 20] += pois(rng, 30, (2, 8))

    srv_ch = dict(cpu_util_pct=cpu, mem_util_pct=mem, power_w=power, inlet_temp_c=inlet, outlet_temp_c=outlet,
                  cpu_temp_c=cpu_temp, fan_avg_rpm=fan_avg, net_throughput_gbps=net, net_latency_ms=latency,
                  packet_loss_pct=pkt_loss, disk_iops_k=iops, disk_latency_ms=disk_lat, failed_logins_24h=fails)
    srv_ch = {k: v.astype(np.float32) for k, v in srv_ch.items()}
    to_long(servers.server_id.values, srv_ch, id_col="server_id").to_parquet(TEL / "servers.parquet",
                                                                            compression="zstd", index=False)

    # ---- facility (daily): IT load, PUE, outside temperature
    it_kw = power.sum(axis=0) / 1000
    day = TIMESTAMPS.normalize()
    doy = TIMESTAMPS.dayofyear.values
    outside = 29 + 7 * np.cos(2 * np.pi * (doy - 205) / 365) + 4 * diurnal[0] + rng.normal(0, 1.2, T)
    pue = 1.30 + 0.0055 * np.clip(outside - 18, 0, None) + crac3.any() * 0.02 * ramp[0] + rng.normal(0, 0.006, T)
    fac = pd.DataFrame(dict(date=day, it_power_kw=it_kw, outside_temp_c=outside, pue=pue,
                            avg_inlet_c=inlet.mean(axis=0), max_inlet_c=inlet.max(axis=0),
                            avg_outlet_c=outlet.mean(axis=0), avg_cpu_pct=cpu.mean(axis=0),
                            net_gbps=net.sum(axis=0)))
    fac = fac.groupby("date").mean().reset_index()
    fac["facility_power_kw"] = fac.it_power_kw * fac.pue
    fac["date"] = fac.date.dt.strftime("%Y-%m-%d")
    fac.round(3).to_csv(OUT / "facility_daily.csv", index=False)

    # ---- events & logs (last 14 days)
    events = build_events(rng, servers, assets, comp_mats, srv_ch)
    events.to_parquet(OUT / "events.parquet", compression="zstd", index=False)

    racks.to_csv(OUT / "racks.csv", index=False)
    servers.to_csv(OUT / "servers.csv", index=False)
    assets.to_csv(OUT / "assets.csv", index=False)
    context.to_csv(OUT / "operational_context.csv", index=False)
    pd.DataFrame(failure_rows).to_csv(OUT / "failure_events.csv", index=False)
    pd.DataFrame(eval_rows).to_csv(OUT / "_eval_current_degradation.csv", index=False)
    # drop the v1 CSV if it is still around
    (OUT / "telemetry.csv").unlink(missing_ok=True)

    print(f"racks={len(racks)} servers={n_srv} components={len(assets)} readings/series={T}")
    print(f"failure_events={len(failure_rows)} live_degradations={len(eval_rows)} events={len(events)}")
    print(f"hot racks: {dict(zip(context.rack_id[hot], states[hot]))}")


EVENT_RULES = [
    # component, channel, op, threshold, severity, source, category, message
    ("dimm", "ecc_correctable_24h", ">", 10, "warning", "BMC-SEL", "metric-threshold", "Correctable memory error rate exceeded threshold"),
    ("dimm", "ecc_uncorrectable_24h", ">", 0.5, "critical", "BMC-SEL", "service-interruption", "Uncorrectable ECC error detected; machine check logged"),
    ("disk", "reallocated_sectors", ">", 5, "warning", "BMC-SEL", "metric-threshold", "Predictive failure: SMART reallocated sector count rising"),
    ("disk", "io_latency_ms", ">", 5, "warning", "syslog", "metric-threshold", "Storage I/O latency above 5 ms on drive"),
    ("psu", "input_voltage_v", "<", 203, "warning", "BMC-SEL", "metric-threshold", "PSU input voltage below lower non-critical threshold"),
    ("psu", "output_ripple_mv", ">", 45, "warning", "BMC-SEL", "metric-threshold", "PSU output ripple above specification"),
    ("nic", "link_flap_count_24h", ">", 3, "warning", "syslog", "service-interruption", "Link down/up flap on NIC port"),
    ("nic", "crc_errors_24h", ">", 12, "warning", "SNMP", "metric-threshold", "Interface CRC error count rising"),
    ("fan", "fan_rpm", "<", 7000, "warning", "BMC-SEL", "metric-threshold", "Fan speed below lower non-critical threshold"),
    ("fan", "vibration_mm_s", ">", 3.5, "warning", "BMC-SEL", "metric-threshold", "Fan vibration above bearing-wear threshold"),
]


def build_events(rng, servers, assets, comp_mats, srv_ch):
    w = EVENT_DAYS * PER_DAY
    idx0 = T - w
    rows = []

    def crossings(mat, op, thr):
        m = mat[:, idx0 - 1:] > thr if op == ">" else mat[:, idx0 - 1:] < thr
        return np.argwhere(m[:, 1:] & ~m[:, :-1])  # rising edges only

    for comp, chn, op, thr, sev, src, cat, msg in EVENT_RULES:
        sub = assets[assets.component == comp].reset_index(drop=True)
        mat = comp_mats[comp][0][chn]
        for i, k in crossings(mat, op, thr):
            ts = TIMESTAMPS[idx0 + k] + pd.Timedelta(minutes=int(rng.integers(0, 360)))
            rows.append(dict(timestamp=ts, server_id=sub.server_id[i], rack_id=sub.rack_id[i], asset_id=sub.asset_id[i],
                             source=src, severity=sev, category=cat,
                             message=f"{msg} ({chn}={mat[i, idx0 + k]:.1f})"))

    inlet = srv_ch["inlet_temp_c"]
    for i, k in crossings(inlet, ">", 27):
        v = inlet[i, idx0 + k]
        rows.append(dict(timestamp=TIMESTAMPS[idx0 + k], server_id=servers.server_id[i], rack_id=servers.rack_id[i],
                         asset_id=None, source="BMS", severity="critical" if v > 30 else "warning", category="metric-threshold",
                         message=f"Inlet temperature {v:.1f} C above ASHRAE recommended range (27 C)"))
    fails = srv_ch["failed_logins_24h"]
    for i, k in crossings(fails, ">", 5):
        rows.append(dict(timestamp=TIMESTAMPS[idx0 + k] + pd.Timedelta(minutes=int(rng.integers(0, 360))),
                         server_id=servers.server_id[i], rack_id=servers.rack_id[i], asset_id=None, source="security",
                         severity="warning", category="auth-failure",
                         message=f"Repeated failed BMC login attempts ({int(fails[i, idx0 + k])} in 24h) from 10.20.{rng.integers(1, 250)}.{rng.integers(1, 250)}"))

    n = len(servers)
    for _ in range(int(0.9 * n)):  # config changes, reboots, informational logs
        i = rng.integers(n)
        ts = TIMESTAMPS[idx0] + pd.Timedelta(minutes=int(rng.integers(0, w * 360)))
        kind = rng.choice(["fw", "reboot", "cfg", "info"], p=[0.25, 0.25, 0.2, 0.3])
        if kind == "fw":
            msg, cat, src = f"Firmware updated: BMC {rng.choice(['7.10.30', '7.10.50', '2.84'])} -> {rng.choice(['7.10.70', '2.90'])}", "config-change", "config"
        elif kind == "reboot":
            msg, cat, src = rng.choice(["Host reboot initiated by OS", "Planned reboot for kernel patch", "Watchdog-initiated reboot"]), "restart", "syslog"
        elif kind == "cfg":
            msg, cat, src = rng.choice(["Power cap policy changed to 90%", "BIOS profile re-applied (golden baseline)", "BMC NTP server updated"]), "config-change", "config"
        else:
            msg, cat, src = rng.choice(["Health check passed", "Telemetry collector reconnected", "Scheduled SMART self-test completed"]), "info", "syslog"
        rows.append(dict(timestamp=ts, server_id=servers.server_id[i], rack_id=servers.rack_id[i], asset_id=None,
                         source=src, severity="info", category=cat, message=msg))

    ev = pd.DataFrame(rows).sort_values("timestamp", ascending=False).reset_index(drop=True)
    ev["timestamp"] = pd.to_datetime(ev["timestamp"])
    return ev


if __name__ == "__main__":
    generate()
