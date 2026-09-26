"""
Batch scoring of the whole fleet: loads the per-component models and SHAP
explainers, scores every asset's most recent reading, and returns risk,
top contributing factors (explainable AI) and AI-telemetry about the models
themselves (inference latency, confidence, feature drift).
"""
from __future__ import annotations

import json
import time
from functools import lru_cache
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

from .features import COMPONENT_CHANNELS, feature_columns, latest_features

ARTIFACT_DIR = Path(__file__).parent / "artifacts"


@lru_cache(maxsize=None)
def _model(component):
    return joblib.load(ARTIFACT_DIR / f"{component}_model.joblib")


@lru_cache(maxsize=None)
def _explainer(component):
    return joblib.load(ARTIFACT_DIR / f"{component}_explainer.joblib")


@lru_cache(maxsize=1)
def training_summary() -> dict:
    with open(ARTIFACT_DIR / "training_summary.json") as f:
        return json.load(f)


ANOMALY_Z_WATCH = 3.0


def risk_tier(r: float, z: float = 0.0) -> str:
    """Status tier from 72h failure risk plus the telemetry anomaly index:
    'watch' also covers components that deviate from the fleet baseline but
    are not (yet) predicted to fail within 72 h."""
    if r >= 0.75:
        return "critical"
    if r >= 0.5 or (r >= 0.1 and z >= ANOMALY_Z_WATCH):
        return "warning"
    if r >= 0.25 or z >= ANOMALY_Z_WATCH:
        return "watch"
    return "healthy"


def anomaly_z(feats: pd.DataFrame, component: str) -> pd.Series:
    """Robust deviation of each asset's 2-day channel means from the fleet
    baseline (median / MAD, floored at half a standard deviation); max over channels."""
    zs = []
    for ch in COMPONENT_CHANNELS[component]:
        v = feats[f"{ch}_mean"]
        med = v.median()
        scale = max(1.4826 * (v - med).abs().median(), 0.5 * v.std(), 1e-3)
        zs.append(((v - med) / scale).abs())
    return pd.concat(zs, axis=1).max(axis=1)


def psi(ref: dict, values: np.ndarray) -> float:
    edges = np.array(ref["edges"])
    cur = np.histogram(np.clip(values, edges[0], edges[-1]), bins=edges)[0] / max(len(values), 1)
    exp = np.array(ref["props"])
    cur, exp = np.clip(cur, 1e-4, None), np.clip(exp, 1e-4, None)
    return float(np.sum((cur - exp) * np.log(cur / exp)))


def score_fleet(telemetry: dict[str, pd.DataFrame]) -> tuple[pd.DataFrame, dict]:
    """telemetry: component -> long telemetry DataFrame.
    Returns (scores indexed by asset_id, ai_telemetry dict per component)."""
    frames, ai = [], {}
    summary = training_summary()
    for comp in COMPONENT_CHANNELS:
        cols = feature_columns(comp)
        t0 = time.perf_counter()
        feats = latest_features(telemetry[comp], comp)
        X = feats[cols]
        proba = _model(comp).predict_proba(X)[:, 1]
        t_pred = time.perf_counter() - t0
        sv = _explainer(comp).shap_values(X)
        sv = sv[1] if isinstance(sv, list) else sv
        order = np.argsort(-np.abs(sv), axis=1)[:, :4]
        top = [[{"feature": cols[k], "shap_contribution": round(float(sv[i, k]), 3), "value": round(float(X.iat[i, k]), 3)}
                for k in order[i]] for i in range(len(X))]
        z = anomaly_z(feats, comp).reindex(X.index)
        frames.append(pd.DataFrame({"asset_id": X.index, "component": comp, "risk_score": np.round(proba, 4),
                                    "anomaly_z": np.round(z.values, 2),
                                    "health_index": (100 - np.clip((z.values - 1.5) * 12, 0, 100)).round(0), "top_factors": top}))
        ref = summary[comp].get("drift_reference", {})
        drift = {c: round(psi(ref[c], X[c].values), 4) for c in cols if c in ref}
        conf = np.maximum(proba, 1 - proba)
        ai[comp] = dict(model="LightGBM", test_auc=summary[comp]["test_auc"], test_avg_precision=summary[comp]["test_avg_precision"],
                        n_scored=int(len(X)), inference_ms_total=round(t_pred * 1000, 1),
                        inference_us_per_asset=round(t_pred * 1e6 / max(len(X), 1), 1),
                        mean_confidence=round(float(conf.mean()), 4), low_confidence_share=round(float((conf < 0.8).mean()), 4),
                        psi_max=round(max(drift.values()), 4) if drift else 0.0,
                        psi_mean=round(float(np.mean(list(drift.values()))), 4) if drift else 0.0,
                        drift_top=dict(sorted(drift.items(), key=lambda t: -t[1])[:3]),
                        top_features_gain=summary[comp].get("top_features_gain", {}))
    scores = pd.concat(frames, ignore_index=True).set_index("asset_id")
    scores["tier"] = [risk_tier(r, z) for r, z in zip(scores.risk_score, scores.anomaly_z)]
    return scores, ai
