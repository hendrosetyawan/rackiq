"""
Synthetic hardware telemetry generator for RackIQ.

Simulates BMC/iDRAC/iLO-style telemetry (ECC/DIMM error counters, SMART disk
attributes, PSU/fan/temperature readings, NIC link-flap counts) for a fleet of
data-center assets, with engineered pre-failure signatures so the predictive
model in `backend/app/ml` has genuine signal to learn from.

This is clearly-labeled synthetic data (no real hardware/vendor telemetry was
available for the prototype). Swap this module for a Redfish/SNMP collector
against real BMC/iDRAC/iLO endpoints for production use -- see
docs/TECHNICAL_DOCUMENTATION.md "Upgrade path".

Output: data/synthetic/telemetry.csv, data/synthetic/failure_events.csv,
        data/synthetic/assets.csv, data/synthetic/operational_context.csv
"""
import numpy as np
import pandas as pd
from pathlib import Path
from datetime import datetime, timedelta

RNG_SEED = 42
OUT_DIR = Path(__file__).parent

N_RACKS = 12
SLOTS_PER_RACK = 8
COMPONENTS = ["dimm", "disk", "psu", "nic"]
DAYS_HISTORY = 90
READINGS_PER_DAY = 4  # every 6 hours
VENDORS = ["Dell", "HPE", "Lenovo"]

# The most recent TAIL readings represent "right now" for the live dashboard.
# A subset of assets are placed into an active, not-yet-failed degradation
# trajectory within this tail so the API has real elevated-risk assets to
# show. This tail is excluded from model TRAINING (see backend/app/ml
# TAIL_HOLDOUT_READINGS, which must match) so training labels stay clean --
# it is only ever read as "live" telemetry at serve time.
CURRENT_TAIL_READINGS = 16  # 4 days
P_CURRENTLY_DEGRADING = 0.16


def build_assets(rng):
    rows = []
    asset_id = 0
    for rack in range(1, N_RACKS + 1):
        rack_id = f"RACK-{rack:02d}"
        vendor = VENDORS[rack % len(VENDORS)]
        for slot in range(1, SLOTS_PER_RACK + 1):
            asset_id += 1
            for component in COMPONENTS:
                rows.append(
                    {
                        "asset_id": f"AST-{asset_id:04d}-{component.upper()}",
                        "rack_id": rack_id,
                        "slot": slot,
                        "server_id": f"{rack_id}-U{slot}",
                        "component": component,
                        "vendor": vendor,
                    }
                )
    return pd.DataFrame(rows)


def component_baseline(component, rng):
    """Healthy-state baseline generator for a component's telemetry."""
    if component == "dimm":
        return {
            "ecc_correctable_24h": rng.poisson(0.4),
            "ecc_uncorrectable_24h": 0,
            "temp_c": rng.normal(42, 3),
        }
    if component == "disk":
        return {
            "reallocated_sectors": rng.poisson(0.05),
            "pending_sectors": rng.poisson(0.02),
            "smart_read_error_rate": rng.normal(2, 0.5),
            "temp_c": rng.normal(38, 3),
        }
    if component == "psu":
        return {
            "input_voltage_v": rng.normal(208, 2),
            "output_ripple_mv": rng.normal(20, 3),
            "fan_rpm": rng.normal(6000, 200),
            "temp_c": rng.normal(45, 3),
        }
    if component == "nic":
        return {
            "link_flap_count_24h": rng.poisson(0.1),
            "crc_errors_24h": rng.poisson(0.3),
            "temp_c": rng.normal(40, 3),
        }
    raise ValueError(component)


def inject_degradation(component, day_frac, rng):
    """
    day_frac in [0, 1]: fraction of the way through a pre-failure degradation
    window (0 = just started degrading, 1 = failure day). Returns a dict of
    telemetry deltas layered on top of the healthy baseline.
    """
    severity = day_frac ** 1.5  # accelerating degradation curve
    if component == "dimm":
        return {
            "ecc_correctable_24h": rng.poisson(2 + 40 * severity),
            "ecc_uncorrectable_24h": rng.poisson(3 * severity),
            "temp_c": 3 * severity,
        }
    if component == "disk":
        return {
            "reallocated_sectors": rng.poisson(1 + 15 * severity),
            "pending_sectors": rng.poisson(1 + 8 * severity),
            "smart_read_error_rate": 6 * severity,
            "temp_c": 4 * severity,
        }
    if component == "psu":
        return {
            "input_voltage_v": -6 * severity,
            "output_ripple_mv": 40 * severity,
            "fan_rpm": -1500 * severity,
            "temp_c": 8 * severity,
        }
    if component == "nic":
        return {
            "link_flap_count_24h": rng.poisson(1 + 10 * severity),
            "crc_errors_24h": rng.poisson(2 + 20 * severity),
            "temp_c": 2 * severity,
        }
    raise ValueError(component)


def generate(seed=RNG_SEED):
    rng = np.random.default_rng(seed)
    assets = build_assets(rng)

    start = datetime(2026, 6, 24)  # 90 days before ~Sep 22
    timestamps = [start + timedelta(hours=6 * i) for i in range(DAYS_HISTORY * READINGS_PER_DAY)]

    telemetry_rows = []
    failure_events = []

    # Decide which assets fail during the window, and when.
    tail_start_global = len(timestamps) - CURRENT_TAIL_READINGS

    for _, asset in assets.iterrows():
        component = asset["component"]
        will_fail = rng.random() < 0.22  # ~22% of components experience a failure precursor
        failure_reading_idx = None
        degrade_window_readings = rng.integers(8, 40)  # 2-10 days of degradation before failure
        if will_fail:
            # Historical failure must fully resolve BEFORE the "current" tail begins, so it
            # never leaks into live-scoring input and never contaminates the held-out tail.
            latest_possible = tail_start_global - 2
            earliest_possible = degrade_window_readings + 4
            if latest_possible > earliest_possible:
                failure_reading_idx = int(rng.integers(earliest_possible, latest_possible))
            else:
                will_fail = False

        # Assets that did NOT have a historical failure are candidates for an
        # active, ongoing (not-yet-failed) degradation right now, in the tail.
        currently_degrading = False
        tail_start_idx = None
        target_severity = None
        if not will_fail and rng.random() < P_CURRENTLY_DEGRADING:
            currently_degrading = True
            tail_start_idx = tail_start_global + int(rng.integers(0, max(CURRENT_TAIL_READINGS - 4, 1)))
            target_severity = float(rng.uniform(0.35, 0.95))

        for idx, ts in enumerate(timestamps):
            reading = {k: v for k, v in component_baseline(component, rng).items()}
            in_degrade_window = (
                failure_reading_idx is not None
                and failure_reading_idx - degrade_window_readings <= idx <= failure_reading_idx
            )
            if in_degrade_window:
                day_frac = (idx - (failure_reading_idx - degrade_window_readings)) / max(
                    degrade_window_readings, 1
                )
                delta = inject_degradation(component, day_frac, rng)
                for k, v in delta.items():
                    reading[k] = reading.get(k, 0) + v
            elif currently_degrading and idx >= tail_start_idx:
                span = max(len(timestamps) - 1 - tail_start_idx, 1)
                day_frac = ((idx - tail_start_idx) / span) * target_severity
                delta = inject_degradation(component, day_frac, rng)
                for k, v in delta.items():
                    reading[k] = reading.get(k, 0) + v

            row = {"asset_id": asset["asset_id"], "timestamp": ts.isoformat(), **reading}
            telemetry_rows.append(row)

        if failure_reading_idx is not None:
            failure_events.append(
                {
                    "asset_id": asset["asset_id"],
                    "component": component,
                    "failure_timestamp": timestamps[failure_reading_idx].isoformat(),
                    "degrade_window_start": timestamps[
                        max(failure_reading_idx - degrade_window_readings, 0)
                    ].isoformat(),
                }
            )

    telemetry = pd.DataFrame(telemetry_rows)

    # Operational context: which racks are currently mid-migration / backup / DR failover.
    # A handful of racks are flagged "hot" (operationally sensitive right now) for the demo.
    context_rows = []
    hot_racks = rng.choice(assets["rack_id"].unique(), size=3, replace=False)
    for rack_id in assets["rack_id"].unique():
        if rack_id in hot_racks:
            state = rng.choice(["migration", "backup_window", "dr_failover"])
        else:
            state = "normal"
        context_rows.append(
            {
                "rack_id": rack_id,
                "operational_state": state,
                "as_of": timestamps[-1].isoformat(),
            }
        )
    operational_context = pd.DataFrame(context_rows)

    assets.to_csv(OUT_DIR / "assets.csv", index=False)
    telemetry.to_csv(OUT_DIR / "telemetry.csv", index=False)
    pd.DataFrame(failure_events).to_csv(OUT_DIR / "failure_events.csv", index=False)
    operational_context.to_csv(OUT_DIR / "operational_context.csv", index=False)

    print(f"assets: {len(assets)} rows")
    print(f"telemetry: {len(telemetry)} rows across {telemetry['asset_id'].nunique()} assets")
    print(f"failure_events: {len(failure_events)} labeled precursor windows")
    print(f"operational_context: {len(operational_context)} racks, hot racks = {list(hot_racks)}")


if __name__ == "__main__":
    generate()
