#!/usr/bin/env bash
# Regenerates all synthetic data and retrains every component's failure model.
# Run from the repo root: bash scripts/seed_all.sh
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== Generating synthetic telemetry, assets, failure events, operational context =="
python3 data/synthetic/generate_telemetry.py

echo "== Generating synthetic RCA/ticket/manual/email knowledge base =="
python3 data/synthetic/generate_knowledge_base.py

echo "== Training per-component failure-risk models (LightGBM + SHAP, logged to MLflow) =="
MLFLOW_DISABLE_AGENT_HINT=1 python3 -m backend.app.ml.train

echo "== Running backend test suite =="
python3 -m pytest backend/tests -q

echo "Done. Start the API with: uvicorn backend.app.main:app --reload --port 8000"
