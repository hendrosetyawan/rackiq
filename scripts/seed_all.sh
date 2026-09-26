#!/usr/bin/env bash
# Regenerates all synthetic data (100-rack floor, telemetry, 12-month incident KB,
# spare-parts inventory), retrains the five component models and runs the tests.
# Run from the repo root: bash scripts/seed_all.sh   (~1-2 minutes)
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== 1/5 Floor layout + telemetry (100 racks, 800 servers, 4,000 components, 90 days) =="
(cd data/synthetic && python3 generate_telemetry.py)

echo "== 2/5 Knowledge base: 12 months of incidents, RCAs, manuals, emails =="
(cd data/synthetic && python3 generate_knowledge_base.py)

echo "== 3/5 Spare-parts warehouse simulation =="
(cd data/synthetic && python3 generate_inventory.py > /dev/null && echo "inventory written")

echo "== 4/5 Training per-component failure models (LightGBM + SHAP, MLflow) =="
MLFLOW_DISABLE_AGENT_HINT=1 python3 -m backend.app.ml.train 2>&1 | grep -v "INFO"

echo "== 5/5 Tests =="
python3 -m pytest backend/tests -q -p no:warnings

echo "Done. Start the API with: uvicorn backend.app.main:app --reload --port 8000"
