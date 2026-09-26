"""
Trains one LightGBM failure-risk classifier per component type (DIMM, disk,
PSU, NIC, fan) on the synthetic telemetry, logs each run to a local MLflow
store, and saves model + SHAP explainer + drift reference bins to
backend/app/ml/artifacts/.

Run: python -m backend.app.ml.train   (from the rackiq/ repo root)
"""
from __future__ import annotations

import json
from pathlib import Path

import joblib
import lightgbm as lgb
import mlflow
import numpy as np
import pandas as pd
import shap
from sklearn.metrics import average_precision_score, roc_auc_score
from sklearn.model_selection import GroupShuffleSplit

from .features import COMPONENT_CHANNELS, build_training_table, feature_columns

REPO_ROOT = Path(__file__).resolve().parents[3]
DATA_DIR = REPO_ROOT / "data" / "synthetic"
ARTIFACT_DIR = Path(__file__).parent / "artifacts"
ARTIFACT_DIR.mkdir(exist_ok=True)
MLFLOW_URI = f"sqlite:///{(REPO_ROOT / 'mlflow.db').as_posix()}"
PARAMS = dict(n_estimators=250, num_leaves=15, max_depth=5, learning_rate=0.06, min_child_samples=30,
              subsample=0.8, subsample_freq=1, colsample_bytree=0.9, class_weight="balanced", random_state=42, verbosity=-1)


def drift_reference(X: pd.DataFrame) -> dict:
    """Decile bin edges + proportions per feature, for PSI drift monitoring."""
    ref = {}
    for c in X.columns:
        edges = np.unique(np.quantile(X[c], np.linspace(0, 1, 11)))
        if len(edges) < 3:
            continue
        counts = np.histogram(np.clip(X[c], edges[0], edges[-1]), bins=edges)[0]
        ref[c] = {"edges": edges.tolist(), "props": (counts / counts.sum()).tolist()}
    return ref


def train_component(component: str, telemetry: pd.DataFrame, failure_events: pd.DataFrame) -> dict:
    table = build_training_table(telemetry, failure_events, component)
    cols = feature_columns(component)
    X, y, groups = table[cols], table["label"], table["asset_key"]
    tr, te = next(GroupShuffleSplit(n_splits=1, test_size=0.25, random_state=42).split(X, y, groups))

    model = lgb.LGBMClassifier(**PARAMS)
    model.fit(X.iloc[tr], y.iloc[tr])
    proba = model.predict_proba(X.iloc[te])[:, 1]
    auc = roc_auc_score(y.iloc[te], proba)
    ap = average_precision_score(y.iloc[te], proba)

    joblib.dump(model, ARTIFACT_DIR / f"{component}_model.joblib")
    joblib.dump(shap.TreeExplainer(model), ARTIFACT_DIR / f"{component}_explainer.joblib")
    importance = dict(sorted(zip(cols, model.booster_.feature_importance("gain").tolist()), key=lambda t: -t[1])[:6])

    metrics = dict(component=component, n_rows=int(len(table)), n_positive=int(y.sum()), n_assets=int(groups.nunique()),
                   test_auc=round(float(auc), 4), test_avg_precision=round(float(ap), 4), feature_columns=cols,
                   top_features_gain={k: round(v, 1) for k, v in importance.items()},
                   drift_reference=drift_reference(X.iloc[tr]))

    with mlflow.start_run(run_name=f"rackiq-{component}-failure-risk"):
        mlflow.log_params({"component": component, **{k: v for k, v in PARAMS.items() if k != "verbosity"}})
        mlflow.log_metrics({"test_auc": metrics["test_auc"], "test_avg_precision": metrics["test_avg_precision"],
                            "n_rows": metrics["n_rows"], "n_positive": metrics["n_positive"]})
    return metrics


def main():
    mlflow.set_tracking_uri(MLFLOW_URI)
    mlflow.set_experiment("rackiq-failure-prediction")
    failure_events = pd.read_csv(DATA_DIR / "failure_events.csv")
    summary = {}
    for component in COMPONENT_CHANNELS:
        telemetry = pd.read_parquet(DATA_DIR / "telemetry" / f"{component}.parquet")
        m = train_component(component, telemetry, failure_events)
        summary[component] = m
        print(f"{component:5s} AUC={m['test_auc']} AP={m['test_avg_precision']} positives={m['n_positive']}/{m['n_rows']}")
    with open(ARTIFACT_DIR / "training_summary.json", "w") as f:
        json.dump(summary, f, indent=1)
    print(f"Artifacts -> {ARTIFACT_DIR}")


if __name__ == "__main__":
    main()
