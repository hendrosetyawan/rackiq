"""
Recommendation agent: given a triggered alert (an asset whose predicted
failure risk crossed the threshold, or an explicit symptom report), produces
a structured, cited, context-aware recommendation.

This prototype runs a DETERMINISTIC pipeline rather than calling an external
LLM (no API key was available for this build -- see
docs/TECHNICAL_DOCUMENTATION.md "Upgrade path" for wiring in a grounded LLM
call). Every recommendation step is still evidence-backed: retrieval and
graph traversal select the supporting documents, and a template assembles
them into an explanation with citations back to specific doc_ids, exactly as
the "Explainable and Cited Recommendation" feature in the submission
describes -- the templating step is what would be replaced by an LLM call
later, not the evidence-gathering.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from ..knowledge.graph import FaultKnowledgeGraph
from ..knowledge.retrieval import HybridRetriever, RetrievalResult

SYMPTOM_BY_COMPONENT = {
    "dimm": ["ecc_correctable_spike", "ecc_uncorrectable", "memory_errors"],
    "disk": ["reallocated_sectors", "pending_sectors", "smart_prefail"],
    "psu": ["input_voltage_drop", "output_ripple_high", "psu_fault", "fan_rpm_drop"],
    "nic": ["link_flap", "crc_errors"],
}

CONTEXT_SAFETY_NOTES = {
    "migration": "This rack is currently mid-migration. Confirm the migration's active data "
    "path does not depend on this component before taking it offline; fail over the migration "
    "job first if it does.",
    "backup_window": "This rack is currently inside a scheduled backup window. Check whether "
    "the backup job is reading from or writing to this component; if so, pause or reroute the "
    "job before replacing hardware to avoid a partial/corrupt backup.",
    "dr_failover": "This rack is currently serving a disaster-recovery failover. Treat this as "
    "a live production path: coordinate with the DR run book before any hardware action, and "
    "prefer the least disruptive fix (e.g. use the redundant unit) over anything that risks a "
    "second outage.",
    "normal": None,
}


@dataclass
class Recommendation:
    asset_id: str
    component: str
    risk_score: float | None
    operational_state: str
    safety_note: str | None
    steps: list[dict]
    citations: list[dict]
    graph_evidence: list[dict]
    confidence: str


class RecommendationAgent:
    def __init__(self, retriever: HybridRetriever, graph: FaultKnowledgeGraph):
        self.retriever = retriever
        self.graph = graph

    def recommend(
        self,
        asset_id: str,
        component: str,
        operational_state: str = "normal",
        risk_score: float | None = None,
        top_factors: list[dict] | None = None,
        query_text: str | None = None,
        top_k: int = 4,
    ) -> Recommendation:
        symptom_tags = SYMPTOM_BY_COMPONENT.get(component, [])
        query = query_text or f"{component} failure risk elevated {' '.join(symptom_tags)}"

        results: list[RetrievalResult] = self.retriever.search(
            query=query, component=component, symptom_tags=symptom_tags, top_k=top_k
        )
        graph_evidence = self.graph.related_fixes(component, symptom_tags)

        safety_note = CONTEXT_SAFETY_NOTES.get(operational_state)

        steps = []
        citations = []
        if safety_note:
            steps.append({"type": "safety", "text": safety_note})

        if top_factors:
            factor_desc = ", ".join(
                f"{f['feature']} (contribution {f['shap_contribution']:+.3f})" for f in top_factors
            )
            steps.append(
                {
                    "type": "signal",
                    "text": f"Predictive model flags this component at risk={risk_score:.0%} "
                    f"({round((risk_score or 0) * 100)}%), driven mainly by: {factor_desc}.",
                }
            )

        seen_fix_actions = set()
        rank = 1
        for r in results:
            doc = r.doc
            if doc["fix_action"] in seen_fix_actions:
                continue
            seen_fix_actions.add(doc["fix_action"])
            outcome = "previously resolved this signature" if doc["success"] else \
                "was tried before but did NOT durably resolve this signature -- do not repeat as the primary fix"
            steps.append(
                {
                    "type": "action",
                    "rank": rank,
                    "text": doc["fix_action"],
                    "outcome_note": outcome,
                    "citation_doc_id": doc["doc_id"],
                    "match_score": r.score,
                }
            )
            citations.append(
                {
                    "doc_id": doc["doc_id"],
                    "doc_type": doc["doc_type"],
                    "source_ref": doc["source_ref"],
                    "excerpt": doc["text"][:280],
                    "match_score": r.score,
                    "success": doc["success"],
                }
            )
            rank += 1

        # Serendipitous graph evidence not already surfaced by text retrieval
        for g in graph_evidence:
            if g["fix_action"] in seen_fix_actions:
                continue
            if not g["success"]:
                continue
            seen_fix_actions.add(g["fix_action"])
            steps.append(
                {
                    "type": "related_via_graph",
                    "text": g["fix_action"],
                    "outcome_note": f"Connected via the fault graph through symptom "
                    f"'{g['via_symptom']}' rather than direct text match.",
                    "citation_doc_id": g["supporting_doc_ids"][0] if g["supporting_doc_ids"] else None,
                }
            )
            if g["supporting_doc_ids"]:
                doc = self.retriever.get_document(g["supporting_doc_ids"][0])
                if doc:
                    citations.append(
                        {
                            "doc_id": doc["doc_id"],
                            "doc_type": doc["doc_type"],
                            "source_ref": doc["source_ref"],
                            "excerpt": doc["text"][:280],
                            "match_score": None,
                            "success": doc["success"],
                        }
                    )

        success_rate = (
            sum(1 for c in citations if c["success"]) / len(citations) if citations else 0
        )
        if risk_score is not None and risk_score > 0.7 and success_rate > 0.6:
            confidence = "high"
        elif citations:
            confidence = "medium"
        else:
            confidence = "low"

        return Recommendation(
            asset_id=asset_id,
            component=component,
            risk_score=risk_score,
            operational_state=operational_state,
            safety_note=safety_note,
            steps=steps,
            citations=citations,
            graph_evidence=graph_evidence,
            confidence=confidence,
        )
