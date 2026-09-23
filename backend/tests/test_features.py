import pandas as pd

from backend.app.ml.features import build_feature_table, feature_columns


def _toy_telemetry():
    # One DIMM asset, 20 six-hourly readings, healthy then a clear ECC spike.
    rows = []
    ts = pd.date_range("2026-01-01", periods=20, freq="6h")
    for i, t in enumerate(ts):
        ecc = 0.2 if i < 14 else 5 + i  # spike starts at reading 14
        rows.append(
            {
                "asset_id": "AST-0001-DIMM",
                "timestamp": t.isoformat(),
                "ecc_correctable_24h": ecc,
                "ecc_uncorrectable_24h": 0,
                "temp_c": 40,
            }
        )
    return pd.DataFrame(rows)


def _toy_failures():
    return pd.DataFrame(
        [
            {
                "asset_id": "AST-0001-DIMM",
                "component": "dimm",
                "failure_timestamp": pd.date_range("2026-01-01", periods=20, freq="6h")[19].isoformat(),
                "degrade_window_start": pd.date_range("2026-01-01", periods=20, freq="6h")[14].isoformat(),
            }
        ]
    )


def test_build_feature_table_labels_failure_horizon():
    table = build_feature_table(_toy_telemetry(), _toy_failures(), "dimm")
    assert set(feature_columns("dimm")).issubset(table.columns)
    # rows right before the failure timestamp should be labeled 1
    assert table["label"].sum() > 0
    assert table.iloc[-1]["label"] == 1
    # early healthy rows should be labeled 0
    assert table.iloc[0]["label"] == 0


def test_exclude_tail_readings_drops_recent_rows():
    full = build_feature_table(_toy_telemetry(), _toy_failures(), "dimm")
    trimmed = build_feature_table(_toy_telemetry(), _toy_failures(), "dimm", exclude_tail_readings=5)
    assert len(trimmed) == len(full) - 5
