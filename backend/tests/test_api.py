from fastapi.testclient import TestClient

from backend.app.main import app

client = TestClient(app)


def test_health():
    assert client.get("/api/health").json() == {"status": "ok"}


def test_overview_counts_match_floor():
    o = client.get("/api/overview").json()
    assert o["counts"] == {"racks": 100, "servers": 800, "components": 4000}
    floor = client.get("/api/floor").json()
    assert len(floor["racks"]) == 100
    assert all(len(r["slots"]) == 8 for r in floor["racks"])
    assert sum(o["server_tiers"].values()) == 800


def test_workorders_sorted_and_actionable():
    wo = client.get("/api/workorders").json()
    assert wo
    scores = [w["priority_score"] for w in wo]
    assert scores == sorted(scores, reverse=True)


def test_asset_detail_and_recommend():
    aid = client.get("/api/workorders").json()[0]["asset_id"]
    d = client.get(f"/api/assets/{aid}").json()
    assert d["asset_id"] == aid and len(d["series"]["timestamp"]) > 0
    rec = client.post(f"/api/alerts/{aid}/recommend").json()
    assert rec["asset_id"] == aid and rec["citations"]


def test_unknown_asset_404():
    assert client.get("/api/assets/NOPE").status_code == 404
    assert client.post("/api/alerts/NOPE/recommend").status_code == 404


def test_inventory_links_predictions_to_stock():
    inv = client.get("/api/inventory").json()
    assert len(inv) == 16
    assert {"stockout_risk", "reorder", "healthy", "overstock"} >= {i["status"] for i in inv}
    assert any(i["linked_assets"] for i in inv)
    hist = client.get("/api/inventory/history").json()
    assert set(hist) == {i["sku"] for i in inv}


def test_event_log_and_incidents():
    assert len(client.get("/api/incidents").json()) > 1000
    ev = client.get("/api/events?days=7").json()
    assert ev and {"source", "severity", "message"} <= set(ev[0])


def test_operations_views():
    assert len(client.get("/api/servers").json()) == 800
    tm = client.get("/api/telemetry/thermal-matrix").json()
    assert len(tm["racks"]) == 100 and len(tm["dates"]) >= 90
    mt = client.get("/api/model-telemetry").json()
    assert set(mt["models"]) == {"dimm", "disk", "psu", "nic", "fan"}


def test_copilot_returns_distinct_cited_fixes():
    r = client.post("/api/copilot", json={"query": "PSU output ripple rising", "top_k": 3}).json()
    tids = [c["template_id"] for c in r["citations"]]
    assert tids and len(tids) == len(set(tids))
