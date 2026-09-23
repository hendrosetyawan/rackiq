from backend.app.agent.recommend import RecommendationAgent
from backend.app.knowledge.graph import FaultKnowledgeGraph
from backend.app.knowledge.retrieval import HybridRetriever


def _agent():
    return RecommendationAgent(HybridRetriever.from_jsonl(), FaultKnowledgeGraph.from_jsonl())


def test_recommend_includes_safety_note_for_dr_failover():
    rec = _agent().recommend(
        asset_id="AST-0001-DISK",
        component="disk",
        operational_state="dr_failover",
        risk_score=0.9,
        top_factors=[{"feature": "reallocated_sectors_mean", "shap_contribution": 1.2, "value": 5}],
    )
    assert rec.safety_note is not None
    assert any(s["type"] == "safety" for s in rec.steps)
    assert len(rec.citations) > 0


def test_recommend_no_safety_note_when_normal():
    rec = _agent().recommend(asset_id="AST-0002-NIC", component="nic", operational_state="normal")
    assert rec.safety_note is None
    assert not any(s["type"] == "safety" for s in rec.steps)


def test_recommend_citations_reference_real_docs():
    retriever = HybridRetriever.from_jsonl()
    rec = _agent().recommend(asset_id="AST-0003-PSU", component="psu", operational_state="migration")
    for c in rec.citations:
        assert retriever.get_document(c["doc_id"]) is not None
