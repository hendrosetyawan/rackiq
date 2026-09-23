# Project Summary &mdash; RackIQ

**Team:** RackIQ (Tasmaiya Tamboli, Hendro Setyawan) &middot; **Event:** ABB Accelerator 2026, Prototype Phase
**Theme:** Hybrid of Theme 1 (Agentic Predictive Maintenance Studio) and Theme 2 (Multimodal
Maintenance Intelligence Agent), applied to data-center hardware operations.

## Problem

Hardware failures in data centers &mdash; DIMM errors, disk pre-failure signals, PSU faults, NIC
flaps &mdash; tend to surface during the worst possible windows: migrations, backup jobs, DR
failovers, where diagnosis time directly extends outage exposure. The information needed to fix
them fast already exists (RCA docs, closed tickets, vendor manuals, troubleshooting emails), but
it's fragmented, unindexed, and held in a handful of senior engineers' memory. A 2 AM on-call
engineer re-solves problems that were already solved six months ago.

## Solution

RackIQ is an intelligence layer above existing monitoring/ITSM tooling (not a replacement for
ServiceNow or BMC/iDRAC/iLO) that does two things continuously:

1. **Predicts** component failure risk from telemetry trends, before a threshold alarm fires,
   with an explainable breakdown of which signals are driving the score.
2. **Retrieves and recommends** the specific historical fix that resolved the same signature
   before &mdash; cited back to its source ticket/RCA/manual/email &mdash; adapted to whatever
   operational state the affected rack is in right now (safe to hot-swap? or does DR failover
   need to complete first?).

## What the prototype demonstrates

- A trained LightGBM failure-risk classifier per component type (DIMM, disk, PSU, NIC), with
  SHAP-based explanations, tracked in MLflow, scoring 384 synthetic monitored components live.
- A hybrid (BM25 + vector) retrieval layer with a success-rate boost over a synthetic 48-document
  knowledge base of tickets/RCAs/manuals/emails, plus a `networkx` fault knowledge graph
  (Component&rarr;Symptom&rarr;RootCause&rarr;Fix&rarr;Ticket) for evidence a pure text match would miss.
- A deterministic recommendation agent that combines predictive risk, retrieved evidence, and
  live operational context (migration / backup window / DR failover) into a structured, cited,
  confidence-scored action plan &mdash; no hallucination risk, because no free-form LLM generation
  is in the loop for this build.
- A React dashboard (fleet risk view, per-asset recommendation view, evidence panel) and an
  Incident Copilot free-text chat over the same evidence base.

All of the above runs on synthetic telemetry and a synthetic knowledge base (documented and
clearly labeled as such) rather than real BMC/ServiceNow data, and the recommendation step is
templated rather than LLM-generated, given the prototype-phase constraints. See
[`TECHNICAL_DOCUMENTATION.md`](TECHNICAL_DOCUMENTATION.md) for exactly what would change to move
this toward production, and why the underlying pipeline (evidence retrieval, graph traversal,
context-awareness, citation assembly) doesn't need to change to add a real LLM or real data later.

## Differentiation

Vendor-agnostic (works across mixed Dell/HPE/Lenovo fleets), fuses predictive telemetry with an
organization's *own* institutional incident memory rather than generic vendor playbooks, and is
operationally context-aware (checks migration/backup/DR state before recommending action) &mdash;
none of which existing vendor predictive-analytics tools, ServiceNow's own AI search, or generic
AIOps alert-correlation platforms do together.

## Tech stack (this prototype)

Python, FastAPI, LightGBM, SHAP, MLflow, scikit-learn, `rank_bm25`, `networkx`, React (Vite).

## Illustrative impact estimate

A mid-size data center handling ~50-100 hardware incidents/month, where manual RCA lookup
currently takes ~30-45 minutes per incident, could plausibly see 15-25 engineer-hours saved per
month if cited historical-fix retrieval cuts diagnosis time by 50-60% &mdash; before counting the
outsized value of avoiding SLA exposure during DR/migration windows specifically. These are
planning assumptions to validate in a pilot, not measured results.
