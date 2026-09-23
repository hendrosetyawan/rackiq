"""
Trains one gradient-boosted failure-risk classifier per component type
(DIMM, disk, PSU, NIC) on the synthetic telemetry, logs each run to a local
MLflow tracking store, and saves the model + SHAP explainer + feature list
to backend/app/ml/artifacts/ for the API to load at request time.

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

from .features import COMPONENT_CHANNELS, TAIL_HOLDOUT_READINGS, build_feature_table, feature_columns

REPO_ROOT = Path(__file__).resolve().parents[3]
DATA_DIR = REPO_ROOT / "data" / "synthetic"
ARTIFACT_DIR = Path(__file__).parent / "artifacts"
ARTIFACT_DIR.mkdir(exist_ok=True)

MLFLOW_URI = f"sqlite:///{(REPO_ROOT / 'mlflow.db').as_posix()}"


def train_component(component: str, telemetry: pd.DataFrame, failure_events: pd.DataFrame) -> dict:
    table = build_feature_table(
        telemetry, failure_events, component, exclude_tail_readings=TAIL_HOLDOUT_READINGS
    )
    cols = feature_columns(component)
    X = table[cols]
    y = table["label"]
    groups = table["asset_id"]

    if y.sum() < 5:
        raise ValueError(f"Not enough positive labels for {component}: {y.sum()}")

    splitter = GroupShuffleSplit(n_splits=1, test_size=0.25, random_state=42)
    train_idx, test_idx = next(splitter.split(X, y, groups))
    X_train, X_test = X.iloc[train_idx], X.iloc[test_idx]
    y_train, y_test = y.iloc[train_idx], y.iloc[test_idx]

    model = lgb.LGBMClassifier(
        n_estimators=200,
        num_leaves=15,
        max_depth=4,
        learning_rate=0.08,
        min_child_samples=20,
        class_weight="balanced",
        random_state=42,
        verbosity=-1,
    )
    model.fit(X_train, y_train)

    proba = model.predict_proba(X_test)[:, 1]
    auc = roc_auc_score(y_test, proba) if y_test.nunique() > 1 else float("nan")
    ap = average_precision_score(y_test, proba) if y_test.nunique() > 1 else float("nan")

    explainer = shap.TreeExplainer(model)

    model_path = ARTIFACT_DIR / f"{component}_model.joblib"
    explainer_path = ARTIFACT_DIR / f"{component}_explainer.joblib"
    joblib.dump(model, model_path)
    joblib.dump(explainer, explainer_path)

    metrics = {
        "component": component,
        "n_rows": int(len(table)),
        "n_positive": int(y.sum()),
        "n_assets": int(groups.nunique()),
        "test_auc": None if np.isnan(auc) else round(float(auc), 4),
        "test_avg_precision": None if np.isnan(ap) else round(float(ap), 4),
        "feature_columns": cols,
    }

    with mlflow.start_run(run_name=f"rackiq-{component}-failure-risk"):
        mlflow.log_params(
            {
                "component": component,
                "n_estimators": 200,
                "num_leaves": 15,
                "max_depth": 4,
                "learning_rate": 0.08,
            }
        )
        mlflow.log_metrics(
            {k: v for k, v in metrics.items() if isinstance(v, (int, float)) and v is not None}
        )
        mlflow.log_artifact(str(model_path))
        mlflow.log_artifact(str(explainer_path))

    return metrics


def main():
    mlflow.set_tracking_uri(MLFLOW_URI)
    mlflow.set_experiment("rackiq-failure-prediction")

    telemetry = pd.read_csv(DATA_DIR / "telemetry.csv")
    failure_events = pd.read_csv(DATA_DIR / "failure_events.csv")

    all_metrics = {}
    for component in COMPONENT_CHANNELS:
        print(f"Training {component} model...")
        metrics = train_component(component, telemetry, failure_events)
        all_metrics[component] = metrics
        print(f"  -> AUC={metrics['test_auc']} AP={metrics['test_avg_precision']} "
              f"positives={metrics['n_positive']}/{metrics['n_rows']}")

    with open(ARTIFACT_DIR / "training_summary.json", "w") as f:
        json.dump(all_metrics, f, indent=2)

    print(f"\nArtifacts written to {ARTIFACT_DIR}")
    print(f"MLflow runs logged to {MLFLOW_URI} (experiment: rackiq-failure-prediction)")


if __name__ == "__main__":
    main()
