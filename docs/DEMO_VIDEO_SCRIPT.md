# Demo Video Script &mdash; RackIQ

Target length: 3-4 minutes. Screen-recording with voiceover. Suggested split: ~30s problem, ~2min
product walkthrough, ~30s architecture/tech, ~30s impact/close.

## Before recording

```bash
bash scripts/seed_all.sh
uvicorn backend.app.main:app --port 8000 &
cd frontend && npm run dev
```
Open http://localhost:5173. Have the Risk Dashboard loaded and sorted (default) before you start
recording so the highest-risk assets are already at the top of the table.

## 1. Problem (0:00-0:30)

*Voiceover, no screen recording needed yet (title card or slide is fine):*

> "In a data center, hardware failures don't happen in isolation — they happen during migrations,
> backup windows, DR failovers, exactly when diagnosis time determines whether an SLA gets
> violated. The fix has usually already been found before, in a closed ticket or an RCA doc from
> six months ago — but it's buried, unindexed, and only a few senior engineers remember it.
> That's the problem RackIQ solves."

## 2. Risk Dashboard (0:30-1:15)

*Screen: Risk Dashboard, full view.*

- Point out the KPI row: "384 monitored components across 12 racks, four component types —
  DIMM, disk, PSU, NIC."
- Point out the **Active alerts** KPI: "Right now, 40+ components are flagged above our risk
  threshold — these aren't threshold-crossing alarms, they're predicted, from a trained failure
  model reading live telemetry trends."
- Point at a row with a non-"Normal" operational-context badge (e.g. "DR failover active"):
  "And critically, we know which of these are happening on a rack that's *currently* mid-DR
  failover or backup window — that changes what the safe fix actually is."

## 3. Asset Detail / cited recommendation (1:15-2:30) &mdash; the core of the demo

*Click "Investigate" on the DR-failover-flagged disk alert (or whichever asset is flagged in that
state at generation time — check `/api/alerts` for one with `operational_state != "normal"`).*

- "Here's the recommendation view for this disk. Risk score 100%, driven mainly by reallocated
  sector count and SMART read error rate — that's SHAP explainability on top of the LightGBM
  model, not a black box."
- Point at the **safety step**: "Because this rack is mid-DR-failover, the very first thing RackIQ
  surfaces is a safety note — don't just hot-swap this disk, coordinate with the DR runbook first."
- Point at the **fix step + citation**: "This exact fix — migrate data off before hot-swapping —
  is cited back to a specific document, DOC-0018. I can open that evidence and see the actual
  vendor procedure excerpt it came from."
- Scroll to **Evidence & citations**: "Every recommendation step traces to a real source document
  — no hallucinated advice."

## 4. Incident Copilot (2:30-3:00)

*Switch to Incident Copilot tab.*

- Click one of the suggested questions (e.g. "PSU output ripple rising and fan RPM dropping...").
- "This is the free-text side — an engineer can just ask, in plain language, and get back cited,
  ranked historical fixes, filtered by component if they want."

## 5. Architecture + honesty about scope (3:00-3:30)

*Screen: README architecture table, or a slide.*

> "Under the hood: a LightGBM failure model per component type, tracked in MLflow; a hybrid
> BM25 + vector retrieval layer over the incident knowledge base; a fault knowledge graph
> connecting components to symptoms to root causes to fixes; and a deterministic recommendation
> agent tying it all together with operational-context awareness. For this prototype phase, we're
> running on synthetic telemetry and a synthetic incident corpus — clearly documented — and the
> recommendation step is templated rather than LLM-generated, since no external LLM API was
> available for this build. Every one of those is a drop-in swap, not a re-architecture — it's
> detailed in our technical documentation."

## 6. Impact + close (3:30-4:00)

> "For a mid-size data center handling 50 to 100 hardware incidents a month, cutting diagnosis
> time in half on just DIMM failures alone is 15 to 25 engineer-hours saved a month — before
> counting the outsized cost of incidents during migration or DR windows specifically. That's
> RackIQ. Thanks for watching."

---

## Recording notes

- Use the browser at a reasonably wide zoom so table text is legible on a compressed video export.
- If recording asynchronously between Tasmaiya and Hendro, one person can drive the mouse while
  the other reads the voiceover live, or record voiceover separately and sync in editing — either
  works; keep the screen-recording and voiceover script above in sync either way.
- Export at 1080p; keep under the hackathon platform's file-size/length limit if one is specified
  on the submission form.
