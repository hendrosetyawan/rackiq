from backend.app.agent.recommend import symptoms_from_factors
from backend.app.fleet import get_fleet


def _asset(tier="critical", state=None):
    f = get_fleet()
    av = f.asset_view
    sel = av[av.tier == tier]
    if state:
        sel = sel[sel.state == state]
    return f, sel.index[0]


def test_symptoms_follow_positive_shap_drivers():
    factors = [{"feature": "io_latency_ms_mean", "shap_contribution": 2.1, "value": 6},
               {"feature": "temp_c_max", "shap_contribution": -0.4, "value": 38}]
    assert symptoms_from_factors("disk", factors) == ["latency_spike"]


def test_recommendation_cites_real_documents_and_has_track_record():
    f, aid = _asset("critical")
    rec = f.recommend(aid)
    assert rec["citations"]
    for c in rec["citations"]:
        assert f.retriever.get_document(c["doc_id"]) is not None
    actions = [s for s in rec["steps"] if s["type"] == "action"]
    assert actions and actions[0]["stats"]["n"] > 0


def test_context_adds_safety_step():
    f = get_fleet()
    hot = f.asset_view[(f.asset_view.state != "normal") & (f.asset_view.state != "maintenance_window")]
    rec = f.recommend(hot.index[0])
    assert rec["steps"][0]["type"] == "safety"


def test_low_durability_fix_is_flagged_not_primary():
    f = get_fleet()
    rec = f.agent.recommend("A01-S1-DIMM", "dimm", "normal", 0.9,
                            [{"feature": "ecc_correctable_24h_mean", "shap_contribution": 3.0, "value": 30}])
    types = {s.get("template_id"): s["type"] for s in rec.steps if s.get("template_id")}
    if "dimm_reseat" in types:
        assert types["dimm_reseat"] == "caution"
    first_action = next(s for s in rec.steps if s["type"] in ("action", "caution"))
    assert first_action["type"] == "action"
