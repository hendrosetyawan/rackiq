"""
Exports a precomputed snapshot of every RackIQ API view into static JSON for
the Firebase-hosted demo (Firebase Hosting's free tier serves static files
only, so no Python backend runs there). Local runs always use the live API.

Calls the backend's Fleet object directly (no server needed), so the snapshot
is exactly what the live API returns at export time.

Run from the rackiq/ repo root:  python3 scripts/export_static_demo.py
Output: frontend/public/data/*.json and frontend/public/data/racks/{rack}.json
"""
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from backend.app.fleet import get_fleet  # noqa: E402

OUT = ROOT / "frontend" / "public" / "data"
RACKS = OUT / "racks"
RACKS.mkdir(parents=True, exist_ok=True)

# Must match COPILOT_SUGGESTIONS in frontend/src/components/Copilot.jsx
CANNED = [
    ("Disk latency spiking with rising SMART read errors, replace now or wait?", None),
    ("DIMM correctable ECC errors climbing, is a reseat enough?", None),
    ("NIC link flapping with CRC errors, card or transceiver?", None),
    ("Fan vibration rising while RPM drops", None),
    ("PSU ripple rising and input voltage sagging during a backup window", None),
    ("Inlet temperature rising across several racks in one cooling zone", None),
    ("disk reallocated sectors pending sectors", "disk"),
    ("memory uncorrectable ECC crash", "dimm"),
    ("psu fan rpm drop overheating", "psu"),
    ("nic packet loss after transceiver replaced", "nic"),
    ("fan motor current rising", "fan"),
    ("BMC unresponsive telemetry gaps", None),
    ("failed BMC login attempts security", None),
]


def write(name, obj):
    path = OUT / f"{name}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(obj, separators=(",", ":"), default=str)
    path.write_text(text)
    return len(text)


def main():
    t0 = time.time()
    f = get_fleet()
    print(f"fleet loaded in {time.time() - t0:.1f}s")
    sizes = {
        "overview": write("overview", f.overview()),
        "floor": write("floor", f.floor()),
        "servers": write("servers", f.servers_view()),
        "facility": write("facility", f.facility_view()),
        "thermal_matrix": write("thermal_matrix", f.thermal_matrix()),
        "model_telemetry": write("model_telemetry", f.model_telemetry()),
        "workorders": write("workorders", f.workorders()),
        "forecast": write("forecast", f.forecast()),
        "incidents": write("incidents", f.incidents_view()),
        "events": write("events", f.events_view(7)),
        "inventory": write("inventory", f.inventory_view()),
        "inventory_history": write("inventory_history", f.inventory_history()),
        "consumption": write("consumption", f.consumption()),
        "copilot_examples": write("copilot_examples", [{**f.copilot(q, c), "component": c} for q, c in CANNED]),
    }
    for k, v in sizes.items():
        print(f"  {k:18s} {v / 1024:8.1f} KB")

    total = 0
    for rack_id, grp in f.asset_view.groupby("rack_id"):
        timestamps, servers, assets, recs = None, {}, {}, {}
        for aid in grp.index:
            d = f.asset_detail(aid, n=60)
            ts = d["series"].pop("timestamp")
            ss = d.pop("server_series")
            ss.pop("timestamp")
            timestamps = timestamps or ts
            servers.setdefault(d["server_id"], {}).update(ss)
            d["server_channels"] = list(ss)
            assets[aid] = d
            # action plans only for flagged components; healthy ones need none
            recs[aid] = f.recommend(aid) if d["tier"] != "healthy" else None
        total += write(f"racks/{rack_id}", {"timestamps": timestamps, "servers": servers, "assets": assets, "recs": recs})
    print(f"  racks/*            {total / 1024:8.1f} KB across {f.asset_view.rack_id.nunique()} files")
    print(f"done in {time.time() - t0:.1f}s -> {OUT}")


if __name__ == "__main__":
    main()
