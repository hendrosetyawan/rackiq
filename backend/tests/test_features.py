import pandas as pd

from backend.app.ml.features import build_training_table, feature_columns, latest_features


def _toy_telemetry():
    ts = pd.date_range("2026-01-01", periods=20, freq="6h")
    rows = []
    for aid in ["A01-S1-DIMM", "A01-S2-DIMM"]:
        for i, t in enumerate(ts):
            spike = aid == "A01-S1-DIMM" and i >= 14
            rows.append({"asset_id": aid, "timestamp": t, "ecc_correctable_24h": (5 + i) if spike else 0.2,
                         "ecc_uncorrectable_24h": 0.0, "temp_c": 40.0})
    return pd.DataFrame(rows)


def _toy_failures():
    ts = pd.date_range("2026-01-01", periods=20, freq="6h")
    return pd.DataFrame([{"asset_id": "A01-S1-DIMM", "component": "dimm", "failure_timestamp": ts[19].isoformat()}])


def test_training_table_labels_failure_horizon():
    table = build_training_table(_toy_telemetry(), _toy_failures(), "dimm", exclude_tail_readings=0)
    assert set(feature_columns("dimm")).issubset(table.columns)
    failing = table[table.asset_key == "A01-S1-DIMM"]
    assert failing.label.iloc[-1] == 1 and failing.label.iloc[0] == 0
    assert table[table.asset_key == "A01-S2-DIMM"].label.sum() == 0


def test_tail_holdout_drops_recent_rows_per_asset():
    full = build_training_table(_toy_telemetry(), _toy_failures(), "dimm", exclude_tail_readings=0)
    trimmed = build_training_table(_toy_telemetry(), _toy_failures(), "dimm", exclude_tail_readings=5)
    assert len(trimmed) == len(full) - 10  # 5 per asset, 2 assets


def test_latest_features_match_training_computation():
    tel = _toy_telemetry()
    full = build_training_table(tel, _toy_failures(), "dimm", exclude_tail_readings=0)
    last_full = full.groupby("asset_key").tail(1).set_index("asset_key")
    latest = latest_features(tel, "dimm")
    for col in feature_columns("dimm"):
        assert abs(latest.loc["A01-S1-DIMM", col] - last_full.loc["A01-S1-DIMM", col]) < 1e-9
