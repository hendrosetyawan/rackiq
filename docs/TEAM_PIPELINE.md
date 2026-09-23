# Team Pipeline &mdash; Prototype Phase (Sep 22 &rarr; Sep 27, 4:59 PM Central)

Status as of Sep 22: idea phase passed, and a working end-to-end prototype already exists in this
repo (backend API, trained models, retrieval + graph, deterministic recommendation agent, React
frontend, 15 passing tests, docs). The remaining ~5 days are for **review, polish, integration
testing, and producing the submission package** &mdash; not building from zero. Adjust the split
below to actual strengths/interests; it's a starting proposal, not a mandate.

## Required submission components (from the ABB Accelerator FAQ)

Project Summary &middot; Working Prototype &middot; Demo Video &middot; Source Code Repository
&middot; Technical Documentation &middot; Presentation Deck (optional)

Status: Prototype, Source Code Repo, Technical Documentation, and Project Summary are done (this
repo + `docs/`). **Demo Video is the main outstanding work.** Presentation deck is optional.

## Recommended split

**Hendro &mdash; Backend / ML / Knowledge layer owner**
(continuity with the work already in this repo: `backend/app/ml`, `backend/app/knowledge`,
`backend/app/agent`, `backend/app/main.py`, data generators)

**Tasmaiya &mdash; Frontend / Demo / Documentation owner**
(`frontend/`, demo video production, docs review/proofreading, optional presentation deck)

Both: integration testing, bug bash, final submission packaging. Swap freely &mdash; the repo is
small enough that either of you can touch either half; the split is about primary ownership for
this week, not a hard boundary.

## Day-by-day

### Day 0 &mdash; Today, Sep 22 (setup & orientation)

- Both: clone the repo, run `bash scripts/seed_all.sh`, get the backend (`uvicorn`) and frontend
  (`npm run dev`) running locally. Read [`README.md`](../README.md) and skim
  [`TECHNICAL_DOCUMENTATION.md`](TECHNICAL_DOCUMENTATION.md).
- Both: agree on the split above (or a different one) and on whether either of you has access to
  a real LLM API key (Anthropic/OpenAI) &mdash; if so, upgrading the recommendation agent from
  templated to LLM-grounded (see Technical Documentation &sect;9) is the single highest-leverage
  optional improvement, and worth deciding on early since it affects Day 1-2 backend work.
- Hendro: skim `backend/app/agent/recommend.py` and `backend/app/knowledge/` end to end; note any
  rough edges to fix Day 1-2.
- Tasmaiya: click through both frontend pages, note UX rough edges / missing states (loading,
  empty, error) to fix Day 1-2.

### Day 1-2 &mdash; Sep 23-24 (polish sprint, parallel tracks)

**Hendro (backend/ML):**
- If an LLM key is available: wire it into `recommend.py`'s step-assembly (keep all
  evidence-gathering as-is; only replace the final templating with a constrained LLM call over
  the retrieved evidence).
- Otherwise: strengthen the deterministic templates (more natural phrasing, handle edge cases like
  zero-citation recommendations more gracefully).
- Widen the synthetic knowledge base (`data/synthetic/generate_knowledge_base.py`) with a few more
  fault templates/variants so the Incident Copilot has more to retrieve beyond the current 8
  patterns &mdash; this is the easiest lever to make demo answers feel less repetitive.
- Re-run `bash scripts/seed_all.sh` after any data-generator change and confirm the 15 tests still
  pass.

**Tasmaiya (frontend/demo):**
- Add loading/empty/error states where thin (e.g. Incident Copilot with no results, Asset Detail
  for a component with zero citations).
- Optional polish: a small telemetry trend sparkline/chart on Asset Detail (the raw table is
  functional but a chart reads better on video); a "why this asset" one-line summary at the top of
  the recommendation view for fast visual scanning.
- Start drafting demo video shot list from [`DEMO_VIDEO_SCRIPT.md`](DEMO_VIDEO_SCRIPT.md) and
  identify which specific `asset_id`s to use in the recording (pick ones with a non-normal
  operational context and a clean citation trail &mdash; check `GET /api/alerts` for candidates).

**Both, end of Day 2:** full run-through together, backend + frontend, looking for anything that
breaks or looks unfinished on camera.

### Day 3 &mdash; Sep 25 (integration, QA, documentation pass)

- Both: bug bash &mdash; click every page, every filter, every citation link; fix what's broken.
- Both: read [`PROJECT_SUMMARY.md`](PROJECT_SUMMARY.md) and
  [`TECHNICAL_DOCUMENTATION.md`](TECHNICAL_DOCUMENTATION.md) end to end and correct anything that
  no longer matches the code after Day 1-2 changes.
- Tasmaiya: finalize the demo video shot list and script edits; if doing a presentation deck,
  start it now (optional submission component).
- Hendro: tag/confirm the exact commit the team will submit as the "final" prototype state (see
  Submission checklist below) once QA is clean.

### Day 4 &mdash; Sep 26 (record & edit demo video)

- Record following [`DEMO_VIDEO_SCRIPT.md`](DEMO_VIDEO_SCRIPT.md). Do at least one full dry run
  before the real take. Edit, add captions/title cards if desired, export.
- Buffer time for a second take if the first doesn't land, or for last bug fixes surfaced by
  watching the recording back.

### Day 5 &mdash; Sep 27, before 4:59 PM Central (submit)

- Final checklist below, then submit through the hackathon platform. Do not make further code
  changes after recording the demo video unless you also re-record the affected part &mdash; a
  demo video showing a different state than the submitted code looks worse than a rough edge.

## Submission checklist

- [ ] Project Summary &mdash; `docs/PROJECT_SUMMARY.md` (or paste into the platform's field if it
      requires inline text rather than a linked file)
- [ ] Working Prototype &mdash; this repo, confirmed runnable from a clean clone via
      `bash scripts/seed_all.sh` + the two run commands in the README
- [ ] Demo Video &mdash; recorded per `docs/DEMO_VIDEO_SCRIPT.md`, uploaded per platform
      instructions
- [ ] Source Code Repository &mdash; https://github.com/hendrosetyawan/rackiq (public)
- [ ] Technical Documentation &mdash; `docs/TECHNICAL_DOCUMENTATION.md`
- [ ] Presentation Deck (optional) &mdash; if made, link/attach it
