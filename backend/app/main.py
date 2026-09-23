"""
RackIQ backend API.

Run (from the rackiq/ repo root, after `python -m backend.app.ml.train` has
produced model artifacts):

    uvicorn backend.app.main:app --reload --port 8000
"""
from __future__ import annotations

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .agent.recommend import RecommendationAgent
from .data.loader import (
    context_for_rack,
    get_fault_graph,
    get_retriever,
    load_assets,
    load_operational_context,
    load_telemetry,
    rack_for_asset,
)
from .ml.predict import score_all_assets, score_asset
from .schemas.models import CopilotQuery, CopilotResponse, RecommendationResponse

app = FastAPI(
    title="RackIQ API",
    description="Predictive Hardware Failure & RCA Recommendation Copilot -- prototype backend",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

RISK_ALERT_THRESHOLD = 0.5


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/assets")
def list_assets():
    assets = load_assets()
    return assets.to_dict(orient="records")


@app.get("/api/context")
def list_context():
    return load_operational_context().to_dict(orient="records")


@app.get("/api/context/{rack_id}")
def get_context(rack_id: str):
    return {"rack_id": rack_id, "operational_state": context_for_rack(rack_id)}


@app.get("/api/risk")
def get_risk():
    """Current predicted failure risk for every monitored asset, highest first."""
    assets = load_assets()
    telemetry = load_telemetry()
    scored = score_all_assets(telemetry, assets)

    asset_meta = assets.set_index("asset_id").to_dict(orient="index")
    out = []
    for s in scored:
        meta = asset_meta.get(s["asset_id"], {})
        out.append(
            {
                **s,
                "rack_id": meta.get("rack_id"),
                "server_id": meta.get("server_id"),
                "vendor": meta.get("vendor"),
                "operational_state": context_for_rack(meta.get("rack_id", "")),
            }
        )
    return out


@app.get("/api/alerts")
def get_alerts():
    """Assets currently above the risk-alert threshold."""
    risk = get_risk()
    return [r for r in risk if r["risk_score"] >= RISK_ALERT_THRESHOLD]


@app.get("/api/telemetry/{asset_id}")
def get_telemetry(asset_id: str, limit: int = 60):
    telemetry = load_telemetry()
    g = telemetry[telemetry["asset_id"] == asset_id].sort_values("timestamp")
    if g.empty:
        raise HTTPException(status_code=404, detail=f"No telemetry for asset {asset_id}")
    # Other component types' columns are NaN for this asset (wide-format CSV);
    # drop all-NaN columns and convert remaining NaN to None for valid JSON.
    tail = g.tail(limit).dropna(axis=1, how="all")
    return tail.where(tail.notna(), None).to_dict(orient="records")


@app.post("/api/alerts/{asset_id}/recommend", response_model=RecommendationResponse)
def recommend_for_asset(asset_id: str):
    assets = load_assets()
    telemetry = load_telemetry()
    row = assets[assets["asset_id"] == asset_id]
    if row.empty:
        raise HTTPException(status_code=404, detail=f"Unknown asset {asset_id}")
    component = row.iloc[0]["component"]
    rack_id = row.iloc[0]["rack_id"]

    scored = score_asset(telemetry, asset_id)
    risk_score = scored["risk_score"] if scored else None
    top_factors = scored["top_factors"] if scored else None

    agent = RecommendationAgent(get_retriever(), get_fault_graph())
    rec = agent.recommend(
        asset_id=asset_id,
        component=component,
        operational_state=context_for_rack(rack_id),
        risk_score=risk_score,
        top_factors=top_factors,
    )
    return RecommendationResponse(
        asset_id=rec.asset_id,
        component=rec.component,
        risk_score=rec.risk_score,
        operational_state=rec.operational_state,
        safety_note=rec.safety_note,
        steps=rec.steps,
        citations=rec.citations,
        confidence=rec.confidence,
    )


@app.post("/api/copilot", response_model=CopilotResponse)
def copilot_query(payload: CopilotQuery):
    """Free-text incident copilot: ask a troubleshooting question, get a
    cited, templated answer assembled from the retrieved evidence (no
    external LLM call in this prototype -- see docs/TECHNICAL_DOCUMENTATION.md)."""
    retriever = get_retriever()
    # Search a wider pool, then dedupe near-identical fixes (the synthetic KB
    # has several phrasing variants per underlying fix) down to top_k distinct
    # recommendations, highest-scored variant of each kept.
    candidates = retriever.search(payload.query, component=payload.component, top_k=max(payload.top_k * 4, 10))
    seen_fix_actions = set()
    results = []
    relevance_floor = candidates[0].score * 0.3 if candidates else 0  # drop low-relevance padding
    for r in candidates:
        if r.doc["fix_action"] in seen_fix_actions or r.score < relevance_floor:
            continue
        seen_fix_actions.add(r.doc["fix_action"])
        results.append(r)
        if len(results) >= payload.top_k:
            break

    if not results:
        return CopilotResponse(query=payload.query, answer="No relevant historical incidents found.", citations=[])

    lines = [f"Found {len(results)} relevant historical record(s):"]
    citations = []
    for i, r in enumerate(results, start=1):
        doc = r.doc
        outcome = "resolved the issue" if doc["success"] else "did NOT durably resolve the issue"
        lines.append(f"{i}. [{doc['doc_id']}] {doc['fix_action']} -- this {outcome} previously.")
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
    return CopilotResponse(query=payload.query, answer="\n".join(lines), citations=citations)


@app.get("/api/evidence/{doc_id}")
def get_evidence(doc_id: str):
    doc = get_retriever().get_document(doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail=f"Unknown document {doc_id}")
    return doc


@app.get("/api/graph/stats")
def graph_stats():
    return get_fault_graph().stats()
