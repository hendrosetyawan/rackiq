"""
Loads trained per-component models + SHAP explainers and scores current
telemetry, returning a failure-risk probability plus the top contributing
features (explainable AI, Theme 1 requirement) for each asset.
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

from .features import COMPONENT_CHANNELS, ROLL_WINDOW, feature_columns

ARTIFACT_DIR = Path(__file__).parent / "artifacts"


@lru_cache(maxsize=None)
def _load_model(component: str):
    return joblib.load(ARTIFACT_DIR / f"{component}_model.joblib")


@lru_cache(maxsize=None)
def _load_explainer(component: str):
    return joblib.load(ARTIFACT_DIR / f"{component}_explainer.joblib")


def _asset_component(asset_id: str) -> str:
    return asset_id.rsplit("-", 1)[-1].lower()


def latest_features_for_asset(telemetry: pd.DataFrame, asset_id: str) -> pd.Series | None:
    """Rebuilds the same rolling features used at train time, for the most recent reading."""
    component = _asset_component(asset_id)
    channels = COMPONENT_CHANNELS[component]
    g = telemetry[telemetry["asset_id"] == asset_id].copy()
    if g.empty:
        return None
    g["timestamp"] = pd.to_datetime(g["timestamp"])
    g = g.sort_values("timestamp").reset_index(drop=True)

    feats = {}
    for ch in channels:
        window = g[ch].rolling(ROLL_WINDOW, min_periods=1)
        feats[f"{ch}_mean"] = window.mean().iloc[-1]
        feats[f"{ch}_max"] = window.max().iloc[-1]
        feats[f"{ch}_slope"] = g[ch].diff().rolling(ROLL_WINDOW, min_periods=1).mean().iloc[-1]
        feats[f"{ch}_latest"] = g[ch].iloc[-1]

    series = pd.Series(feats).fillna(0.0)
    return series


def score_asset(telemetry: pd.DataFrame, asset_id: str) -> dict | None:
    component = _asset_component(asset_id)
    if component not in COMPONENT_CHANNELS:
        return None

    feats = latest_features_for_asset(telemetry, asset_id)
    if feats is None:
        return None

    cols = feature_columns(component)
    X = feats[cols].to_frame().T

    model = _load_model(component)
    explainer = _load_explainer(component)

    risk = float(model.predict_proba(X)[:, 1][0])
    shap_values = explainer.shap_values(X)
    # lightgbm binary classifier -> shap_values may be a list [class0, class1] or single array
    sv = shap_values[1][0] if isinstance(shap_values, list) else shap_values[0]

    contributions = sorted(
        zip(cols, sv.tolist(), X.iloc[0].tolist()),
        key=lambda t: abs(t[1]),
        reverse=True,
    )[:4]

    return {
        "asset_id": asset_id,
        "component": component,
        "risk_score": round(risk, 4),
        "top_factors": [
            {"feature": f, "shap_contribution": round(float(v), 4), "value": round(float(val), 3)}
            for f, v, val in contributions
        ],
    }


def score_all_assets(telemetry: pd.DataFrame, assets: pd.DataFrame) -> list[dict]:
    results = []
    for asset_id in assets["asset_id"]:
        r = score_asset(telemetry, asset_id)
        if r:
            results.append(r)
    results.sort(key=lambda r: r["risk_score"], reverse=True)
    return results
