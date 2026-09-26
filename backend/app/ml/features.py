"""
Feature engineering for RackIQ's predictive failure-scoring layer (vectorized).

For every component reading, compute 2-day rolling statistics (mean, max,
slope, latest) over that component's telemetry channels. Training rows are
labeled 1 if a real failure event occurs within FAILURE_HORIZON_READINGS
(3 days) of the reading.
"""
from __future__ import annotations

import pandas as pd

FAILURE_HORIZON_READINGS = 12  # 3 days at 4 readings/day
ROLL_WINDOW = 8                # 2-day rolling window

# Must match CURRENT_TAIL_READINGS in data/synthetic/generate_telemetry.py:
# the most recent readings are "live" telemetry and are held out of training.
TAIL_HOLDOUT_READINGS = 16

COMPONENT_CHANNELS = {
    "dimm": ["ecc_correctable_24h", "ecc_uncorrectable_24h", "temp_c"],
    "disk": ["reallocated_sectors", "pending_sectors", "smart_read_error_rate", "io_latency_ms", "temp_c"],
    "psu": ["input_voltage_v", "output_ripple_mv", "fan_rpm", "temp_c", "efficiency_pct"],
    "nic": ["link_flap_count_24h", "crc_errors_24h", "packet_loss_pct", "temp_c"],
    "fan": ["fan_rpm", "vibration_mm_s", "motor_current_a"],
}

# Telemetry channel -> symptom tag used by the knowledge base, so a
# prediction's top SHAP drivers translate directly into a retrieval query.
CHANNEL_SYMPTOM = {
    "dimm": {"ecc_correctable_24h": "ecc_correctable_spike", "ecc_uncorrectable_24h": "ecc_uncorrectable", "temp_c": "dimm_overtemp"},
    "disk": {"reallocated_sectors": "reallocated_sectors", "pending_sectors": "pending_sectors",
             "smart_read_error_rate": "smart_read_error_rate", "io_latency_ms": "latency_spike", "temp_c": "disk_overtemp"},
    "psu": {"input_voltage_v": "input_voltage_drop", "output_ripple_mv": "output_ripple_high", "fan_rpm": "psu_fan_rpm_drop",
            "temp_c": "psu_overtemp", "efficiency_pct": "psu_efficiency_drop"},
    "nic": {"link_flap_count_24h": "link_flap", "crc_errors_24h": "crc_errors", "packet_loss_pct": "packet_loss", "temp_c": "nic_overtemp"},
    "fan": {"fan_rpm": "fan_rpm_drop", "vibration_mm_s": "fan_vibration", "motor_current_a": "fan_current_rise"},
}


def feature_columns(component: str) -> list[str]:
    return [f"{ch}_{s}" for ch in COMPONENT_CHANNELS[component] for s in ("mean", "max", "slope", "latest")]


def channel_of(feature: str) -> str:
    return feature.rsplit("_", 1)[0]


def add_rolling_features(df: pd.DataFrame, component: str) -> pd.DataFrame:
    """df: long telemetry for one component type (asset_id, timestamp, channels...)."""
    df = df.sort_values(["asset_id", "timestamp"]).reset_index(drop=True)
    key = df["asset_id"].astype(str)
    g = df.groupby(key, sort=False)
    for ch in COMPONENT_CHANNELS[component]:
        roll = g[ch].rolling(ROLL_WINDOW, min_periods=1)
        df[f"{ch}_mean"] = roll.mean().reset_index(level=0, drop=True)
        df[f"{ch}_max"] = roll.max().reset_index(level=0, drop=True)
        diff = g[ch].diff()
        df[f"{ch}_slope"] = diff.groupby(key, sort=False).rolling(ROLL_WINDOW, min_periods=1).mean().reset_index(level=0, drop=True)
        df[f"{ch}_latest"] = df[ch]
    cols = feature_columns(component)
    df[cols] = df[cols].fillna(0.0)
    return df


def build_training_table(telemetry: pd.DataFrame, failure_events: pd.DataFrame, component: str,
                         exclude_tail_readings: int = TAIL_HOLDOUT_READINGS) -> pd.DataFrame:
    """Feature table with labels. The most recent `exclude_tail_readings` rows per
    asset are dropped after rolling features are computed, so the live-only
    tail never leaks into training."""
    df = add_rolling_features(telemetry, component)
    fe = failure_events[failure_events["component"] == component][["asset_id", "failure_timestamp"]].copy()
    fe["failure_timestamp"] = pd.to_datetime(fe["failure_timestamp"])
    fe["asset_id"] = fe["asset_id"].astype(str)
    df["asset_key"] = df["asset_id"].astype(str)
    df = df.merge(fe.rename(columns={"asset_id": "asset_key"}), on="asset_key", how="left")
    horizon = pd.Timedelta(hours=6 * FAILURE_HORIZON_READINGS)
    ts = pd.to_datetime(df["timestamp"])
    df["label"] = ((ts >= df["failure_timestamp"] - horizon) & (ts <= df["failure_timestamp"])).astype(int)
    if exclude_tail_readings > 0:
        rank_from_end = df.groupby("asset_key", sort=False).cumcount(ascending=False)
        df = df[rank_from_end >= exclude_tail_readings]
    return df.drop(columns=["failure_timestamp"]).reset_index(drop=True)


def latest_features(telemetry: pd.DataFrame, component: str) -> pd.DataFrame:
    """One row per asset: features at the most recent reading (identical to the
    training-time computation, restricted to the last window+1 readings)."""
    tail = telemetry.sort_values(["asset_id", "timestamp"]).groupby(telemetry["asset_id"].astype(str), sort=False).tail(ROLL_WINDOW + 1)
    df = add_rolling_features(tail, component)
    last = df.groupby(df["asset_id"].astype(str), sort=False).tail(1)
    last = last.assign(asset_id=last["asset_id"].astype(str)).set_index("asset_id")
    return last
