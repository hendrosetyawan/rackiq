"""
Synthetic knowledge-base generator for RackIQ's RAG layer.

Produces a corpus of closed ServiceNow-style tickets, RCA reports, vendor
manual excerpts, and troubleshooting emails covering the four monitored
component types (DIMM, disk, PSU, NIC). Each document carries structured
metadata (component, symptom tags, root cause, fix action, whether the fix
resolved the issue) so the fault knowledge graph and retrieval layer have
something real to index -- while making explicit that this is synthetic
content standing in for an organization's real historical incident corpus.

Output: data/kb/documents.jsonl, data/kb/documents.csv
"""
import json
import random
from pathlib import Path

OUT_DIR = Path(__file__).parent.parent / "kb"
OUT_DIR.mkdir(parents=True, exist_ok=True)

random.seed(7)

# Each template: component, symptom tags, root cause, fix action, doc_type pool,
# and a body template. Multiple docs are generated per template with varied
# ticket numbers, dates, technicians and minor phrasing so retrieval has to do
# real matching rather than exact string lookup.

TEMPLATES = [
    dict(
        component="dimm",
        symptom_tags=["ecc_correctable_spike", "ecc_uncorrectable", "memory_errors"],
        root_cause="Degrading DIMM module in slot showing rising correctable ECC error rate, "
        "progressing to uncorrectable errors consistent with a failing memory cell array.",
        fix_action="Replace the affected DIMM module. If the server is part of an active "
        "migration or DR failover, complete failover to a healthy node before pulling the "
        "module; do not hot-remove memory from a node still serving production traffic.",
        success=True,
        doc_types=["ticket", "rca"],
    ),
    dict(
        component="dimm",
        symptom_tags=["ecc_correctable_spike", "bios_reseat_attempted"],
        root_cause="Initial diagnosis suspected a loose DIMM seating after a recent chassis "
        "service event; reseating temporarily reduced correctable ECC counts but errors "
        "returned within 48 hours, confirming the module itself (not the seating) was at fault.",
        fix_action="Reseating the DIMM is not a durable fix when correctable ECC counts "
        "resume climbing within 2 days -- escalate directly to module replacement instead of "
        "re-attempting a reseat.",
        success=False,
        doc_types=["rca", "email"],
    ),
    dict(
        component="disk",
        symptom_tags=["reallocated_sectors", "pending_sectors", "smart_prefail"],
        root_cause="SMART pre-fail attributes (reallocated and pending sector counts) rising "
        "steadily over the prior week indicate the drive's media surface is degrading; this "
        "pattern preceded a hard read failure in prior incidents.",
        fix_action="Migrate data off the drive (rebuild RAID member / drain replica) before "
        "reallocated sectors exceed the vendor threshold, then hot-swap the physical disk. "
        "Do not wait for a hard failure if a backup or replication job is currently reading "
        "from this drive.",
        success=True,
        doc_types=["ticket", "rca", "manual"],
    ),
    dict(
        component="disk",
        symptom_tags=["smart_read_error_rate", "latency_spike"],
        root_cause="Elevated SMART read error rate combined with I/O latency spikes on the "
        "same physical disk, without reallocated sectors yet -- an earlier-stage precursor "
        "than the classic reallocated-sector pattern.",
        fix_action="Flag the disk for proactive replacement during the next maintenance "
        "window rather than immediate hot-swap, since no data-loss-risk threshold has been "
        "crossed yet; continue monitoring reallocation count daily.",
        success=True,
        doc_types=["ticket", "email"],
    ),
    dict(
        component="psu",
        symptom_tags=["input_voltage_drop", "output_ripple_high", "psu_fault"],
        root_cause="Input voltage sag combined with rising output ripple on one PSU in a "
        "redundant pair indicates internal capacitor degradation, typically 2-3 weeks before "
        "a hard PSU trip.",
        fix_action="Because PSUs are deployed N+1, the redundant unit can carry load during "
        "replacement -- confirm the partner PSU is healthy, then hot-swap the degrading unit. "
        "If this rack is in a backup window, verify the backup job's power draw profile "
        "doesn't push the single remaining PSU over its rated capacity before pulling the "
        "faulty one.",
        success=True,
        doc_types=["ticket", "rca", "manual"],
    ),
    dict(
        component="psu",
        symptom_tags=["fan_rpm_drop", "temp_rise"],
        root_cause="Falling PSU fan RPM paired with rising internal temperature; in one prior "
        "case this was a failing fan bearing rather than the PSU's power stage, confirmed by "
        "fan replacement resolving the temperature trend without replacing the whole PSU.",
        fix_action="Check fan RPM against the vendor's minimum spec before ordering a full "
        "PSU replacement -- a fan-only replacement is faster to source and avoids an "
        "unnecessary power-path interruption.",
        success=True,
        doc_types=["rca", "email"],
    ),
    dict(
        component="nic",
        symptom_tags=["link_flap", "crc_errors"],
        root_cause="Repeated link flaps with rising CRC error counts on a single NIC port, "
        "isolated to the port (not the switch side, confirmed via counters on both ends) -- "
        "consistent with a degrading SFP transceiver or a marginal cable.",
        fix_action="Replace the SFP transceiver and cable together before replacing the NIC "
        "card itself; this resolved the equivalent signature in prior tickets without a full "
        "card swap. If this NIC is the active path for an in-progress migration, fail over to "
        "the secondary NIC first.",
        success=True,
        doc_types=["ticket", "manual"],
    ),
    dict(
        component="nic",
        symptom_tags=["link_flap", "driver_reset_attempted"],
        root_cause="Link flaps attributed initially to a NIC driver issue; a driver update and "
        "reset were applied but flaps recurred within 24 hours, later traced to the same "
        "transceiver/cable pattern seen in other DIMM/NIC RCAs.",
        fix_action="A driver reset is not sufficient when CRC errors are also rising -- treat "
        "rising CRC alongside link flaps as a physical-layer signature (transceiver/cable), "
        "not a driver-layer issue, and skip straight to hardware replacement.",
        success=False,
        doc_types=["rca", "email"],
    ),
]

TECHS = ["J. Alvarez", "M. Chen", "S. Okafor", "R. Singh", "T. Novak", "P. Reyes"]
VENDORS = ["Dell", "HPE", "Lenovo"]


def render_body(doc_type, template, ticket_no, rack_id, server_id, tech, vendor):
    comp = template["component"].upper()
    if doc_type == "ticket":
        return (
            f"[Closed Incident {ticket_no}] Component: {comp} | Server: {server_id} | Rack: {rack_id}\n"
            f"Vendor: {vendor}\n"
            f"Symptoms observed: {', '.join(template['symptom_tags'])}.\n"
            f"Root cause: {template['root_cause']}\n"
            f"Resolution applied by {tech}: {template['fix_action']}\n"
            f"Outcome: {'Resolved, no recurrence in 30 days.' if template['success'] else 'Recurred within 72 hours; escalated to a follow-up RCA.'}"
        )
    if doc_type == "rca":
        return (
            f"Root Cause Analysis {ticket_no} -- {comp} failure signature, {vendor} platform\n"
            f"Prepared by: {tech}\n"
            f"Observed symptoms: {', '.join(template['symptom_tags'])}.\n"
            f"Analysis: {template['root_cause']}\n"
            f"Recommended and validated action: {template['fix_action']}\n"
            f"Confirmation: {'Validated across multiple servers with the same signature.' if template['success'] else 'Documented as an ineffective first response -- do not repeat.'}"
        )
    if doc_type == "manual":
        return (
            f"Vendor Service Procedure Excerpt ({vendor}) -- {comp} module replacement\n"
            f"Applicable symptom codes: {', '.join(template['symptom_tags'])}.\n"
            f"Procedure: {template['fix_action']}\n"
            f"Safety note: Always confirm redundant-path health (failover partner, RAID "
            f"rebuild target, or partner PSU) before removing a component from a live chassis."
        )
    if doc_type == "email":
        return (
            f"Subject: Re: {comp} alerts on {server_id} ({rack_id})\n"
            f"From: {tech}\n\n"
            f"Following up on the {', '.join(template['symptom_tags'])} pattern we saw last "
            f"time -- {template['root_cause']} We ended up going with: {template['fix_action']} "
            f"{'Worked, closing this out.' if template['success'] else 'Only worked temporarily, opened a formal RCA.'}"
        )
    raise ValueError(doc_type)


def generate(n_docs_per_template=6):
    docs = []
    doc_id = 0
    rack_pool = [f"RACK-{i:02d}" for i in range(1, 13)]
    for template in TEMPLATES:
        for _ in range(n_docs_per_template):
            doc_id += 1
            doc_type = random.choice(template["doc_types"])
            ticket_no = f"INC{random.randint(100000, 999999)}"
            rack_id = random.choice(rack_pool)
            server_id = f"{rack_id}-U{random.randint(1, 8)}"
            tech = random.choice(TECHS)
            vendor = random.choice(VENDORS)
            body = render_body(doc_type, template, ticket_no, rack_id, server_id, tech, vendor)
            docs.append(
                {
                    "doc_id": f"DOC-{doc_id:04d}",
                    "doc_type": doc_type,
                    "component": template["component"],
                    "symptom_tags": template["symptom_tags"],
                    "root_cause": template["root_cause"],
                    "fix_action": template["fix_action"],
                    "success": template["success"],
                    "source_ref": ticket_no,
                    "rack_id": rack_id,
                    "server_id": server_id,
                    "technician": tech,
                    "vendor": vendor,
                    "text": body,
                }
            )

    random.shuffle(docs)
    with open(OUT_DIR / "documents.jsonl", "w") as f:
        for d in docs:
            f.write(json.dumps(d) + "\n")

    import pandas as pd

    flat = []
    for d in docs:
        r = dict(d)
        r["symptom_tags"] = "|".join(r["symptom_tags"])
        flat.append(r)
    pd.DataFrame(flat).to_csv(OUT_DIR / "documents.csv", index=False)

    print(f"Generated {len(docs)} knowledge-base documents -> {OUT_DIR}")


if __name__ == "__main__":
    generate()
