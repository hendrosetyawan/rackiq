# Technical Documentation — RackIQ Prototype (v2)

## 1. Architecture

```
data/synthetic/generate_telemetry.py ─┬─> racks/servers/assets.csv, operational_context.csv, failure_events.csv
                                      ├─> telemetry/{dimm,disk,psu,nic,fan,servers}.parquet, facility_daily.csv
                                      └─> events.parquet
data/synthetic/generate_knowledge_base.py ─> data/kb/incidents.csv, documents.jsonl, templates.csv
data/synthetic/generate_inventory.py       ─> data/inventory/skus.csv, transactions.csv, stock_daily.csv

backend/app/ml (features, train, predict) ─┐
backend/app/knowledge (retrieval, graph)  ─┼─> backend/app/fleet.py (state + read models) ─> main.py (FastAPI) ─> frontend (React + D3)
backend/app/agent (recommendation)        ─┘
```

One Python process (FastAPI) and one Vite/React app. All state is file-based and loaded once at
startup (≈3 s: load, score 4,000 components, build retrieval index and fault graph); requests are
served from memory. A lock ensures concurrent first requests build the state only once.

## 2. Synthetic data

Everything is generated with fixed seeds (`bash scripts/seed_all.sh`, ~1 minute) and labelled
synthetic throughout. It stands in for Redfish/SNMP telemetry, ServiceNow history and a warehouse
system, which were not available for the prototype.

### 2.1 Floor and telemetry (`generate_telemetry.py`, vectorized NumPy)

- **Floor:** 5 rows (A web, B virtualization, C database, D storage, E AI/GPU) × 20 racks × 8 servers
  = 800 servers; 5 monitored components per server (DIMM, disk, PSU, NIC, fan) = 4,000 series.
  Vendors Dell / HPE / Lenovo per rack; AI row uses GPU servers (750–3,600 W).
- **Cadence:** 90 days × 4 readings/day = 360 readings per series.
- **Telemetry, following the MELT model:**
  - *Metrics — component health:* ECC correctable/uncorrectable, DIMM temp; SMART reallocated,
    pending, read-error rate, I/O latency, disk temp; PSU input voltage, ripple, fan RPM, temp,
    efficiency; NIC link flaps, CRC errors, packet loss, temp; fan RPM, vibration, motor current.
  - *Metrics — infrastructure / profiling / network / storage:* CPU and memory utilization, power
    draw, inlet / outlet / CPU temperature, chassis fan speed, network throughput, latency and packet
    loss, disk IOPS and latency.
  - *Security telemetry:* failed BMC logins per server (including a credential-stuffing episode).
  - *Facility:* daily IT load, PUE, outside temperature.
  - *Events and logs:* 14 days of BMC SEL threshold events, service interruptions, reboots, firmware
    and configuration changes, BMS temperature alarms and authentication failures (1,667 events).
  - *Traces, location and user telemetry:* not generated — end-to-end request tracing needs
    application instrumentation and is out of scope for a hardware copilot.
  - *AI telemetry* (drift, confidence, inference latency) is computed live by the backend about
    RackIQ's own models (§3).
- **Failure signatures:** ~7% of components get a historical degradation (2–10 days, accelerating
  severity) ending in a labelled failure — these are training labels. A further ~2% are placed in an
  ongoing, not-yet-failed degradation in the last 4 days (the live tail, held out of training) with
  severities from early-stage to severe. Transient spikes (0.4% of readings) add realistic noise.
- **Thermal story:** CRAC-3 (racks 11–15, rows C–D) degrades over the last 30 days, producing a
  hot spot visible in the floor's thermal mode and the thermal matrix.
- **Operational context:** 11 racks are in a migration, backup window, DR failover or maintenance
  window; about half coincide with a live degradation (failures surface during busy windows).

### 2.2 Knowledge base (`generate_knowledge_base.py`)

- **45 fault templates**: 33 component-level (7 DIMM, 7 disk, 6 PSU, 7 NIC, 6 fan) and 12 platform
  (thermal / CRAC / containment, power distribution, firmware / BMC / security, cabling). Each has
  symptom tags, phrasing variants, root cause, fix, durable-fix probability, part family, MTTR range,
  priority and — for non-durable fixes like a reseat or driver reset — a follow-up template.
- **Incident log, 12 months (1,417 incidents):** the last 90 days are exactly the telemetry's
  failure events; the earlier 275 days are sampled at the same per-component rate, with a summer
  bump for thermal incidents. Non-durable fixes recur (11.6% of incidents) and spawn a follow-up
  with the durable fix.
- **Documents (1,872):** a closed ticket per incident, RCA reports for serious or recurring ones
  (316), troubleshooting emails (91), and vendor procedure excerpts per hardware fix and vendor (48).

### 2.3 Inventory (`generate_inventory.py`)

16 SKUs (vendor/platform-specific PSUs and fans, universal DIMM/SSD/HDD, 25G/100G NICs, optics,
DAC cables) with cost, lead time and bin. The 12-month incident log is replayed against a
reorder-point / order-quantity policy: each consumed part is an issue, orders arrive after the lead
time, shortages become backorders. Four SKUs are deliberately under-provisioned and one has a supplier
delay, so genuine low-stock situations exist.

## 3. Predictive layer (`backend/app/ml/`)

- **Features** (`features.py`, vectorized `groupby().rolling()`): for each channel a 2-day rolling
  mean, max, slope and latest value. Label = failure within the next 3 days (12 readings).
  The live tail (16 readings) is dropped from training.
- **Models** (`train.py`): one LightGBM classifier per component (balanced class weights, subsampling),
  asset-grouped 75/25 split, logged to MLflow (`sqlite:///mlflow.db`). Held-out AUC: DIMM 0.983,
  disk 0.986, PSU 0.987, NIC 0.964, fan 0.988 (optimistic — synthetic data).
- **Scoring** (`predict.py`): the whole fleet is scored in one batch at startup. Each component gets
  a 72-hour failure risk, the top-4 SHAP drivers, and a **telemetry anomaly index** — the robust
  deviation (median / MAD, floored at half a standard deviation) of its channel means from the fleet
  baseline, reported as a 0–100 health index.
- **Status tiers:** critical ≥ 75% risk; warning ≥ 50% risk (or ≥ 10% risk with anomaly z ≥ 3);
  watch ≥ 25% risk or anomaly z ≥ 3. "Watch" therefore captures early degradations the classifier
  does not yet expect to fail within 72 h.
- **AI telemetry:** per model — held-out AUC / average precision, feature drift (population stability
  index of live features vs training bins), mean confidence, inference latency per asset; plus
  detection against the generator's synthetic ground truth (recall 70% at 50% risk, 75% at 25%,
  precision 98%).

## 4. Knowledge, retrieval and recommendation

- **Hybrid retrieval** (`knowledge/retrieval.py`): BM25 over text + symptom tags, blended with
  TF-IDF (1–2-gram) cosine similarity as a local stand-in for dense embeddings, plus a boost from each
  fix's empirical durable-fix rate over the incident log.
- **Fault graph** (`knowledge/graph.py`): networkx graph Component → Symptom → Root cause → Fix →
  Document, used to surface related fixes a text query would miss.
- **Agent** (`agent/recommend.py`), deterministic:
  1. symptom tags come from the prediction's positive SHAP drivers (e.g. `io_latency_ms` → `latency_spike`);
  2. retrieval ranks all documents for the component, deduplicated to distinct fixes;
  3. each fix gets its 12-month record (times used, durable rate, median MTTR / downtime) and the
     live stock of the SKU it needs;
  4. durable fixes are listed first; a fix that held < 60% of the time is shown as "do not repeat";
  5. a graph-linked fix is added if not already listed; the rack's operational context prepends a
     safety step (or, in a maintenance window, a "do it now" note);
  6. confidence is high when risk ≥ 75% and the top fix is durable ≥ 85% over ≥ 10 uses.
- **RCA copilot:** free-text query → same retrieval → distinct fixes with track records and citations.

## 5. Operations read models (`fleet.py`)

- **Priority score** per work order = 100 × signal × (0.55 + 0.09 × criticality) + spare-part
  shortage bonus, where criticality = workload tier (1–3) + context (DR +2, migration +1.5,
  backup +1) and signal = max(risk, capped anomaly contribution).
- **Inventory metrics:** turns = issued 12 months / average on hand; turn cycle; days of cover;
  ML-predicted near-term demand = Σ risk of flagged components needing the SKU; projected 30-day
  position. Status: *stockout risk* if on hand < predicted demand; *reorder* if on hand + inbound −
  predicted demand ≤ reorder point; *overstock* if cover > 240 days.

## 6. API (`main.py`)

| Endpoint | View |
|---|---|
| `GET /api/overview` | KPIs, tiers, stock summary, 30-day sparklines |
| `GET /api/floor` | 100 racks × 8 slots with status, risk per component, power, inlet |
| `GET /api/servers` | latest metrics for 800 servers |
| `GET /api/telemetry/facility`, `/thermal-matrix` | 90-day facility series; rack × day inlet matrix |
| `GET /api/model-telemetry` | AI telemetry + ground-truth detection |
| `GET /api/workorders`, `/api/forecast` | ranked work orders; expected failures vs spares |
| `GET /api/assets/{id}` | asset detail with component and server series, incidents, SKU |
| `POST /api/alerts/{id}/recommend` | cited action plan |
| `POST /api/copilot` | RCA copilot |
| `GET /api/incidents`, `/api/events` | 12-month incident log; 7-day event stream |
| `GET /api/inventory`, `/inventory/history`, `/inventory/consumption` | stock views |

## 7. Frontend (`frontend/`)

React 18 + Vite + **D3 v7** (no charting wrappers). Five sections — Command Center, Operations,
Maintenance, Event Log, Inventory — plus asset drill-down, designed for a 1440×900 screen. Custom
visualizations: oblique-projection 3D rack floor, rack elevation, radial gauges, rack radar,
brushable parallel coordinates, thermal matrix, risk matrix with force layout, radial incident clock,
stream charts, stock-runway bullet chart, turnover bubbles, stock history, SHAP bars, telemetry small
multiples. A static demo mode (`VITE_DEMO_MODE=true`) reads a precomputed snapshot
(`scripts/export_static_demo.py`: shared JSON views + one file per rack, ~60 KB gzipped).

## 8. Testing

`backend/tests/` — 20 pytest tests: training labels and tail holdout, train/serve feature parity,
retrieval filtering and durability ranking, 12-month KB coverage, graph links, SHAP-driven symptom
mapping, cited recommendations with track records, context safety steps, "do not repeat" handling,
and API views (floor dimensions, work-order ordering, inventory linkage, event log, copilot dedupe).

## 9. Upgrade path

- **Telemetry:** a Redfish/SNMP collector writing the same parquet schema; features unchanged.
- **Knowledge base:** ServiceNow + OCR ingestion into the same `documents.jsonl` schema.
- **Retrieval:** sentence-transformer embeddings + FAISS/Qdrant behind `HybridRetriever.search`, plus
  a cross-encoder re-rank.
- **Graph:** Neo4j behind `FaultKnowledgeGraph.related_fixes`.
- **LLM:** replace only the step-assembly in `recommend.py` with a grounded LLM call constrained to
  the retrieved documents; evidence gathering stays as is.
- **Closed loop:** ServiceNow change-ticket creation and technician feedback for re-ranking;
  purchase-order suggestions from the inventory status.
- **Scale:** TimescaleDB for telemetry, streaming scoring instead of startup batch scoring.

## 10. Known limitations

- Synthetic data: model metrics are optimistic; real telemetry is noisier.
- The knowledge base comes from 45 templates; retrieval on genuinely novel faults is untested.
- The hosted demo is a snapshot: open-ended copilot questions need the local backend.
- No authentication; not intended to be internet-exposed as a live API.
