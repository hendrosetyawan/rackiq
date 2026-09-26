"""
Synthetic knowledge base for RackIQ -- v2: one year of incident history.

Builds a 365-day incident log (Sep 2025 - Sep 2026) from 45 fault templates
covering the five predicted components (DIMM, disk, PSU, NIC, fan) plus
facility / platform issues (thermal, power distribution, firmware, security,
cabling). Every incident becomes a closed ServiceNow-style ticket; a subset
also produces an RCA report or a troubleshooting email thread, and each
hardware procedure gets vendor manual excerpts.

  * Failures in the last 90 days are exactly the failure events in the
    synthetic telemetry (same asset, same time), so the log, the telemetry
    and the models agree.
  * The earlier 275 days are sampled at the same per-component rate, with a
    summer bump for thermal incidents.
  * Fixes that are not durable (reseat, driver reset, ...) spawn a follow-up
    incident days later with the durable fix -- the KB therefore records
    both what worked and what did not.

Everything is synthetic (fixed seed) and standing in for an organization's
real incident corpus.

Outputs: data/kb/incidents.csv, data/kb/documents.jsonl, data/kb/documents.csv
Requires generate_telemetry.py to have run first.
"""
import json
import numpy as np
import pandas as pd
from pathlib import Path

from catalog import END, resolve_sku

SEED = 7
SYN = Path(__file__).parent
OUT = SYN.parent / "kb"
OUT.mkdir(parents=True, exist_ok=True)
START = END - pd.Timedelta(days=365)
HIST_SPLIT = END - pd.Timedelta(days=90)

# id, component, symptom tags, symptom phrasings, root cause, fix, durable prob,
# part family, qty, mttr hours (lo, hi), priority, relative weight, follow-up template
TEMPLATES = [
    # ---------------- DIMM
    ("dimm_replace", "dimm", ["ecc_correctable_spike", "ecc_uncorrectable"],
     ["correctable ECC count climbed from single digits to {n} per day, then uncorrectable errors appeared",
      "BMC SEL logged a rising correctable memory error rate ({n}/24h) on one DIMM slot",
      "memory error rate on slot {slot} kept increasing over {d} days"],
     "Failing DRAM device on the RDIMM: correctable ECC rate climbed for several days before uncorrectable errors appeared -- classic cell degradation.",
     "Replace the RDIMM identified by the SEL slot locator. If the host is serving a migration or DR role, live-migrate or fail over workloads first; never hot-remove memory from a running host.",
     0.96, "dimm", 1, (1.5, 3.0), "P2", 5.0, None),
    ("dimm_reseat", "dimm", ["ecc_correctable_spike"],
     ["correctable ECC errors after recent chassis service ({n}/24h)",
      "memory errors began right after the server was racked back in"],
     "Suspected DIMM seating issue after recent chassis work; reseating reduced correctable errors only temporarily.",
     "Reseat the DIMM and clear the SEL -- only reasonable if the host had physical service in the last 7 days. If correctable errors resume within 48 hours, escalate straight to replacement.",
     0.35, None, 0, (0.5, 1.0), "P3", 2.0, "dimm_replace"),
    ("dimm_ppr", "dimm", ["ecc_correctable_spike"],
     ["correctable errors confined to a single row address ({n}/24h)",
      "ECC errors isolated to one DRAM row on slot {slot}"],
     "Isolated single-row fault on one DRAM device; errors confined to one address range.",
     "Schedule a reboot with Post Package Repair (PPR) enabled in BIOS to remap the faulty row; watch the correctable-error rate for 72 hours and replace the DIMM if it recurs.",
     0.80, None, 0, (0.8, 1.5), "P3", 2.0, "dimm_replace"),
    ("dimm_fw_false_pos", "dimm", ["ecc_correctable_spike"],
     ["correctable error spikes on many hosts at once after a BMC update",
      "fleet-wide jump in reported correctable ECC after firmware rollout"],
     "BIOS/BMC firmware bug over-reporting correctable errors (vendor advisory) -- no actual DRAM degradation.",
     "Apply the vendor BIOS/BMC update that corrects correctable-error logging; confirm counts normalize before swapping any hardware.",
     0.90, None, 0, (0.5, 1.0), "P4", 1.0, None),
    ("dimm_airflow", "dimm", ["dimm_overtemp", "ecc_correctable_spike"],
     ["DIMM temperature {t} C with rising correctable errors",
      "memory running hot ({t} C) after a cable re-dress"],
     "Missing blanking panel / cable bundle blocking airflow raised DIMM temperature and the soft-error rate.",
     "Restore airflow (blanking panels, clear the cable obstruction) and re-check DIMM temperature before considering replacement.",
     0.88, None, 0, (0.5, 1.2), "P3", 1.5, None),
    ("dimm_ue_crash", "dimm", ["ecc_uncorrectable"],
     ["host crashed with a machine-check exception after an uncorrectable ECC error",
      "uncorrectable memory error forced a kernel panic"],
     "Uncorrectable ECC error caused a host crash; module confirmed failed by vendor diagnostics.",
     "Replace the RDIMM immediately, run vendor memory diagnostics after replacement, and review the crash dump to rule out a CPU memory-controller fault.",
     0.95, "dimm", 1, (2.0, 4.0), "P1", 1.5, None),
    ("dimm_imc", "dimm", ["ecc_uncorrectable", "ecc_correctable_spike"],
     ["errors followed the slot after the DIMM was swapped to another channel"],
     "Errors followed the CPU socket, not the DIMM -- integrated memory controller fault.",
     "Move the DIMM to a different channel as a test; if errors follow the slot/socket, escalate to vendor for CPU or motherboard replacement.",
     0.70, None, 0, (3.0, 6.0), "P2", 0.5, None),
    # ---------------- DISK
    ("disk_media_wear", "disk", ["reallocated_sectors", "pending_sectors", "smart_read_error_rate"],
     ["SMART reallocated sectors rose to {n} with pending sectors climbing",
      "predictive-failure flag: reallocated and pending sector counts rising for {d} days"],
     "Drive media degradation: reallocated and pending sector counts rising steadily -- the pattern that preceded hard read failures in prior incidents.",
     "Drain the replica / rebuild the RAID member onto a healthy drive, then hot-swap the drive. Do not wait for a hard failure if a backup or replication job is currently reading from it.",
     0.97, "disk", 1, (1.0, 2.5), "P2", 5.0, None),
    ("disk_early_latency", "disk", ["smart_read_error_rate", "latency_spike"],
     ["I/O latency spiking to {lat} ms with rising read error rate, no reallocations yet",
      "read error rate creeping up and latency spikes on one drive"],
     "Rising SMART read error rate with I/O latency spikes but no reallocated sectors yet -- an earlier-stage precursor.",
     "Flag the drive for proactive replacement in the next maintenance window, move latency-sensitive volumes off it, and check the reallocation count daily.",
     0.90, "disk", 1, (0.8, 1.5), "P3", 3.0, None),
    ("disk_hdd_head", "disk", ["pending_sectors", "latency_spike"],
     ["HDD pending sectors at {n} and retry-driven latency of {lat} ms"],
     "HDD head degradation causing pending sectors and retry-driven latency.",
     "Mark the HDD failed in the storage array, let the pool rebuild to a hot spare, then replace the drive.",
     0.95, "disk", 1, (1.0, 3.0), "P2", 2.0, None),
    ("disk_fw_stall", "disk", ["latency_spike"],
     ["periodic 30-second I/O stalls on drives of the same model"],
     "Drive firmware bug causing periodic latency stalls (vendor advisory) -- media healthy.",
     "Update drive firmware in a rolling fashion; replacement is unnecessary while SMART media counters stay clean.",
     0.90, None, 0, (1.0, 2.0), "P3", 1.5, None),
    ("disk_backplane", "disk", ["smart_read_error_rate", "latency_spike"],
     ["link-reset errors that followed the bay after the drive was moved"],
     "Intermittent errors followed the bay, not the drive -- backplane or connector fault.",
     "Move the drive to another bay as a test; if errors follow the bay, have the vendor replace the backplane cable/backplane.",
     0.80, None, 0, (2.0, 4.0), "P2", 0.8, None),
    ("disk_overtemp", "disk", ["disk_overtemp", "latency_spike"],
     ["drive temperature {t} C and thermal throttling"],
     "Drive overheating because a drive-cage fan failed, causing thermal throttling.",
     "Replace the failed drive-cage fan first; drive temperature and latency normalize without replacing the drive.",
     0.90, "fan", 1, (0.5, 1.0), "P3", 1.0, None),
    ("disk_reseat", "disk", ["smart_read_error_rate"],
     ["drive reseated after link resets; SMART read error rate kept rising"],
     "Drive reseated after link-reset errors; errors resumed within days.",
     "Reseating is not a durable fix when the SMART read error rate keeps rising -- replace the drive.",
     0.30, None, 0, (0.3, 0.8), "P3", 1.5, "disk_media_wear"),
    # ---------------- PSU
    ("psu_capacitor", "psu", ["input_voltage_drop", "output_ripple_high"],
     ["input voltage sagging to {v} V with output ripple at {r} mV on one PSU",
      "PSU {slot} showed ripple climbing past spec for {d} days"],
     "Input sag with rising output ripple on one PSU of a redundant pair -- capacitor degradation, typically 2-3 weeks before a hard trip.",
     "Confirm the partner PSU is healthy, then hot-swap the degrading unit. In a backup window, first verify the remaining PSU can carry the backup job's peak draw.",
     0.96, "psu", 1, (0.5, 1.2), "P2", 4.0, None),
    ("psu_fan", "psu", ["psu_fan_rpm_drop", "psu_overtemp"],
     ["PSU fan down to {rpm} RPM and PSU temperature {t} C"],
     "Failing PSU fan bearing (not the power stage) raising PSU temperature.",
     "PSU fans are not field-serviceable on this platform -- replace the PSU proactively in the next maintenance window, before thermal shutdown.",
     0.95, "psu", 1, (0.5, 1.0), "P3", 2.0, None),
    ("psu_pdu_feed", "psu", ["input_voltage_drop"],
     ["both PSUs on the same feed reported low input voltage ({v} V)"],
     "Voltage sag traced to the upstream PDU outlet/whip, not the PSU (both PSUs on that feed showed it).",
     "Move the PSU cord to a healthy outlet on the correct A/B feed and open a facilities ticket for the PDU circuit -- do not replace the PSU.",
     0.92, None, 0, (0.5, 2.0), "P2", 1.5, None),
    ("psu_efficiency", "psu", ["psu_efficiency_drop", "psu_overtemp"],
     ["PSU efficiency down to {eff}% with rising temperature"],
     "PSU efficiency dropping (more heat per watt delivered) -- aging power stage.",
     "Replace the PSU proactively; the efficiency loss adds rack heat load and precedes failure.",
     0.93, "psu", 1, (0.5, 1.0), "P3", 1.5, None),
    ("psu_fw_ripple", "psu", ["output_ripple_high"],
     ["spurious ripple warnings on several PSUs right after a BMC update"],
     "PSU firmware reporting spurious ripple warnings after a BMC update.",
     "Update PSU firmware to the version paired with the current BMC and verify with a calibrated meter before replacing hardware.",
     0.85, None, 0, (0.5, 1.0), "P4", 0.8, None),
    ("psu_reseat", "psu", ["input_voltage_drop"],
     ["PSU reseated after an 'input lost' alarm; the alarm returned"],
     "PSU reseated after an input-lost alarm; the alarm recurred.",
     "Reseating a PSU with repeated input-lost events is not durable -- check the cord and PDU outlet, then replace the PSU if the feed is healthy.",
     0.40, None, 0, (0.3, 0.6), "P3", 1.0, "psu_capacitor"),
    # ---------------- NIC
    ("nic_sfp", "nic", ["link_flap", "crc_errors"],
     ["{n} link flaps per day with CRC errors rising on one port",
      "port flapping and CRC counters climbing on the host side only"],
     "Link flaps with rising CRC errors isolated to the host side of one port -- degrading SFP transceiver or marginal cable.",
     "Replace the SFP transceiver and cable together before touching the NIC. If this NIC carries an in-progress migration, fail over to the secondary port first.",
     0.90, "sfp", 1, (0.3, 1.0), "P2", 4.0, None),
    ("nic_driver_reset", "nic", ["link_flap", "crc_errors"],
     ["link flaps blamed on the driver; flaps returned within a day of a driver reset"],
     "Flaps attributed to a driver issue; a driver reset was applied but flaps returned within 24 hours (a physical-layer signature).",
     "A driver reset is not sufficient when CRC errors are rising -- treat it as a physical-layer fault and replace the transceiver and cable.",
     0.25, None, 0, (0.3, 0.8), "P3", 1.5, "nic_sfp"),
    ("nic_card", "nic", ["packet_loss", "crc_errors", "nic_overtemp"],
     ["packet loss of {pl}% persisted after the transceiver and cable were replaced"],
     "NIC ASIC degradation: packet loss persisted after transceiver and cable replacement; NIC temperature elevated.",
     "Replace the NIC card in a maintenance window after failing workloads over to the redundant NIC.",
     0.94, "nic", 1, (1.0, 2.5), "P2", 2.0, None),
    ("nic_dac", "nic", ["crc_errors"],
     ["CRC errors on a DAC link after a rack re-cable"],
     "Damaged DAC cable (bend-radius violation) causing CRC errors.",
     "Replace the DAC cable and re-dress it with the correct bend radius.",
     0.93, "cable", 1, (0.3, 0.8), "P3", 1.5, None),
    ("nic_switch_port", "nic", ["link_flap"],
     ["flaps visible on both ends, errors counted on the switch side"],
     "Flaps originated on the switch side -- ToR switch port or optic fault.",
     "Compare counters on both ends, move to a spare ToR port and open a network ticket; no host hardware change needed.",
     0.90, None, 0, (0.5, 1.5), "P3", 1.2, None),
    ("nic_fw_drops", "nic", ["packet_loss"],
     ["packet drops under high RSS load on one NIC model"],
     "NIC firmware bug dropping packets under high RSS load.",
     "Update NIC firmware and driver to the fixed release in a rolling window.",
     0.88, None, 0, (0.8, 1.5), "P3", 1.0, None),
    ("nic_airflow", "nic", ["nic_overtemp", "packet_loss"],
     ["NIC temperature {t} C behind a dense cable bundle"],
     "NIC overheating because airflow is blocked behind a rear cable bundle.",
     "Re-dress rear cabling to clear the NIC airflow path and verify the temperature drops.",
     0.85, None, 0, (0.5, 1.0), "P3", 0.8, None),
    # ---------------- FAN
    ("fan_bearing", "fan", ["fan_rpm_drop", "fan_vibration"],
     ["fan down to {rpm} RPM at the same PWM duty with vibration {vib} mm/s",
      "vibration rising for {d} days while fan speed fell"],
     "Fan bearing wear: vibration rising and RPM falling at constant PWM duty -- precedes seizure.",
     "Hot-swap the fan module (N+1 redundant) and verify the remaining fans ramp correctly during the swap.",
     0.97, "fan", 1, (0.2, 0.6), "P3", 5.0, None),
    ("fan_current", "fan", ["fan_current_rise", "fan_rpm_drop"],
     ["fan motor current up to {cur} A to hold speed"],
     "Motor current rising to hold RPM -- winding or bearing degradation.",
     "Replace the fan module proactively; the current rise precedes failure by days.",
     0.95, "fan", 1, (0.2, 0.6), "P3", 2.0, None),
    ("fan_dust", "fan", ["fan_vibration"],
     ["vibration {vib} mm/s with a dusty intake filter"],
     "Dust accumulation / imbalance causing vibration; fan otherwise healthy.",
     "Clean the fan module and filter; replace only if vibration persists after cleaning.",
     0.70, None, 0, (0.3, 0.8), "P4", 1.5, "fan_bearing"),
    ("fan_bmc_curve", "fan", ["fan_rpm_drop"],
     ["all fans in a chassis under-spinning after a BMC update"],
     "BMC fan curve misconfigured after a firmware update -- fans under-spinning, not failing.",
     "Restore the vendor thermal profile / fan curve in BMC settings; no hardware change.",
     0.90, None, 0, (0.3, 0.8), "P4", 1.0, None),
    ("fan_connector", "fan", ["fan_rpm_drop"],
     ["intermittent tach dropouts on one fan"],
     "Intermittent RPM dropouts traced to a loose fan connector.",
     "Reseat the fan module connector and confirm stable tach readings.",
     0.75, None, 0, (0.2, 0.5), "P4", 0.8, "fan_bearing"),
    ("fan_double", "fan", ["fan_rpm_drop", "fan_current_rise"],
     ["two fans in the same chassis degraded, remaining fans at 100%"],
     "Two fans in the same chassis degraded, forcing the rest to maximum and risking thermal shutdown.",
     "Replace both fan modules in the same visit and check chassis inlet temperature on neighbouring servers.",
     0.96, "fan", 2, (0.4, 1.0), "P2", 0.7, None),
    # ---------------- facility / platform (not predicted per component)
    ("thermal_crac", "thermal", ["inlet_overtemp", "hot_spot"],
     ["inlet temperatures up to {t} C across {k} adjacent racks in one cooling zone"],
     "CRAC unit compressor degradation reduced cooling capacity for its zone; inlet temperatures rose across adjacent racks.",
     "Open a facilities work order for the CRAC unit, temporarily raise neighbouring CRAC output, and add perforated tiles in the affected cold aisle.",
     0.90, None, 0, (4.0, 12.0), "P2", 1.2, None),
    ("thermal_blanking", "thermal", ["inlet_overtemp", "hot_air_recirculation"],
     ["inlet {t} C on top-of-rack servers, hot-air recirculation through empty U spaces"],
     "Missing blanking panels allowed hot-aisle air to recirculate into server inlets.",
     "Install blanking panels in every empty U position and confirm inlet temperatures drop within the hour.",
     0.95, None, 0, (0.5, 1.5), "P3", 1.5, None),
    ("thermal_containment", "thermal", ["inlet_overtemp"],
     ["hot-aisle containment door propped open during maintenance"],
     "Hot-aisle containment door left open during maintenance.",
     "Close/repair the containment door and add a door-open alarm to the BMS.",
     0.95, None, 0, (0.3, 1.0), "P3", 1.0, None),
    ("thermal_tiles", "thermal", ["inlet_overtemp", "hot_spot"],
     ["high-density racks starved of cold air after new GPU servers were installed"],
     "Perforated tile layout not matched to rack load after high-density servers were added.",
     "Rebalance perforated tiles and add high-flow grates in front of high-density racks.",
     0.90, None, 0, (1.0, 3.0), "P3", 0.8, None),
    ("power_breaker", "power", ["input_voltage_drop", "power_loss"],
     ["A-feed lost for half the rack after a branch breaker trip"],
     "PDU branch breaker tripped under the combined load of newly added servers.",
     "Rebalance servers across PDU branches, reset the breaker after a load review, and keep every branch under 80% of rating.",
     0.90, None, 0, (1.0, 3.0), "P1", 0.8, None),
    ("power_phase", "power", ["input_voltage_drop"],
     ["phase imbalance alarm on a rack PDU after server moves"],
     "Phase imbalance on the rack PDU after server moves.",
     "Rebalance loads across phases and update the rack power plan in DCIM.",
     0.90, None, 0, (0.5, 1.5), "P3", 0.7, None),
    ("power_cap", "power", ["cpu_throttle"],
     ["CPU throttling across a rack during the nightly backup window"],
     "Rack power capping triggered CPU throttling during the backup window.",
     "Adjust the power-cap policy and stagger backup jobs across racks.",
     0.85, None, 0, (0.5, 1.5), "P3", 0.6, None),
    ("fw_bmc_hang", "firmware", ["bmc_unresponsive"],
     ["telemetry gaps: BMC unresponsive to Redfish and IPMI"],
     "BMC firmware memory leak causing an unresponsive management controller (telemetry gaps).",
     "Reset the BMC (host unaffected), then roll out the fixed BMC firmware in a rolling window.",
     0.88, None, 0, (0.3, 1.0), "P3", 1.2, None),
    ("fw_baseline", "firmware", ["config_drift"],
     ["hosts drifted from the approved BIOS baseline"],
     "Hosts drifted from the approved BIOS baseline, causing inconsistent power/performance settings.",
     "Re-apply the golden BIOS profile from the management server.",
     0.95, None, 0, (0.3, 1.0), "P4", 0.8, None),
    ("sec_brute_force", "firmware", ["auth_failures"],
     ["{n} failed BMC logins in 24 hours from one internal address"],
     "Repeated failed BMC logins from an internal scanner misconfigured with stale credentials.",
     "Block the source on the management-VLAN ACL, rotate BMC credentials, and correct the scanner configuration.",
     0.95, None, 0, (0.5, 2.0), "P2", 0.6, None),
    ("cable_mispatch", "cabling", ["link_flap"],
     ["VLAN mismatch and flaps after a server was re-patched during migration"],
     "Server patched to the wrong ToR port during migration, causing VLAN mismatch and flaps.",
     "Correct the patching per the cable plan and update the DCIM port mapping.",
     0.95, None, 0, (0.3, 1.0), "P3", 0.8, None),
    ("cable_strain", "cabling", ["crc_errors"],
     ["CRC errors on several ports after a rack reshuffle"],
     "Cable bundle strain after a rack reshuffle damaged DAC cables.",
     "Re-dress the cabling and replace the damaged DAC cables.",
     0.90, "cable", 2, (0.5, 1.5), "P3", 0.7, None),
]
KEYS = ["id", "component", "symptoms", "phrasings", "root_cause", "fix_action", "durable", "part", "qty", "mttr",
        "priority", "weight", "follow_up"]
TPL = {t[0]: dict(zip(KEYS, t)) for t in TEMPLATES}
PREDICTED = ["dimm", "disk", "psu", "nic", "fan"]
PLATFORM = ["thermal", "power", "firmware", "cabling"]
HOT_SWAP = {"disk", "psu", "fan", "sfp", "cable"}
TECHS = ["J. Alvarez", "M. Chen", "S. Okafor", "R. Singh", "T. Novak", "P. Reyes", "A. Kim", "L. Moreau",
         "D. Haddad", "K. Watanabe", "E. Johansson", "N. Patel"]
STATES = ["normal"] * 23 + ["migration", "backup_window", "dr_failover", "maintenance_window"]


def pick_template(rng, component):
    cands = [t for t in TPL.values() if t["component"] == component]
    w = np.array([t["weight"] for t in cands])
    return cands[rng.choice(len(cands), p=w / w.sum())]


def fill(rng, text):
    return text.format(n=int(rng.integers(12, 90)), d=int(rng.integers(2, 10)), slot=f"{rng.choice(list('ABCDEFGH'))}{rng.integers(1, 9)}",
                       t=round(float(rng.uniform(29, 36)), 1), lat=round(float(rng.uniform(4, 14)), 1),
                       v=round(float(rng.uniform(199, 203)), 1), r=int(rng.integers(45, 70)), rpm=int(rng.integers(3500, 6500)),
                       eff=round(float(rng.uniform(86, 90)), 1), pl=round(float(rng.uniform(0.4, 1.6)), 2),
                       vib=round(float(rng.uniform(3.5, 6.5)), 1), cur=round(float(rng.uniform(1.2, 1.6)), 2),
                       k=int(rng.integers(3, 6)))


def make_incident(rng, seq, tpl, opened, server, asset_id, state=None):
    mttr = float(rng.uniform(*tpl["mttr"]))
    durable = rng.random() < tpl["durable"]
    part = tpl["part"]
    sku = resolve_sku(part, server["vendor"], server["workload"]) if part else None
    state = state or rng.choice(STATES)
    if part in HOT_SWAP or part is None and tpl["component"] in ("fan", "thermal", "firmware", "cabling"):
        downtime = int(rng.integers(0, 6))
    elif tpl["component"] == "power" and tpl["priority"] == "P1":
        downtime = int(rng.integers(30, 180))
    else:
        downtime = 0 if rng.random() < 0.5 else int(mttr * 60 * rng.uniform(0.3, 0.8))  # 0 if workload migrated first
    prio = tpl["priority"]
    if state in ("dr_failover", "migration") and prio in ("P3", "P4"):
        prio = "P2"
    return dict(
        ticket_id=f"INC{104000 + seq:07d}", opened_at=opened, resolved_at=opened + pd.Timedelta(hours=mttr),
        rack_id=server["rack_id"], server_id=server["server_id"], asset_id=asset_id, component=tpl["component"],
        vendor=server["vendor"], model=server["model"], workload=server["workload"], template_id=tpl["id"],
        symptom=fill(rng, rng.choice(tpl["phrasings"])), symptom_tags="|".join(tpl["symptoms"]),
        root_cause=tpl["root_cause"], fix_action=tpl["fix_action"], outcome="resolved" if durable else "recurred",
        part_sku=sku, part_qty=tpl["qty"] if sku else 0, mttr_h=round(mttr, 2), downtime_min=downtime,
        priority=prio, technician=rng.choice(TECHS), op_state=state,
        sla_breached=bool(prio == "P1" and mttr > 3 or downtime > 60),
    )


def build_incidents(rng):
    servers = pd.read_csv(SYN / "servers.csv").set_index("server_id", drop=False)
    assets = pd.read_csv(SYN / "assets.csv")
    fe = pd.read_csv(SYN / "failure_events.csv", parse_dates=["failure_timestamp"])
    rows, seq = [], 0

    def add(tpl, opened, server, asset_id, state=None, allow_follow=True):
        nonlocal seq
        inc = make_incident(rng, seq, tpl, opened, server, asset_id, state)
        seq += 1
        rows.append(inc)
        if allow_follow and inc["outcome"] == "recurred":
            nxt = TPL[tpl["follow_up"]] if tpl["follow_up"] else tpl
            follow_at = opened + pd.Timedelta(hours=float(rng.uniform(24, 120)))
            if follow_at < END:
                f = make_incident(rng, seq, nxt, follow_at, server, asset_id, inc["op_state"])
                f["outcome"] = "resolved"
                f["symptom"] = f"Recurrence of {inc['ticket_id']}: " + f["symptom"]
                seq += 1
                rows.append(f)

    # 1) last 90 days: exactly the telemetry failure events
    for _, e in fe.iterrows():
        opened = e.failure_timestamp - pd.Timedelta(hours=float(rng.uniform(0, 12)))
        add(pick_template(rng, e.component), opened, servers.loc[e.server_id], e.asset_id)

    # 2) the earlier 275 days, same per-component rate
    days = pd.date_range(START, HIST_SPLIT, freq="D", inclusive="left")
    rate = fe.groupby("component").size() / 90.0
    by_comp = {c: assets[assets.component == c] for c in PREDICTED}
    for day in days:
        for comp in PREDICTED:
            for _ in range(rng.poisson(rate.get(comp, 0.5))):
                a = by_comp[comp].iloc[rng.integers(len(by_comp[comp]))]
                add(pick_template(rng, comp), day + pd.Timedelta(minutes=int(rng.integers(0, 1440))), servers.loc[a.server_id], a.asset_id)

    # 3) platform / facility incidents across the whole year (summer thermal bump)
    all_days = pd.date_range(START, END, freq="D", inclusive="left")
    for day in all_days:
        summer = 1.8 if day.month in (6, 7, 8, 9) else 1.0
        for comp, lam in (("thermal", 0.12 * summer), ("power", 0.07), ("firmware", 0.10), ("cabling", 0.06)):
            for _ in range(rng.poisson(lam)):
                s = servers.iloc[rng.integers(len(servers))]
                add(pick_template(rng, comp), day + pd.Timedelta(minutes=int(rng.integers(0, 1440))), s, None)

    inc = pd.DataFrame(rows).sort_values("opened_at").reset_index(drop=True)
    inc = inc[inc.opened_at < END]
    return inc


def doc_texts(rng, inc):
    docs = []
    did = 0

    def add(doc_type, row, text, success, source_ref, date):
        nonlocal did
        did += 1
        docs.append(dict(doc_id=f"DOC-{did:05d}", doc_type=doc_type, component=row["component"],
                         symptom_tags=row["symptom_tags"].split("|"), root_cause=row["root_cause"],
                         fix_action=row["fix_action"], template_id=row["template_id"], success=bool(success),
                         source_ref=source_ref, rack_id=row.get("rack_id"), server_id=row.get("server_id"),
                         technician=row.get("technician"), vendor=row.get("vendor"), date=str(date)[:10],
                         part_sku=row.get("part_sku"), text=text))

    for _, r in inc.iterrows():
        parts = f"{r.part_qty} x {r.part_sku}" if isinstance(r.part_sku, str) else "none"
        outcome = "Resolved; no recurrence in 30 days." if r.outcome == "resolved" else "Recurred; escalated to a follow-up ticket."
        text = (f"[Closed Incident {r.ticket_id}] {r.priority} | {r.component.upper()} | {r.server_id} ({r.vendor} {r.model}, {r.workload})\n"
                f"Opened {str(r.opened_at)[:16]} | MTTR {r.mttr_h:.1f} h | downtime {r.downtime_min} min | context: {r.op_state}\n"
                f"Symptoms: {r.symptom}.\nRoot cause: {r.root_cause}\nResolution ({r.technician}): {r.fix_action}\n"
                f"Parts used: {parts}. Outcome: {outcome}")
        add("ticket", r, text, r.outcome == "resolved", r.ticket_id, r.opened_at)

        if r.priority in ("P1", "P2") and rng.random() < 0.3 or r.outcome == "recurred" and rng.random() < 0.6:
            text = (f"Root Cause Analysis for {r.ticket_id} -- {r.component.upper()} on {r.vendor} {r.model}\n"
                    f"Prepared by {r.technician}, {str(r.resolved_at)[:10]}.\nImpact: {r.downtime_min} min downtime, {r.priority}, "
                    f"operational context {r.op_state}.\nTimeline: {r.symptom}.\nAnalysis: {r.root_cause}\n"
                    f"Corrective action: {r.fix_action}\n"
                    + ("Lesson: this first response did NOT hold -- do not repeat it as the primary fix." if r.outcome == "recurred"
                       else "Validated: the fix held; apply to the same signature fleet-wide."))
            add("rca", r, text, r.outcome == "resolved", r.ticket_id, r.resolved_at)

        if rng.random() < 0.07:
            text = (f"Subject: Re: {r.component.upper()} alerts on {r.server_id} ({r.rack_id})\nFrom: {r.technician}\n\n"
                    f"Seeing the same thing as last time -- {r.symptom}. {r.root_cause} Plan is: {r.fix_action} "
                    + ("Worked, closing." if r.outcome == "resolved" else "Only held briefly, opening a follow-up."))
            add("email", r, text, r.outcome == "resolved", r.ticket_id, r.opened_at)

    for t in TPL.values():  # vendor procedure excerpts for hardware fixes
        if not t["part"]:
            continue
        for vendor in ("Dell", "HPE", "Lenovo"):
            r = dict(component=t["component"], symptom_tags="|".join(t["symptoms"]), root_cause=t["root_cause"],
                     fix_action=t["fix_action"], template_id=t["id"], vendor=vendor, part_sku=None)
            text = (f"Vendor Service Procedure ({vendor}) -- {t['component'].upper()} {t['part']} replacement\n"
                    f"Applicable symptom codes: {', '.join(t['symptoms'])}.\nProcedure: {t['fix_action']}\n"
                    f"Safety: confirm redundant-path health (failover partner, RAID rebuild target, partner PSU/fan) "
                    f"before removing a component from a live chassis. Estimated service time {t['mttr'][0]:.1f}-{t['mttr'][1]:.1f} h.")
            add("manual", r, text, t["durable"] >= 0.8, f"{vendor[:3].upper()}-SP-{t['id'].upper()}", "2025-01-01")
    return docs


def generate():
    rng = np.random.default_rng(SEED)
    inc = build_incidents(rng)
    inc.to_csv(OUT / "incidents.csv", index=False)
    docs = doc_texts(rng, inc)
    with open(OUT / "documents.jsonl", "w") as f:
        for d in docs:
            f.write(json.dumps(d) + "\n")
    flat = pd.DataFrame(docs)
    flat["symptom_tags"] = flat.symptom_tags.map("|".join)
    flat.to_csv(OUT / "documents.csv", index=False)
    pd.DataFrame([dict(template_id=t["id"], component=t["component"], part=t["part"], qty=t["qty"],
                       durable_prior=t["durable"], priority=t["priority"], mttr_lo=t["mttr"][0], mttr_hi=t["mttr"][1],
                       symptoms="|".join(t["symptoms"]), follow_up=t["follow_up"]) for t in TPL.values()]
                 ).to_csv(OUT / "templates.csv", index=False)
    print(f"incidents: {len(inc)} over {inc.opened_at.min().date()} .. {inc.opened_at.max().date()}")
    print(inc.groupby("component").size().to_dict())
    print(f"documents: {len(docs)} {pd.Series([d['doc_type'] for d in docs]).value_counts().to_dict()}")


if __name__ == "__main__":
    generate()
