"""
Feature engineering for RackIQ's predictive failure-scoring layer.

Turns raw per-reading telemetry into a labeled, windowed feature table per
component type: for every asset, at every point in time, compute short-window
rolling statistics (mean, slope/rate-of-change, max) over the component's
relevant telemetry channels, and label the window as failure-imminent (1) if
a real failure event occurs within FAILURE_HORIZON_READINGS of that point.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

FAILURE_HORIZON_READINGS = 12  # 3 days at 4 readings/day: "will this fail in the next 3 days?"
ROLL_WINDOW = 8  # 2-day rolling window for trend features

# Must match CURRENT_TAIL_READINGS in data/synthetic/generate_telemetry.py.
# That many most-recent readings per asset are reserved as "live" telemetry
# (some assets are mid-degradation there, not-yet-failed) and held out of
# training so labels stay clean -- see that file's module docstring.
TAIL_HOLDOUT_READINGS = 16

COMPONENT_CHANNELS = {
    "dimm": ["ecc_correctable_24h", "ecc_uncorrectable_24h", "temp_c"],
    "disk": ["reallocated_sectors", "pending_sectors", "smart_read_error_rate", "temp_c"],
    "psu": ["input_voltage_v", "output_ripple_mv", "fan_rpm", "temp_c"],
    "nic": ["link_flap_count_24h", "crc_errors_24h", "temp_c"],
}


def _asset_component(asset_id: str) -> str:
    # asset_id format: AST-0001-DIMM
    return asset_id.rsplit("-", 1)[-1].lower()


def build_feature_table(
    telemetry: pd.DataFrame,
    failure_events: pd.DataFrame,
    component: str,
    exclude_tail_readings: int = 0,
) -> pd.DataFrame:
    """
    Returns a feature table for a single component type with columns:
    asset_id, timestamp, <feature columns>, label

    If exclude_tail_readings > 0, the most recent N readings of each asset's
    series are dropped from the *returned* table after rolling features are
    computed (they still contribute correct rolling-window context for the
    rows just before them). Pass TAIL_HOLDOUT_READINGS when building a
    *training* table so the live-only tail never leaks into training data.
    """
    channels = COMPONENT_CHANNELS[component]
    telemetry = telemetry.copy()
    telemetry["component"] = telemetry["asset_id"].map(_asset_component)
    subset = telemetry[telemetry["component"] == component].copy()
    subset["timestamp"] = pd.to_datetime(subset["timestamp"])
    subset = subset.sort_values(["asset_id", "timestamp"])

    fe = failure_events[failure_events["component"] == component].copy()
    fe["failure_timestamp"] = pd.to_datetime(fe["failure_timestamp"])
    failure_map = fe.groupby("asset_id")["failure_timestamp"].apply(list).to_dict()

    rows = []
    for asset_id, g in subset.groupby("asset_id"):
        g = g.reset_index(drop=True)
        feats = pd.DataFrame(index=g.index)
        for ch in channels:
            feats[f"{ch}_mean"] = g[ch].rolling(ROLL_WINDOW, min_periods=1).mean()
            feats[f"{ch}_max"] = g[ch].rolling(ROLL_WINDOW, min_periods=1).max()
            feats[f"{ch}_slope"] = g[ch].diff().rolling(ROLL_WINDOW, min_periods=1).mean()
            feats[f"{ch}_latest"] = g[ch]

        failure_times = failure_map.get(asset_id, [])
        labels = np.zeros(len(g), dtype=int)
        for ft in failure_times:
            horizon_start = ft - pd.Timedelta(hours=6 * FAILURE_HORIZON_READINGS)
            mask = (g["timestamp"] >= horizon_start) & (g["timestamp"] <= ft)
            labels[mask.values] = 1
        feats["label"] = labels
        feats["asset_id"] = asset_id
        feats["timestamp"] = g["timestamp"].values
        if exclude_tail_readings > 0:
            feats = feats.iloc[: max(len(feats) - exclude_tail_readings, 0)]
        rows.append(feats)

    result = pd.concat(rows, ignore_index=True)
    result = result.fillna(0.0)
    return result


def feature_columns(component: str) -> list[str]:
    channels = COMPONENT_CHANNELS[component]
    cols = []
    for ch in channels:
        cols += [f"{ch}_mean", f"{ch}_max", f"{ch}_slope", f"{ch}_latest"]
    return cols
