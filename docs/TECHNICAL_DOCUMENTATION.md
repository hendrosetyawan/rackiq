# Technical Documentation &mdash; RackIQ Prototype

## 1. Architecture overview

```
data/synthetic/generate_telemetry.py ──┐
                                        ├──> data/synthetic/*.csv ──> backend/app/ml (train.py, predict.py)
data/synthetic/generate_knowledge_base.py ─> data/kb/documents.jsonl ─┬─> backend/app/knowledge/retrieval.py (BM25 + TF-IDF)
                                                                       └─> backend/app/knowledge/graph.py (networkx fault graph)

backend/app/ml/predict.py ──┐
backend/app/knowledge/*.py ─┼──> backend/app/agent/recommend.py ──> backend/app/main.py (FastAPI) ──> frontend/ (React)
```

Everything runs as a single Python process (FastAPI) plus a single Node dev server (Vite/React),
communicating over `/api/*` (proxied by Vite in dev). There is no database server, message queue,
or external service dependency in this build &mdash; all state is CSV/JSONL files loaded into
memory (see "Scaling" below for why that's fine for a prototype and what changes first in
production).

## 2. Data layer

### 2.1 Synthetic telemetry (`data/synthetic/generate_telemetry.py`)

Simulates 12 racks &times; 8 slots &times; 4 component types (DIMM/disk/PSU/NIC) = 384 monitored
components, each with 90 days of history at 4 readings/day (6-hourly), matching the cadence a
real Redfish/SNMP poller would produce.

- **Healthy baseline**: each channel (e.g. `ecc_correctable_24h`, `reallocated_sectors`,
  `input_voltage_v`, `link_flap_count_24h`) is drawn from a channel-appropriate distribution
  (Poisson for count-like error channels, Normal for continuous readings like voltage/temp/RPM).
- **Historical failure precursors**: ~20% of components get a randomly-placed degradation window
  (2-10 days) with an accelerating severity curve (`severity = day_frac ** 1.5`) culminating in a
  labeled failure event. These are used for **training labels**.
- **Live/current degradation** (`CURRENT_TAIL_READINGS = 16`, i.e. the most recent 4 days): a
  separate ~16% of the *remaining* components are placed into an **ongoing, not-yet-failed**
  degradation trajectory that ramps to a randomized target severity by the very last reading.
  These have **no failure event recorded** (the failure hasn't happened) and are excluded from
  training (see `TAIL_HOLDOUT_READINGS` in `backend/app/ml/features.py`, which must match). This
  is what makes `/api/risk` and `/api/alerts` show a realistic, varied set of *actionable* alerts
  right now, instead of only fully-resolved historical failures that no longer look at-risk.

Output: `assets.csv`, `telemetry.csv` (wide format, one row per asset per timestamp, only the
component's own channels populated), `failure_events.csv`, `operational_context.csv` (which racks
are currently in a migration / backup window / DR failover &mdash; 3 of 12 racks are marked "hot"
for the demo).

### 2.2 Synthetic knowledge base (`data/synthetic/generate_knowledge_base.py`)

8 hand-authored fault "templates" (one root cause + fix action + symptom tags per template,
covering both successful and *unsuccessful* first-response patterns, e.g. "reseating a DIMM only
masks the problem for 48 hours") &times; 6 randomized variants each (varied technician, ticket
number, rack/server, vendor, and rendered as one of `ticket` / `rca` / `manual` / `email` document
types) = 48 documents. Each carries structured metadata (`component`, `symptom_tags`,
`root_cause`, `fix_action`, `success: bool`, `source_ref`) alongside free-text `text` body, so the
retrieval and graph layers have something realistic to index without needing a real
organization's incident corpus.

## 3. Predictive failure-scoring layer (`backend/app/ml/`)

- **`features.py`**: per-component rolling-window feature engineering (`ROLL_WINDOW = 8` readings
  = 2 days: mean, max, slope via `.diff().rolling().mean()`, and latest value, per telemetry
  channel). Labels a row `1` if a real failure event occurs within `FAILURE_HORIZON_READINGS = 12`
  readings (3 days) &mdash; i.e. "will this fail in the next 3 days?"
- **`train.py`**: one `LightGBMClassifier` per component type (`class_weight="balanced"` since
  positives are ~1-3% of rows), grouped train/test split by `asset_id` (`GroupShuffleSplit`) so no
  asset's readings leak across the split, logged to a local MLflow tracking store
  (`sqlite:///mlflow.db`, experiment `rackiq-failure-prediction`). A `shap.TreeExplainer` is
  fitted and saved alongside each model. Current held-out metrics (synthetic data, expect these to
  look better than a real deployment would): DIMM AUC 0.991, disk AUC 0.999, PSU AUC 0.993, NIC
  AUC 0.999 &mdash; see `backend/app/ml/artifacts/training_summary.json` for the full breakdown.
- **`predict.py`**: rebuilds the same rolling features for an asset's *most recent* reading,
  scores it, and returns the top-4 SHAP-contributing features (explainable AI, not just a bare
  probability) &mdash; this is what powers the "driven mainly by: ..." line in every recommendation.

## 4. Knowledge & retrieval layer (`backend/app/knowledge/`)

- **`retrieval.py` &mdash; `HybridRetriever`**: BM25 (`rank_bm25.BM25Okapi`) over tokenized
  document text, blended with TF-IDF cosine similarity (`sklearn.TfidfVectorizer` +
  `cosine_similarity`) as a **lightweight local stand-in for a dense sentence-embedding
  retriever** (documented explicitly &mdash; see "Upgrade path" below), plus a historical
  success-rate boost (`+0.15` for fixes that resolved the issue, `-0.05` for ones that didn't).
  Scores are min-max normalized per query and blended with configurable weights (defaults
  `bm25=0.4, vector=0.4, success=0.2`). Results can be filtered to a component type.
- **`graph.py` &mdash; `FaultKnowledgeGraph`**: a `networkx.DiGraph` with the schema
  `Component --exhibits--> Symptom --indicates--> RootCause --resolved_by--> Fix --documented_in--> Ticket`,
  built directly from the same KB documents. `related_fixes()` traverses
  component&rarr;symptom&rarr;root_cause&rarr;fix paths to surface fixes connected by *shared
  root cause*, not just shared vocabulary &mdash; this is what the "related via graph" recommendation
  step type comes from, and it's genuinely capable of surfacing a fix that a pure text search would
  miss.

## 5. Recommendation agent (`backend/app/agent/recommend.py`)

Given an alert (`asset_id`, `component`, `operational_state`, plus optional `risk_score` and
`top_factors` from the ML layer), the agent:

1. Emits a **safety step first** if the rack's operational context is anything other than
   `normal` (migration / backup window / DR failover each have a distinct, specific safety note
   &mdash; see `CONTEXT_SAFETY_NOTES`).
2. Emits a **signal step** summarizing the predictive risk score and its top SHAP factors, if
   available.
3. Runs hybrid retrieval filtered to the component, deduplicated by `fix_action` (multiple
   near-identical synthetic doc variants collapse to one recommendation step), each cited back to
   its `doc_id`.
4. Runs graph traversal for **additional** successful fixes not already surfaced by text
   retrieval, tagged as "related via graph" with a citation.
5. Assigns a `confidence` level (`high` / `medium` / `low`) from a combination of risk score and
   the retrieved evidence's historical success rate.

This is a **deterministic pipeline**, not an LLM call: every claim traces to a specific `doc_id`
and every step is templated from structured fields, not generated free-text. That was a scope
decision for this build (no LLM API key was available), not an architectural limitation &mdash;
see "Upgrade path" below.

## 6. API (`backend/app/main.py`)

FastAPI app, CORS-enabled for the Vite dev server. Key endpoints:

| Endpoint | Purpose |
|---|---|
| `GET /api/assets` | Full asset inventory (rack, slot, component, vendor) |
| `GET /api/risk` | Current predicted failure risk for every monitored component, sorted descending, joined with operational context |
| `GET /api/alerts` | Subset of `/api/risk` above the alert threshold (`RISK_ALERT_THRESHOLD = 0.5`) |
| `GET /api/telemetry/{asset_id}` | Recent raw telemetry for charting (NaN-safe: all-NaN columns dropped, remaining NaN &rarr; `null`) |
| `POST /api/alerts/{asset_id}/recommend` | Runs the full agent pipeline for one asset, returns the structured recommendation |
| `POST /api/copilot` | Free-text query &rarr; hybrid retrieval (deduplicated, relevance-floored) &rarr; templated cited answer |
| `GET /api/evidence/{doc_id}` | Full source document for a citation |
| `GET /api/context/{rack_id}` | Current operational state for a rack |
| `GET /api/graph/stats` | Fault knowledge graph node/edge counts, for a sanity-check/demo talking point |

## 7. Frontend (`frontend/`)

Vite + React (no UI component library, hand-written CSS for a compact dark ops-dashboard look).
Three views: **Risk Dashboard** (fleet-wide sortable/filterable risk table with KPI summary),
**Asset Detail** (the cited recommendation view &mdash; the core "explainable and cited
recommendation" feature from the submission), **Incident Copilot** (free-text chat with citation
cards).

## 8. Testing

`backend/tests/` (pytest, 15 tests): feature-engineering label correctness and tail-holdout
behavior, retrieval component-filtering and success-rate ranking, agent safety-note and citation
correctness, and API-level integration tests (health, risk ordering, 404 handling, recommend and
copilot round-trips). Run with `python -m pytest backend/tests -q` from the repo root.

## 9. Upgrade path (prototype &rarr; the originally submitted architecture)

Every simplification below was made for prototype-phase time/dependency constraints, and none of
them require re-architecting the pipeline above them:

- **Real telemetry**: replace `data/synthetic/generate_telemetry.py`'s output with a Redfish/SNMP
  poller writing the same `assets.csv` / `telemetry.csv` schema; `features.py`/`predict.py` are
  unchanged.
- **Real knowledge base**: replace `generate_knowledge_base.py`'s output with a ServiceNow API
  ingestion + OCR pipeline for scanned RCA PDFs/manuals, writing the same `documents.jsonl`
  schema (`component`, `symptom_tags`, `root_cause`, `fix_action`, `success`, `text`); retrieval
  and graph-building code is unchanged.
- **Dense retrieval**: swap `TfidfVectorizer` for `sentence-transformers` embeddings + a
  FAISS/Qdrant index behind the same `HybridRetriever.search()` interface; add a cross-encoder
  re-rank pass on the blended top-N.
- **Neo4j**: swap `networkx.DiGraph` for a Neo4j driver behind the same `FaultKnowledgeGraph`
  interface (`related_fixes()`), for multi-user concurrent querying at scale.
- **Grounded LLM agent**: replace the templating in `recommend.py`'s step-assembly with a call to
  an LLM (e.g. Claude), passing the *already-retrieved* evidence as the grounding context and
  constraining the response to cite only `doc_id`s present in that context &mdash; the
  evidence-gathering (retrieval + graph traversal + operational-context lookup) does not change.
- **ServiceNow closed-loop**: add a write-back call in `main.py`'s recommend endpoint to open a
  change ticket via the ServiceNow REST API, and a feedback endpoint that logs which
  recommendation a technician actually followed, for periodic model/retrieval re-tuning.

## 10. Known limitations of this build

- Synthetic data means model metrics (AUC ~0.99) are optimistic versus real telemetry, which will
  be noisier and have more label ambiguity.
- The KB has only 8 underlying fault patterns (48 documents); retrieval quality on genuinely novel
  fault signatures is untested.
- No authentication/authorization layer; not intended to be internet-exposed as-is.
- In-memory/CSV data layer will not scale past a single-process demo; see "Scaling" implicit in
  the Upgrade path above (Postgres/Timescale for telemetry, Neo4j for the graph, a vector DB for
  retrieval are the natural next steps, all already named in the original submission's stack).
