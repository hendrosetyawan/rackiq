# RackIQ Business Plan (rev04, Oct 2026)

**One line.** RackIQ is a data center management system that comes with its own sensors. It sells:

1. **RackIQ Sense** telemetry devices for every rack.
2. **RackIQ Crew**, which tracks each technician's location and job through a phone, a rugged tablet or a smart ID badge.
3. **A software subscription** for the RackIQ platform: DCIM, 3D live floor, failure prediction, a cited fix copilot, and spare-part inventory.

Hardware gets RackIQ into the building. The subscription is the recurring business.

> Every figure for the reference customer is computed from the prototype's 12-month synthetic record (800 servers, 1,417 incidents), plus the price book and assumptions stated below. Market sizes cite third-party reports.

---

## 1. What we sell

| Line | Product | What it does | Price | Unit cost | Gross margin |
|---|---|---|---|---|---|
| Hardware | **RackIQ Sense rack node** (1 per rack) | See note (a) | $349 one-time | $140 | 60% |
| Hardware | **RackIQ Edge gateway** (1 per 50 racks) | See note (b) | $2,900 one-time | $1,100 | 62% |
| Crew | **Smart ID badge** | See note (c) | $79 one-time | $28 | 65% |
| Crew | **Rugged tablet** (optional, resold) | Preloaded RackIQ Crew app for supervisors or shared use | $699 one-time | $560 | 20% |
| Crew | **Phone app** (BYOD, iOS/Android) | Same job tracking on the technician's own phone; included in the crew seat | — | — | — |
| Crew | **RackIQ Crew seat** | See note (d) | $19 / crew member / month | — | 80% |
| Software | **Monitor** tier | DCIM, Sense telemetry, 3D live floor, alerts, spare-part inventory | $2 / server / month | — | 80% |
| Software | **Predict** tier (default) | Monitor, plus 72-hour failure prediction, cited RCA copilot, risk-ranked work queue with parts | $5 / server / month | — | 80% |
| Software | **Enterprise** tier | Predict, plus multi-site, on-prem/edge deployment, ServiceNow/SAP write-back, SSO and audit, API | $8 / server / month | — | 80% |
| Service | **Installation & onboarding** | Mount nodes, commission the gateway, import history and inventory, train crew | $4,000 per hall | — | 40% |

Notes:
- **(a) Sense rack node** measures inlet/outlet temperature and humidity at three heights, the door contact, vibration and a leak-rope input. It also bridges PDU readings (Modbus/SNMP) and has a built-in BLE anchor, so it doubles as the indoor-positioning grid for crew badges.
- **(b) Edge gateway** collects server telemetry read-only (Redfish, IPMI, SNMP) and buffers data if the link drops. It runs prediction at the edge, so raw telemetry never has to leave the site.
- **(c) Smart ID badge** is a BLE + NFC card or sleeve worn on the existing site ID. It gives zone-level location from the rack nodes, and its button starts and stops a job. NFC tap-to-scan covers parts and racks. Battery life is about 1 year.
- **(d) Crew seat** covers digital work orders, live location by zone, part scans, shift handover and the job audit trail.

**Three ways to track a technician, one system.** The site picks whatever fits its policy:
- **Phone:** the cheapest option, zero hardware.
- **Rugged tablet:** for sites that ban personal phones on the floor.
- **ID badge:** for sites that ban all cameras and radios except approved badges.

All three feed the same live floor, job feed and audit log. The Live Floor 3D demo shows all three, with a mix of tablet, phone and badge on each shift.

## 2. Scope

**In scope (first 24 months)**
- **Customers:** enterprise and colocation data halls with 500–5,000 mixed-vendor servers (Dell, HPE, Lenovo, GPU nodes). We start in the US (Texas first), then expand through partners.
- **What we monitor:**
  - The server hardware layer: DIMM, disk, PSU, NIC, fan.
  - The rack environment: temperature, humidity, door, vibration, PDU power.
  - The people doing the work: technicians and superintendents.
  - The spare-part warehouse.
- **What we deliver:** our own rack sensors and gateway, crew devices (badge plus app; tablets are resold), and the software platform. SaaS by default; on-prem for Enterprise.
- **Integration:** read-only from BMCs, PDUs and the BMS; two-way with ServiceNow and the spare-parts / ERP system.

**Out of scope (deliberately)**
- **Controlling facility equipment.** RackIQ reads power and cooling but never switches it. That stays with the BMS/EPMS; this is where we partner with vendors such as ABB rather than compete.
- **Hyperscale operators** that build their own tooling.
- **Making our own tablets or phones.** We resell rugged tablets and support BYOD.
- **Replacing ServiceNow or the CMDB.** RackIQ writes tickets into them.
- **Tracking people outside the site or off shift** (see §8).

**Later (24–36 months):** network switches and storage arrays, multi-site portfolio views, edge/telco micro data centers, and EU expansion with works-council-ready privacy defaults.

## 3. Market

RackIQ draws budget from three existing lines: DCIM software, data center monitoring sensors, and workforce location/RTLS. AIOps and predictive maintenance are the analytics markets it competes in.

| Market | Size | Growth | Source |
|---|---|---|---|
| Data center infrastructure management (DCIM) | $4.7B (2025) | 11.7% CAGR to 2034 | IMARC Group |
| Data center monitoring sensors | $1.5B (2024) → $2.84B (2031) | 9.9% CAGR | Valuates Reports, Apr 2026 |
| Real-time location systems (RTLS) | $6.68B (2025) → $15.67B (2030) | 18.6% CAGR | MarketsandMarkets |
| AIOps | $32.5B (2025) | 16.9% CAGR | IMARC Group |
| Predictive maintenance | $12.7B (2024) | 22.8% CAGR | IMARC Group |

**Beachhead:** enterprise and colocation operators with 500+ mixed-vendor servers per site. They have the most incidents per technician, shift-based crews, and no single-vendor tool that covers the whole fleet.

## 4. Unit economics: one reference hall

The reference hall is the prototype hall: 100 racks, 800 servers, a spare-parts warehouse, and 3 shifts × (4 technicians + 1 superintendent) = 15 crew. It runs the Predict tier.

| Item | Qty | Amount |
|---|---|---|
| Sense rack nodes | 100 × $349 | $34,900 |
| Edge gateways | 2 × $2,900 | $5,800 |
| Smart ID badges | 15 × $79 | $1,185 |
| Rugged tablets (one per superintendent) | 3 × $699 | $2,097 |
| **Hardware** | | **$43,982** (58% gross margin) |
| Installation & onboarding | 1 hall | $4,000 |
| Predict subscription | 800 servers × $5 × 12 | $48,000 / yr |
| Crew seats | 15 × $19 × 12 | $3,420 / yr |
| **Annual recurring revenue (ARR)** | | **$51,420 / yr** (80% gross margin) |
| **Year-1 contract value** | | **$99,402** |
| **5-year customer value** | hardware + install + 5 × ARR | **$305,082** |

Gross profit per hall: $27,282 one-time, plus $41,136 a year.

## 5. Why the customer pays (from the 12-month record)

| Value line | Per year | Basis |
|---|---|---|
| Engineer + technician hours saved by prediction and the cited fix | 653 h · $49K | rev03 financials: diagnosis −55%, 75% of repeat fixes avoided, $75/h |
| Crew admin time saved | 236 h · $17.7K | See note below |
| **Labor total** | **$66.7K** | |
| Unplanned downtime avoided | 11,140 min | 16,870 → 5,730 min a year (−66%) |

The crew admin line rests on one assumption: digital work orders, NFC part scans and auto-handover save 10 minutes per incident, across 1,417 incidents a year.

- **Labor alone** pays back the year-1 contract ($99.4K) in about **18 months**. After that, the ARR ($51.4K) is lower than the labor saved ($66.7K).
- **Adding downtime:** at $100 per minute, roughly 1% of the ~$9,000/min industry average (Uptime Institute), avoided downtime is worth **$1.1M a year**, and payback falls to about **1 month**.
- **Not counted:** fewer stockouts (live bin counts plus auto-POs), faster onboarding of junior technicians, and an audit trail of who touched which server and when.

## 6. Go to market

| Phase | When | What |
|---|---|---|
| 0 · Design partners | 0–3 months | 2–3 sites run a **one-row pilot kit**: 20 Sense nodes, 1 gateway, 5 badges, 90 days of Predict. Pilot fee $7,500, credited to the full purchase. |
| 1 · Paid pilots → halls | 3–12 months | Convert pilots to full halls; prove technician-confirmed MTTR and the downtime reduction. |
| 2 · Partner channel | 12–36 months | Sell through data center system integrators and facility-equipment partners (e.g. ABB power and cooling installs) as the IT-layer add-on to their power and cooling monitoring. |

**How we sell:**
- Hardware is sold once, at a margin, through the same purchase order as installation.
- The subscription is an annual contract billed per server.
- Crew seats grow with headcount.
- Expansion comes from the Monitor → Predict → Enterprise upgrade and from adding halls.

## 7. Three-year plan

New halls are assumed to subscribe for half of the year they are sold.

| Year | New halls | Halls live | Hardware + install | Subscription | **Revenue** | Gross margin | ARR at year end |
|---|---|---|---|---|---|---|---|
| 2027 | 4 | 4 | $192K | $103K | **$295K** | 65% | $206K |
| 2028 | 11 | 15 | $528K | $488K | **$1.02M** | 68% | $771K |
| 2029 | 30 | 45 | $1.44M | $1.54M | **$2.98M** | 69% | $2.31M |

The revenue mix shifts from hardware-led to subscription-led by 2029. Blended gross margin rises as the installed base grows.

## 8. Technician monitoring: trust rules

Tracking people only works if technicians accept it. RackIQ Crew is built for job tracking, not surveillance:

- **On shift and on site only.** Location is the zone (aisle, rack, warehouse, NOC), read from the rack nodes' BLE anchors. Badges and the app stop reporting when the shift ends or the person leaves the site. There is no GPS.
- **Jobs, not people.** Reports show job time, MTTR and handovers per job and per crew. There is no individual productivity ranking by default.
- **Opt-in device choice:** phone, tablet or badge. Data is retained for 90 days by default, and the policy is configurable to meet local labor and privacy law (e.g. works councils in the EU).
- **Safety benefit:** the superintendent sees who is in which aisle during an incident, a lone-worker alert, or an evacuation.

## 9. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Hardware adds supply-chain and support load | Off-the-shelf sensor modules, contract manufacturing, 2-year warranty with advance replacement. Tablets are resold, not built. |
| Customers already own environmental sensors | Monitor tier ingests third-party sensors via SNMP/Modbus; Sense nodes are not required for the software. |
| Crew tracking rejected by staff | Trust rules (§8), badge option without a camera, job-level reporting. |
| Synthetic-data results do not hold on real fleets | Pilot measures real MTTR, false-alarm rate and downtime before full-hall conversion. |
| Long data center sales cycles | Low-cost one-row pilot kit credited to purchase; partner channel through facility-equipment installs. |

## 10. Assumptions (all adjustable)

- **Prices and unit costs:** our price book. Unit costs are bill-of-materials estimates for a contract-manufactured device.
- **Margins:** software 80% gross margin (hosting plus support); installation 40%.
- **Labor rate:** $75/h loaded.
- **Crew admin saving:** 10 minutes per incident.
- **Downtime value:** shown at $100/min only as a sensitivity.
- **Sales ramp:** 4 → 11 → 30 new halls a year.

## Sources

- IMARC Group, Data Center Infrastructure Management Market (2025 → 2034): https://www.imarcgroup.com/data-center-infrastructure-management-market
- Valuates Reports, Data Center Monitoring Sensor Market, press release Apr 2026: https://www.bolsamania.com/nota-de-prensa/mercados/data-center-monitoring-sensor-market-to-reach-usd-2840-million-by-2031-growing-at-99-cagr-valuates-reports--22332203.html
- MarketsandMarkets, Real-time Location Systems Market: https://www.marketsandmarkets.com/PressReleases/real-time-location-systems.asp
- IMARC Group, AIOps and Predictive Maintenance market reports (as cited in the rev03 deck)
- Uptime Institute, Annual Outage Analysis 2024–2025 (downtime cost)
