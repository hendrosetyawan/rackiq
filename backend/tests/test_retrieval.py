from backend.app.knowledge.retrieval import HybridRetriever


def test_retriever_loads_and_filters_by_component():
    retriever = HybridRetriever.from_jsonl()
    results = retriever.search("elevated ECC errors on DIMM", component="dimm", top_k=5)
    assert len(results) > 0
    assert all(r.doc["component"] == "dimm" for r in results)


def test_retriever_success_boost_orders_working_fixes_higher():
    retriever = HybridRetriever.from_jsonl()
    # isolate the success-rate signal from text-match strength by zeroing the
    # other two weights -- this is the ranking factor under test.
    results = retriever.search(
        "link flap crc errors nic", component="nic", top_k=8, bm25_weight=0.0, vector_weight=0.0, success_weight=1.0
    )
    assert len(results) > 0
    assert results[0].doc["success"] is True


def test_get_document_roundtrip():
    retriever = HybridRetriever.from_jsonl()
    any_doc_id = retriever.documents[0]["doc_id"]
    doc = retriever.get_document(any_doc_id)
    assert doc is not None
    assert doc["doc_id"] == any_doc_id
