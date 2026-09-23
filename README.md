# RackIQ

**A Predictive Hardware Failure & Root-Cause Recommendation Copilot for Data Center Operations**

ABB Accelerator 2026 &mdash; Hybrid Theme 1 (Agentic Predictive Maintenance Studio) + Theme 2
(Multimodal Maintenance Intelligence Agent), applied to data-center hardware operations.

Team **RackIQ**: Tasmaiya Tamboli &middot; Hendro Setyawan

> Idea-phase submission: [`final_submission/RackIQ_Submission.pdf`](../final_submission/RackIQ_Submission.pdf)
> (in the parent hackathon folder). This repo is the Prototype Phase build.

**Live demo (static, no backend):** https://rackiq-copilot.web.app &mdash; a Firebase-hosted build
of the frontend running against a precomputed data snapshot (see `frontend/src/api/client.js`'s
demo mode and `scripts/export_static_demo.py`), since Firebase Hosting's free tier serves static
files only. Run locally (below) for the full live pipeline with the real FastAPI backend.

**Demo video:** [`docs/media/rackiq_demo.mp4`](docs/media/rackiq_demo.mp4) (42s).

---

## What this is

When a DIMM, disk, PSU, or NIC starts failing in a data center, the fix has usually already
been found before &mdash; buried in a closed ServiceNow ticket, an RCA document, or an email
thread from six months ago. RackIQ (1) predicts component failure risk from telemetry before
it becomes an outage, and (2) retrieves the specific historical fix that worked before, with
citations, adapted to whatever is operationally happening on that rack right now (migration,
backup window, DR failover).

## What's real vs. what's scoped down for the prototype

This is a hackathon prototype, not a production deployment. Every piece below is a genuinely
working, tested implementation &mdash; but running on **synthetic data** and a **deterministic
agent pipeline** rather than production integrations, so it can be cloned and run in minutes
with no external accounts or API keys.

| Submitted architecture | This prototype |
|---|---|
| Redfish/SNMP telemetry from real BMC/iDRAC/iLO | Synthetic telemetry generator with engineered pre-failure signatures ([`data/synthetic/generate_telemetry.py`](data/synthetic/generate_telemetry.py)) |
| ServiceNow API ingestion of real tickets/RCAs | Synthetic ticket/RCA/manual/email corpus ([`data/synthetic/generate_knowledge_base.py`](data/synthetic/generate_knowledge_base.py)) |
| Sentence-transformer embeddings + FAISS/Qdrant + cross-encoder re-rank | TF-IDF cosine similarity + BM25, weighted blend (same hybrid-retrieval *shape*, lighter dependency footprint) |
| Neo4j fault knowledge graph | In-process `networkx` graph, same Component&rarr;Symptom&rarr;RootCause&rarr;Fix&rarr;Ticket schema |
| Grounded LLM recommendation agent | Deterministic, templated recommendation pipeline &mdash; every step is still evidence-backed and cited, only the free-text generation step is templated instead of LLM-authored (no API key was available for this build) |
| ServiceNow ticket creation / closed-loop learning | Not implemented in the prototype |

See [`docs/TECHNICAL_DOCUMENTATION.md`](docs/TECHNICAL_DOCUMENTATION.md) for the full
architecture, module-by-module detail, and the upgrade path from each simplification back to
the originally submitted design.

## Quickstart

Requires Python 3.10+ and Node 18+.

```bash
# from the rackiq/ repo root
python3 -m venv .venv && source .venv/bin/activate
pip install -r backend/requirements.txt

bash scripts/seed_all.sh          # generates data, trains models, runs tests
uvicorn backend.app.main:app --reload --port 8000   # backend on :8000

# in a second terminal
cd frontend
npm install
npm run dev                       # frontend on :5173, proxies /api to :8000
```

Open http://localhost:5173 &mdash; the Risk Dashboard shows live predicted failure risk across
384 monitored components; click **Investigate** on any alert to see the cited recommendation.
The **Incident Copilot** tab is a free-text troubleshooting chat over the same knowledge base.

## Repository layout

```
rackiq/
├── data/
│   ├── synthetic/        telemetry + asset + failure-event + operational-context generator
│   └── kb/                synthetic RCA/ticket/manual/email knowledge base generator
├── backend/
│   └── app/
│       ├── ml/            feature engineering, LightGBM training (+ MLflow, SHAP), inference
│       ├── knowledge/      hybrid retrieval (BM25 + TF-IDF) and the fault knowledge graph
│       ├── agent/           deterministic, cited recommendation pipeline
│       ├── data/            cached CSV/KB loaders shared by the API
│       ├── schemas/         pydantic response models
│       └── main.py          FastAPI app
│   └── tests/              pytest suite (features, retrieval, agent, API)
├── frontend/                Vite + React dashboard, asset detail, incident copilot chat
├── docs/                   project summary, technical documentation, team pipeline, demo script
└── scripts/seed_all.sh     one-command data generation + training + tests
```

## Status

Prototype-phase deliverables checklist (see [`docs/TEAM_PIPELINE.md`](docs/TEAM_PIPELINE.md)
for the day-by-day plan and who owns what):

- [x] Working prototype (this repo, running end-to-end)
- [x] Source code repository (this repo)
- [x] Technical documentation ([`docs/TECHNICAL_DOCUMENTATION.md`](docs/TECHNICAL_DOCUMENTATION.md))
- [x] Project summary ([`docs/PROJECT_SUMMARY.md`](docs/PROJECT_SUMMARY.md))
- [x] Demo video ([`docs/media/rackiq_demo.mp4`](docs/media/rackiq_demo.mp4), 42s; script at [`docs/DEMO_VIDEO_SCRIPT.md`](docs/DEMO_VIDEO_SCRIPT.md))
- [x] Presentation deck (optional) &mdash; see `prototype_submission/rackiq_presentation.pptx` in the parent hackathon folder
- [x] Hosted demo (optional) &mdash; https://rackiq-copilot.web.app (static snapshot build)

## Redeploying the static demo (Firebase Hosting)

```bash
# 1. backend running locally with a fresh seed (see Quickstart above)
python3 scripts/export_static_demo.py        # snapshots live API responses to frontend/public/data/
cd frontend && VITE_DEMO_MODE=true npm run build && cd ..
firebase deploy --only hosting --project rackiq-copilot
```
