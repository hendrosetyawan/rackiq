from fastapi.testclient import TestClient

from backend.app.main import app

client = TestClient(app)


def test_health():
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_assets_and_risk():
    assets = client.get("/api/assets").json()
    assert len(assets) > 0
    risk = client.get("/api/risk").json()
    assert len(risk) == len(assets)
    # sorted descending by risk_score
    scores = [r["risk_score"] for r in risk]
    assert scores == sorted(scores, reverse=True)


def test_alerts_are_subset_of_risk_above_threshold():
    alerts = client.get("/api/alerts").json()
    assert all(a["risk_score"] >= 0.5 for a in alerts)


def test_recommend_unknown_asset_404():
    r = client.post("/api/alerts/NOT-A-REAL-ASSET/recommend")
    assert r.status_code == 404


def test_recommend_known_asset():
    assets = client.get("/api/assets").json()
    asset_id = assets[0]["asset_id"]
    r = client.post(f"/api/alerts/{asset_id}/recommend")
    assert r.status_code == 200
    body = r.json()
    assert body["asset_id"] == asset_id
    assert "citations" in body


def test_copilot_query():
    r = client.post("/api/copilot", json={"query": "PSU voltage dropping", "top_k": 3})
    assert r.status_code == 200
    body = r.json()
    assert len(body["citations"]) > 0


def test_evidence_lookup():
    docs = client.get("/api/copilot")  # method not allowed check not needed; skip
    r = client.post("/api/copilot", json={"query": "disk sector", "top_k": 1})
    doc_id = r.json()["citations"][0]["doc_id"]
    ev = client.get(f"/api/evidence/{doc_id}")
    assert ev.status_code == 200
    assert ev.json()["doc_id"] == doc_id
