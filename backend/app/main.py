"""
RackIQ backend API (v2: 100-rack DCIM + predictive maintenance copilot).

Run from the rackiq/ repo root, after `bash scripts/seed_all.sh`:

    uvicorn backend.app.main:app --reload --port 8000
"""
from __future__ import annotations

from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .fleet import get_fleet

app = FastAPI(title="RackIQ API", version="0.2.0",
              description="Predictive hardware failure & cited RCA recommendation copilot -- prototype backend")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
                   allow_methods=["*"], allow_headers=["*"])


class CopilotQuery(BaseModel):
    query: str
    component: Optional[str] = None
    top_k: int = 5


def _or_404(value, what):
    if value is None:
        raise HTTPException(status_code=404, detail=f"Unknown {what}")
    return value


@app.get("/api/health")
def health():
    return {"status": "ok"}


# ---- Command center
@app.get("/api/overview")
def overview():
    return get_fleet().overview()


@app.get("/api/floor")
def floor():
    return get_fleet().floor()


# ---- Operations
@app.get("/api/servers")
def servers():
    return get_fleet().servers_view()


@app.get("/api/telemetry/facility")
def facility():
    return get_fleet().facility_view()


@app.get("/api/telemetry/thermal-matrix")
def thermal_matrix():
    return get_fleet().thermal_matrix()


@app.get("/api/model-telemetry")
def model_telemetry():
    return get_fleet().model_telemetry()


# ---- Maintenance
@app.get("/api/workorders")
def workorders(min_risk: float = 0.25):
    return get_fleet().workorders(min_risk)


@app.get("/api/forecast")
def forecast():
    return get_fleet().forecast()


@app.get("/api/assets/{asset_id}")
def asset_detail(asset_id: str, n: int = 120):
    return _or_404(get_fleet().asset_detail(asset_id, n), f"asset {asset_id}")


@app.post("/api/alerts/{asset_id}/recommend")
def recommend(asset_id: str):
    return _or_404(get_fleet().recommend(asset_id), f"asset {asset_id}")


@app.post("/api/copilot")
def copilot(payload: CopilotQuery):
    return get_fleet().copilot(payload.query, payload.component, payload.top_k)


@app.get("/api/evidence/{doc_id}")
def evidence(doc_id: str):
    return _or_404(get_fleet().retriever.get_document(doc_id), f"document {doc_id}")


@app.get("/api/graph/stats")
def graph_stats():
    return get_fleet().graph_stats()


# ---- Event log
@app.get("/api/incidents")
def incidents():
    return get_fleet().incidents_view()


@app.get("/api/events")
def events(days: int = 7):
    return get_fleet().events_view(days)


# ---- Inventory
@app.get("/api/inventory")
def inventory():
    return get_fleet().inventory_view()


@app.get("/api/inventory/history")
def inventory_history():
    return get_fleet().inventory_history()


@app.get("/api/inventory/consumption")
def consumption():
    return get_fleet().consumption()
