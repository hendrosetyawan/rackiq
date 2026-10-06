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

RackIQ is a data center management system with its own sensors, in three parts:

- **RackIQ Sense** (telemetry devices): a node on every rack (environment, door, PDU, BLE anchor) and an edge gateway that reads BMC health read-only.
- **RackIQ Crew** (technician monitoring): each technician is tracked by phone app, rugged tablet or smart ID badge, showing zone, job, part scans, progress and shift handover.
- **RackIQ Platform** (subscription software): DCIM plus the intelligence below.

1. **Predict** — 72-hour failure risk for every component from telemetry trends, explained with
   SHAP, plus a telemetry anomaly index for early warnings.
2. **Recommend** — the fix that actually held in the organization's own incident history, cited to
   its source, ranked by durable-fix rate, with fixes that did not hold flagged.
3. **Adapt** — a safety step first when the rack is mid-migration, in a backup window or serving a
   DR failover.
4. **Supply** — each fix shows the spare-part stock; the warehouse view flags SKUs that cannot cover
   the failures the models predict.

## Prototype

A DCIM-style web app (React + D3.js + three.js) with six sections. Live Floor 3D is a digital twin of the hall and warehouse: a crew of 4 technicians and 1 superintendent per 8-hour shift works the job queue; every server and bin shows its status; tablets, phones and ID badges are tracked live. The other sections are Command Center (3D 100-rack floor),
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

## Impact (12-month synthetic record, 800 servers)

- 653 labor hours saved by prediction and cited fixes, plus about 236 hours of crew admin.
- Repeat fixes fall from 164 to 41.
- Unplanned downtime falls 66%.

## Business model

| Line | Price |
|---|---|
| Sense hardware | $349 per rack node + $2,900 per gateway |
| Crew | $19 per technician per month (badge $79, tablet $699 optional) |
| Platform subscription | $2 / $5 / $8 per server per month |

- **Reference hall:** $48.0K one-time plus $51.4K ARR.
- **Plan:** 45 halls and $2.31M ARR by 2029.
- **Details:** [`BUSINESS_PLAN.md`](BUSINESS_PLAN.md).
