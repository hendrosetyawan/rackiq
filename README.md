# RackIQ

**Predictive hardware failure & cited RCA recommendation copilot for data center operations**

ABB Accelerator 2026 — hybrid of Theme 1 (Agentic Predictive Maintenance Studio) and Theme 2
(Multimodal Maintenance Intelligence Agent), applied to data-center hardware.

Team **RackIQ**: Tasmaiya Tamboli · Hendro Setyawan

- **Live demo:** https://rackiq-copilot.web.app (static snapshot build, see below)
- **Demo video:** [`docs/media/rackiq_demo.mp4`](docs/media/rackiq_demo.mp4) (under 1 minute)

---

## What it does

When a DIMM, disk, PSU, NIC or fan starts to fail, the fix has usually been found before — in a
closed ticket, an RCA or an email thread. RackIQ:

1. **Predicts** failure risk for every monitored component 72 hours ahead from telemetry trends,
   with SHAP explanations, plus a telemetry anomaly index for early "watch" signals.
2. **Recommends** the fix that actually held in the organization's own 12-month incident history,
   cited to the source document, ranked by its durable-fix rate, and flags fixes that did *not* hold.
3. **Adapts** to what is happening on the rack right now (migration, backup window, DR failover,
   maintenance window) with a safety step first.
4. **Links spare parts**: every recommended fix shows the matching SKU's stock; the warehouse view
   flags SKUs that cannot cover the failures the models predict.

## The prototype (v2)

A DCIM-style web app with five sections, all D3.js visualizations, sized for a 1440×900 laptop screen:

| Section | What you see |
|---|---|
| **Command Center** | 3D data-hall floor (5 rows × 20 racks, 8 server slots each) coloured by health / inlet temperature / power, with context beacons; rack elevation; KPI gauges; priority queue |
| **Operations** | Rack radar (power × thermal × flagged servers × context for 100 racks), brushable parallel coordinates across 800 servers, facility power & PUE, 100-rack × 90-day thermal matrix, AI telemetry (model accuracy, drift, confidence, latency) |
| **Maintenance** | Risk matrix (risk × criticality × work time × component × part status), failure forecast vs spares, ranked work queue, RCA copilot |
| **Event Log** | 12-month radial incident clock, weekly incident stream, 7-day MELT event feed (BMC SEL, syslog, SNMP, BMS, security, config), searchable ticket history |
| **Inventory** | Stock runway (on-hand vs reorder point vs predicted demand vs inbound), turnover vs cover, 12-month stock history, consumption stream, assets depending on each SKU |

Drill into any component for its cited action plan, SHAP drivers, telemetry and server context.

### Data (all synthetic, clearly labelled)

| | Scale |
|---|---|
| Floor | 100 racks · 800 servers · 4,000 monitored components (DIMM, disk, PSU, NIC, fan) |
| Telemetry | 90 days at 6-hour cadence: component health channels + server metrics (CPU, memory, power, inlet/outlet/CPU temp, network throughput/latency/loss, disk IOPS/latency, failed logins) + facility PUE |
| Events / logs | 14 days of BMC SEL, syslog, SNMP, BMS, security and config-change events |
| Knowledge base | ~1,400 incidents over 12 months from 45 fault templates, ~1,900 documents (tickets, RCAs, manuals, emails) |
| Inventory | 16 SKUs, 12-month replenishment simulation (issues, orders, receipts, backorders) |

No real BMC, ServiceNow or warehouse data was available for the prototype. The recommendation step
is deterministic and templated (no LLM API key); every step is still evidence-backed and cited.
See [`docs/TECHNICAL_DOCUMENTATION.md`](docs/TECHNICAL_DOCUMENTATION.md) for the architecture and the
upgrade path to real integrations.

## Quickstart

Python 3.10+ and Node 18+.

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r backend/requirements.txt
bash scripts/seed_all.sh                              # data + models + tests, ~1-2 min
uvicorn backend.app.main:app --reload --port 8000     # API on :8000

cd frontend && npm install && npm run dev             # UI on :5173 (proxies /api)
```

## Hosted static demo

Firebase Hosting's free tier serves static files only, so the hosted build reads a precomputed
snapshot of every API response instead of a live backend (banner shown in-app). To rebuild it:

```bash
python3 scripts/export_static_demo.py                 # snapshot -> frontend/public/data/
cd frontend && VITE_DEMO_MODE=true npm run build && cd ..
firebase deploy --only hosting --project rackiq-copilot
```

## Layout

```
data/synthetic/   catalog + generators: telemetry, knowledge base, inventory
data/kb/          incidents.csv, documents.jsonl, templates.csv
data/inventory/   skus.csv, transactions.csv, stock_daily.csv
backend/app/      ml/ (features, train, predict), knowledge/ (retrieval, graph),
                  agent/ (recommendation), fleet.py (state + views), main.py (FastAPI)
backend/tests/    pytest (features, retrieval, agent, API)
frontend/src/     pages/ (5 sections + asset detail), charts/ (D3), components/, api/
docs/             project summary, technical documentation, demo script, team pipeline
```

## Status

- [x] Working prototype (local, full live pipeline) and hosted demo
- [x] Source code repository, technical documentation, project summary
- [x] Demo video, presentation deck (in the hackathon submission folder)
