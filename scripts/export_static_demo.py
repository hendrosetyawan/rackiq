"""
Exports a fully precomputed snapshot of the RackIQ API into static JSON files,
for a "static demo mode" build of the frontend deployed to Firebase Hosting
(which only serves static files on the free plan -- no Python backend runs
there). The live/local run (see instructions_to_run.txt) always uses the
real FastAPI backend; this export is ONLY for the hosted, no-backend demo.

Requires the backend API running locally at http://127.0.0.1:8000 (all data
loaders + models load from it, so we just call the real endpoints -- this
guarantees the static snapshot exactly matches live behavior at export time).

Run: python3 scripts/export_static_demo.py   (from the rackiq/ repo root,
with `uvicorn backend.app.main:app --port 8000` already running)
"""
import json
import urllib.request
from pathlib import Path

BASE = "http://127.0.0.1:8000/api"
OUT_DIR = Path(__file__).resolve().parent.parent / "frontend" / "public" / "data"
OUT_DIR.mkdir(parents=True, exist_ok=True)


def get(path):
    with urllib.request.urlopen(f"{BASE}{path}") as r:
        return json.loads(r.read())


def post(path, payload=None):
    data = json.dumps(payload or {}).encode()
    req = urllib.request.Request(f"{BASE}{path}", data=data, headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())


def write(name, obj):
    with open(OUT_DIR / name, "w") as f:
        json.dump(obj, f)
    print(f"  wrote {name} ({len(json.dumps(obj))} bytes)")


CANNED_QUERIES = [
    ("PSU output ripple rising and fan RPM dropping, what should I do?", None),
    ("DIMM correctable ECC errors climbing overnight, is a reseat enough?", None),
    ("NIC link keeps flapping with CRC errors, replace the card or the transceiver?", None),
    ("Disk showing reallocated sectors during a backup window, safe to hot-swap now?", None),
    ("PSU voltage dropping", "psu"),
    ("disk sector reallocation rising", "disk"),
    ("memory errors correctable ECC", "dimm"),
    ("network link flap crc", "nic"),
    ("is it safe to replace hardware during a migration", None),
    ("fan RPM low PSU overheating", "psu"),
]


def main():
    print("Exporting assets...")
    assets = get("/assets")
    write("assets.json", assets)

    print("Exporting risk (all components)...")
    risk = get("/risk")
    write("risk.json", risk)

    print("Exporting alerts...")
    alerts = get("/alerts")
    write("alerts.json", alerts)

    print("Exporting operational context...")
    context = get("/context")
    write("context.json", context)

    print("Exporting graph stats...")
    write("graph_stats.json", get("/graph/stats"))

    print(f"Exporting telemetry for {len(assets)} assets...")
    telemetry = {}
    for a in assets:
        aid = a["asset_id"]
        try:
            telemetry[aid] = get(f"/telemetry/{aid}?limit=24")
        except Exception as e:
            print(f"  WARN telemetry failed for {aid}: {e}")
    write("telemetry.json", telemetry)

    print(f"Exporting recommendations for {len(assets)} assets (this calls the full agent pipeline per asset)...")
    recommendations = {}
    for i, a in enumerate(assets):
        aid = a["asset_id"]
        try:
            recommendations[aid] = post(f"/alerts/{aid}/recommend")
        except Exception as e:
            print(f"  WARN recommend failed for {aid}: {e}")
        if (i + 1) % 50 == 0:
            print(f"  ...{i + 1}/{len(assets)}")
    write("recommendations.json", recommendations)

    print(f"Exporting {len(CANNED_QUERIES)} canned Incident Copilot answers...")
    copilot_examples = []
    for query, component in CANNED_QUERIES:
        result = post("/copilot", {"query": query, "component": component, "top_k": 5})
        copilot_examples.append(result)
    write("copilot_examples.json", copilot_examples)

    print(f"\nStatic demo data exported to {OUT_DIR}")


if __name__ == "__main__":
    main()
