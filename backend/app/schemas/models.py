from __future__ import annotations

from typing import Optional

from pydantic import BaseModel


class AssetRisk(BaseModel):
    asset_id: str
    component: str
    rack_id: str
    server_id: str
    vendor: str
    risk_score: float
    operational_state: str
    top_factors: list[dict]


class TelemetryPoint(BaseModel):
    timestamp: str
    values: dict


class Citation(BaseModel):
    doc_id: str
    doc_type: str
    source_ref: str
    excerpt: str
    match_score: Optional[float] = None
    success: bool


class RecommendationResponse(BaseModel):
    asset_id: str
    component: str
    risk_score: Optional[float]
    operational_state: str
    safety_note: Optional[str]
    steps: list[dict]
    citations: list[Citation]
    confidence: str


class CopilotQuery(BaseModel):
    query: str
    component: Optional[str] = None
    top_k: int = 5


class CopilotResponse(BaseModel):
    query: str
    answer: str
    citations: list[Citation]
