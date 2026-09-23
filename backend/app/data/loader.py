"""Cached loaders for synthetic telemetry/asset/context data and the KB-backed
retriever + fault graph, shared across API request handlers."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import pandas as pd

from ..knowledge.graph import FaultKnowledgeGraph
from ..knowledge.retrieval import HybridRetriever

REPO_ROOT = Path(__file__).resolve().parents[3]
SYNTH_DIR = REPO_ROOT / "data" / "synthetic"


@lru_cache(maxsize=1)
def load_assets() -> pd.DataFrame:
    return pd.read_csv(SYNTH_DIR / "assets.csv")


@lru_cache(maxsize=1)
def load_telemetry() -> pd.DataFrame:
    return pd.read_csv(SYNTH_DIR / "telemetry.csv")


@lru_cache(maxsize=1)
def load_failure_events() -> pd.DataFrame:
    return pd.read_csv(SYNTH_DIR / "failure_events.csv")


@lru_cache(maxsize=1)
def load_operational_context() -> pd.DataFrame:
    return pd.read_csv(SYNTH_DIR / "operational_context.csv")


@lru_cache(maxsize=1)
def get_retriever() -> HybridRetriever:
    return HybridRetriever.from_jsonl()


@lru_cache(maxsize=1)
def get_fault_graph() -> FaultKnowledgeGraph:
    return FaultKnowledgeGraph.from_jsonl()


def context_for_rack(rack_id: str) -> str:
    ctx = load_operational_context()
    row = ctx[ctx["rack_id"] == rack_id]
    if row.empty:
        return "normal"
    return row.iloc[0]["operational_state"]


def rack_for_asset(asset_id: str) -> str | None:
    assets = load_assets()
    row = assets[assets["asset_id"] == asset_id]
    if row.empty:
        return None
    return row.iloc[0]["rack_id"]
