"""
Recommendation agent: turns a predicted-at-risk component into a structured,
cited, context-aware action plan.

Deterministic pipeline (no external LLM call in this build -- see
docs/TECHNICAL_DOCUMENTATION.md "Upgrade path"):
  1. symptom tags are derived from the prediction's top SHAP drivers
  2. hybrid retrieval + fault-graph traversal gather candidate fixes
  3. each fix is annotated with its 12-month track record (times used,
     durable-fix rate, MTTR, downtime) and live spare-part availability
  4. operational context (migration / backup / DR / maintenance window)
     prepends a safety step
Every step cites the knowledge-base document it came from.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

import pandas as pd

from ..knowledge.graph import FaultKnowledgeGraph
from ..knowledge.retrieval import HybridRetriever
from ..ml.features import CHANNEL_SYMPTOM, channel_of

CONTEXT_SAFETY_NOTES = {
    "migration": "Rack is mid-migration. Confirm the migration's active data path does not depend on this component; "
                 "fail the migration job over first if it does.",
    "backup_window": "Rack is inside a backup window. Check whether the backup job reads from or writes to this component; "
                     "pause or reroute it before replacing hardware to avoid a partial backup.",
    "dr_failover": "Rack is serving a disaster-recovery failover -- a live production path. Coordinate with the DR runbook "
                   "and prefer the least disruptive fix (use the redundant unit) over anything that risks a second outage.",
    "maintenance_window": "Rack is in a scheduled maintenance window -- the lowest-risk time to do this work. Replace "
                          "proactively now rather than waiting for the failure.",
    "normal": None,
}


@dataclass
class Recommendation:
    asset_id: str
    component: str
    risk_score: float | None
    operational_state: str
    safety_note: str | None
    symptom_tags: list
    steps: list
    citations: list
    confidence: str


def symptoms_from_factors(component: str, top_factors: list | None) -> list[str]:
    mapping = CHANNEL_SYMPTOM.get(component, {})
    tags = []
    for f in top_factors or []:
        if f["shap_contribution"] > 0:
            tag = mapping.get(channel_of(f["feature"]))
            if tag and tag not in tags:
                tags.append(tag)
    return tags or list(dict.fromkeys(mapping.values()))[:3]


class RecommendationAgent:
    def __init__(self, retriever: HybridRetriever, graph: FaultKnowledgeGraph, fix_stats: pd.DataFrame,
                 part_lookup: Callable[[str, str], dict | None] | None = None):
        self.retriever, self.graph, self.fix_stats = retriever, graph, fix_stats
        self.part_lookup = part_lookup or (lambda template_id, asset_id: None)

    def _stats(self, template_id: str) -> dict:
        if template_id not in self.fix_stats.index:
            return {}
        s = self.fix_stats.loc[template_id]
        return dict(n=int(s.n), durable_rate=round(float(s.durable_rate), 3), median_mttr_h=round(float(s.median_mttr_h), 2),
                    median_downtime_min=float(s.median_downtime_min), last_used=str(s.last_used)[:10])

    @staticmethod
    def _cite(doc: dict, score: float | None) -> dict:
        return dict(doc_id=doc["doc_id"], doc_type=doc["doc_type"], source_ref=doc["source_ref"], date=doc.get("date"),
                    excerpt=doc["text"][:240], match_score=score, success=doc["success"], template_id=doc["template_id"])

    def recommend(self, asset_id: str, component: str, operational_state: str = "normal", risk_score: float | None = None,
                  top_factors: list | None = None, query_text: str | None = None, max_actions: int = 4) -> Recommendation:
        tags = symptoms_from_factors(component, top_factors)
        query = query_text or f"{component} {' '.join(t.replace('_', ' ') for t in tags)} failure"
        results = self.retriever.search(query, component=component, symptom_tags=tags, top_k=len(self.retriever.documents))

        best: dict[str, tuple] = {}
        for r in results:
            tid = r.doc["template_id"]
            if tid not in best:
                best[tid] = (r.score, r.doc)
        top_score = max((v[0] for v in best.values()), default=0)
        ranked = [kv for kv in sorted(best.items(), key=lambda kv: -kv[1][0]) if kv[1][0] >= 0.3 * top_score][: max_actions + 2]
        durable = [kv for kv in ranked if self._stats(kv[0]).get("durable_rate", 1) >= 0.6]
        caution = [kv for kv in ranked if self._stats(kv[0]).get("durable_rate", 1) < 0.6]
        chosen = (durable[:max_actions - 1] + caution[:1]) if caution else durable[:max_actions]

        steps, citations = [], []
        safety = CONTEXT_SAFETY_NOTES.get(operational_state)
        if safety:
            steps.append({"type": "safety", "text": safety})
        if top_factors and risk_score is not None:
            drivers = ", ".join(f"{f['feature']} ({f['shap_contribution']:+.2f})" for f in top_factors[:3])
            steps.append({"type": "signal", "text": f"Failure risk {risk_score:.0%} within 72 h, driven by {drivers}.",
                          "symptom_tags": tags})

        for rank, (tid, (score, doc)) in enumerate(chosen, start=1):
            st = self._stats(tid)
            rate = st.get("durable_rate")
            if rate is not None and rate < 0.6:
                note = f"Tried {st['n']}x in 12 months but held only {rate:.0%} of the time -- not a primary fix."
            elif st:
                note = f"Used {st['n']}x in 12 months, durable {rate:.0%}, median MTTR {st['median_mttr_h']:.1f} h."
            else:
                note = "Documented procedure."
            steps.append({"type": "action" if (rate or 1) >= 0.6 else "caution", "rank": rank, "template_id": tid,
                          "text": doc["fix_action"], "root_cause": doc["root_cause"], "outcome_note": note, "stats": st,
                          "part": self.part_lookup(tid, asset_id), "citation_doc_id": doc["doc_id"], "match_score": score})
            citations.append(self._cite(doc, score))

        listed = {tid for tid, _ in chosen}
        for g in self.graph.related_fixes(component, tags):
            st = self._stats(g["template_id"])
            if g["template_id"] in listed or st.get("durable_rate", 0) < 0.8 or not g["supporting_doc_ids"]:
                continue
            doc = self.retriever.get_document(g["supporting_doc_ids"][0])
            steps.append({"type": "related_via_graph", "template_id": g["template_id"], "text": g["fix_action"],
                          "root_cause": g["root_cause"], "stats": st, "part": self.part_lookup(g["template_id"], asset_id),
                          "outcome_note": f"Linked through symptom '{g['via_symptom']}' in the fault graph, not by text match.",
                          "citation_doc_id": doc["doc_id"]})
            citations.append(self._cite(doc, None))
            break

        top = next((s for s in steps if s["type"] == "action"), None)
        if risk_score is not None and risk_score >= 0.75 and top and top["stats"].get("durable_rate", 0) >= 0.85 and top["stats"].get("n", 0) >= 10:
            confidence = "high"
        elif citations:
            confidence = "medium"
        else:
            confidence = "low"
        return Recommendation(asset_id, component, risk_score, operational_state, safety, tags, steps, citations, confidence)
