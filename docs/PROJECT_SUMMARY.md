# Project Summary — RackIQ

**Team:** RackIQ (Tasmaiya Tamboli, Hendro Setyawan) · **Event:** ABB Accelerator 2026, Prototype Phase
**Theme:** Hybrid of Theme 1 (Agentic Predictive Maintenance Studio) and Theme 2 (Multimodal
Maintenance Intelligence Agent), applied to data-center hardware operations.

## Problem

Hardware failures in data centers — DIMM errors, disk pre-failure, PSU faults, NIC flaps, fan wear —
surface during migrations, backups and DR failovers, when diagnosis time directly extends outage
exposure. The fix usually exists already in closed tickets, RCAs, manuals and emails, but it is
fragmented and held by a few senior engineers. And when the part is not on the shelf, even the right
fix waits.

## Solution

RackIQ is an intelligence layer above existing monitoring, ITSM and inventory tools:

1. **Predict** — 72-hour failure risk for every component from telemetry trends, explained with
   SHAP, plus a telemetry anomaly index for early warnings.
2. **Recommend** — the fix that actually held in the organization's own incident history, cited to
   its source, ranked by durable-fix rate, with fixes that did not hold flagged.
3. **Adapt** — a safety step first when the rack is mid-migration, in a backup window or serving a
   DR failover.
4. **Supply** — each fix shows the spare-part stock; the warehouse view flags SKUs that cannot cover
   the failures the models predict.

## Prototype

A DCIM-style web app (React + D3.js) with five sections — Command Center (3D 100-rack floor),
Operations (telemetry, thermal, AI model health), Maintenance (risk matrix, work queue, RCA copilot),
Event Log (12-month incident clock, MELT event stream) and Inventory (stock runway, turnover,
consumption) — on a FastAPI backend with five LightGBM models, hybrid retrieval, a fault knowledge
graph and a deterministic cited-recommendation agent.

Scale: 100 racks, 800 servers, 4,000 monitored components, 90 days of telemetry, 14 days of events,
~1,400 incidents and ~1,900 knowledge-base documents over 12 months, 16 spare-part SKUs. All data is
synthetic and labelled as such; the recommendation step is templated rather than LLM-generated.
Live hosted demo: https://rackiq-copilot.web.app

## Differentiation

Vendor-agnostic across mixed Dell/HPE/Lenovo fleets; fuses prediction with the organization's own
incident memory; operationally context-aware; and connects maintenance to spare-part supply —
combinations not offered together by vendor predictive tools, ServiceNow AI search or AIOps
alert-correlation platforms.

## Illustrative impact

For a data center with 50–100 hardware incidents a month and 30–45 minutes of manual RCA lookup each,
halving diagnosis time saves roughly 15–25 engineer-hours a month, before counting avoided SLA
exposure during DR or migration windows and avoided waits for parts. Planning assumptions to validate
in a pilot, not measured results.
