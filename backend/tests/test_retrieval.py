from backend.app.knowledge.graph import FaultKnowledgeGraph
from backend.app.knowledge.retrieval import HybridRetriever


def test_retriever_filters_by_component():
    r = HybridRetriever.from_jsonl()
    res = r.search("correctable ECC errors climbing", component="dimm", top_k=10)
    assert res and all(x.doc["component"] == "dimm" for x in res)


def test_durable_rate_drives_ranking_when_isolated():
    r = HybridRetriever.from_jsonl(durable_rate={"nic_sfp": 0.95, "nic_driver_reset": 0.2})
    res = r.search("link flap crc errors", component="nic", top_k=50, bm25_weight=0, vector_weight=0, success_weight=1)
    assert res[0].doc["template_id"] != "nic_driver_reset"


def test_knowledge_base_spans_a_year():
    r = HybridRetriever.from_jsonl()
    dates = sorted(d["date"] for d in r.documents if d["doc_type"] == "ticket")
    assert dates[0] < "2025-10-15" and dates[-1] > "2026-09-01"
    assert len(r.documents) > 1500


def test_graph_links_symptoms_to_fixes():
    g = FaultKnowledgeGraph.from_jsonl()
    fixes = g.related_fixes("fan", ["fan_vibration"])
    assert any(f["template_id"] == "fan_bearing" for f in fixes)
