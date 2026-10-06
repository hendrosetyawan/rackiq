"""
Shared catalog for the synthetic data generators: floor layout, server
models, and the spare-parts SKU list + part-resolution rules. Imported by
generate_telemetry.py, generate_knowledge_base.py and generate_inventory.py
so all three agree on racks, vendors and part numbers.
"""
import pandas as pd

END = pd.Timestamp("2026-09-26 00:00")  # "now" for the whole simulation
ROWS = list("ABCDE")                     # 5 rows x 20 racks = 100 racks
RACKS_PER_ROW = 20
SLOTS = 8                                # 8 x 2U servers per rack
COMPONENTS = ["dimm", "disk", "psu", "nic", "fan"]

# Row -> workload profile. Row E is a high-density AI/GPU row.
ROW_WORKLOAD = {"A": "web", "B": "virtualization", "C": "database", "D": "storage", "E": "ai"}
WORKLOAD_CRITICALITY = {"web": 1, "virtualization": 2, "database": 3, "storage": 2, "ai": 3}

MODELS = {
    ("Dell", "std"): "PowerEdge R760",
    ("HPE", "std"): "ProLiant DL380 Gen11",
    ("Lenovo", "std"): "ThinkSystem SR650 V3",
    ("Dell", "ai"): "PowerEdge XE8640",
    ("HPE", "ai"): "ProLiant DL380a Gen11",
    ("Lenovo", "ai"): "ThinkSystem SR675 V3",
}
POWER_W = {"std": (180, 850), "ai": (750, 3600)}  # idle, max per server
PDU_CAPACITY_KW = {"std": 12.0, "ai": 34.0}

SKUS = [
    # sku, part family, description, brand (synthetic sourcing), vendor/tier fit, unit cost USD, lead time days, bin
    dict(sku="MEM-DDR5-64G-4800", part="dimm", desc="64GB DDR5-4800 RDIMM", brand="Micron", fit="any", unit_cost=420, lead_time_days=10, bin="A-01-1"),
    dict(sku="SSD-NVME-U2-3T84", part="disk_ssd", desc="3.84TB NVMe U.2 SSD", brand="Samsung", fit="any", unit_cost=780, lead_time_days=14, bin="A-02-1"),
    dict(sku="HDD-SAS-12T", part="disk_hdd", desc="12TB 7.2K SAS HDD", brand="Seagate", fit="storage", unit_cost=310, lead_time_days=12, bin="A-02-3"),
    dict(sku="PSU-DEL-1400W", part="psu", desc="Dell 1400W Titanium PSU", brand="Dell", fit="Dell/std", unit_cost=285, lead_time_days=12, bin="B-01-1"),
    dict(sku="PSU-HPE-1600W", part="psu", desc="HPE 1600W Flex Slot PSU", brand="HPE", fit="HPE/std", unit_cost=310, lead_time_days=16, bin="B-01-2"),
    dict(sku="PSU-LNV-1100W", part="psu", desc="Lenovo 1100W Platinum PSU", brand="Lenovo", fit="Lenovo/std", unit_cost=240, lead_time_days=14, bin="B-01-3"),
    dict(sku="PSU-GPU-2800W", part="psu", desc="2800W Titanium PSU (GPU)", brand="Delta Electronics", fit="ai", unit_cost=690, lead_time_days=28, bin="B-02-1"),
    dict(sku="FAN-DEL-R760", part="fan", desc="Dell R760 hot-swap fan", brand="Dell", fit="Dell/std", unit_cost=95, lead_time_days=9, bin="C-01-1"),
    dict(sku="FAN-HPE-DL380", part="fan", desc="HPE DL380 Gen11 fan kit", brand="HPE", fit="HPE/std", unit_cost=110, lead_time_days=21, bin="C-01-2"),
    dict(sku="FAN-LNV-SR650", part="fan", desc="Lenovo SR650 V3 fan", brand="Lenovo", fit="Lenovo/std", unit_cost=88, lead_time_days=11, bin="C-01-3"),
    dict(sku="FAN-GPU-HP80", part="fan", desc="80mm high-perf GPU fan", brand="Nidec", fit="ai", unit_cost=160, lead_time_days=18, bin="C-02-1"),
    dict(sku="NIC-OCP3-25G-DP", part="nic", desc="Dual-port 25GbE OCP 3.0 NIC", brand="Broadcom", fit="std", unit_cost=390, lead_time_days=10, bin="D-01-1"),
    dict(sku="NIC-CX7-100G-DP", part="nic", desc="Dual-port 100GbE NIC (GPU)", brand="NVIDIA Mellanox", fit="ai", unit_cost=1250, lead_time_days=35, bin="D-01-2"),
    dict(sku="SFP28-25G-SR", part="sfp", desc="25G SR SFP28 transceiver", brand="Coherent (Finisar)", fit="std", unit_cost=45, lead_time_days=5, bin="D-02-1"),
    dict(sku="QSFP28-100G-SR4", part="sfp", desc="100G SR4 QSFP28 transceiver", brand="InnoLight", fit="ai", unit_cost=180, lead_time_days=12, bin="D-02-2"),
    dict(sku="CBL-DAC-25G-3M", part="cable", desc="25G DAC cable, 3m", brand="Amphenol", fit="any", unit_cost=35, lead_time_days=5, bin="D-03-1"),
]


def tier_of(workload: str) -> str:
    return "ai" if workload == "ai" else "std"


def resolve_sku(part: str, vendor: str, workload: str):
    """Map a generic part family (as used by fault templates) to the SKU that
    fits a given server. Returns None for part-less fixes."""
    if part is None:
        return None
    tier = tier_of(workload)
    if part == "disk":
        part = "disk_hdd" if workload == "storage" else "disk_ssd"
    for s in SKUS:
        if s["part"] != part:
            continue
        fit = s["fit"]
        if fit == "any" or fit == tier or fit == workload or fit == f"{vendor}/{tier}":
            return s["sku"]
    return None


def component_part(component: str) -> str:
    """Part family replaced when a monitored component itself fails."""
    return {"dimm": "dimm", "disk": "disk", "psu": "psu", "nic": "nic", "fan": "fan"}[component]
