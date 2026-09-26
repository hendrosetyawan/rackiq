"""
Synthetic spare-parts warehouse for RackIQ.

Replays the 12-month incident log against a (reorder point, order quantity)
replenishment policy per SKU: every incident that consumed a part is an
issue transaction, every replenishment order is a receipt after the SKU's
lead time. The result is a realistic stock history (sawtooth levels,
occasional stockouts on long-lead parts) and a current on-hand position the
backend combines with live failure predictions to flag upcoming shortages.

A few SKUs are deliberately under-provisioned (reorder point set too low, or
a supplier delay) so the demo has genuine low-stock situations to surface.

Outputs: data/inventory/skus.csv, transactions.csv, stock_daily.csv
Requires generate_knowledge_base.py to have run first.
"""
import numpy as np
import pandas as pd
from pathlib import Path

from catalog import END, SKUS

SEED = 11
SYN = Path(__file__).parent
KB = SYN.parent / "kb"
OUT = SYN.parent / "inventory"
OUT.mkdir(parents=True, exist_ok=True)

UNDER_PROVISIONED = {"FAN-HPE-DL380": 0.45, "PSU-GPU-2800W": 0.5, "NIC-CX7-100G-DP": 0.4, "SSD-NVME-U2-3T84": 0.7}
SUPPLIER_DELAY = {"FAN-HPE-DL380": 14}  # extra days on orders placed in the last 60 days


def generate():
    rng = np.random.default_rng(SEED)
    inc = pd.read_csv(KB / "incidents.csv", parse_dates=["opened_at", "resolved_at"])
    use = inc.dropna(subset=["part_sku"])
    days = pd.date_range(END - pd.Timedelta(days=365), END, freq="D", inclusive="left")
    issues = use.assign(day=use.resolved_at.dt.normalize()).groupby(["part_sku", "day"]).part_qty.sum()

    sku_rows, tx_rows, daily_rows = [], [], []
    po_seq = 5000
    for s in SKUS:
        sku = s["sku"]
        annual = float(use.loc[use.part_sku == sku, "part_qty"].sum())
        rate = max(annual / 365.0, 0.02)
        lead = s["lead_time_days"]
        safety = max(1, int(np.ceil(rate * lead * 0.5)))
        rop = int(np.ceil(rate * lead + safety) * UNDER_PROVISIONED.get(sku, 1.0))
        qty = max(2, int(np.ceil(rate * 45)))
        on_hand = rop + qty // 2 + int(rng.integers(0, 3))
        pipeline = []  # (arrival_day, qty, po)
        stockout_days = 0
        for day in days:
            for arr in [p for p in pipeline if p[0] <= day]:
                on_hand += arr[1]
                tx_rows.append(dict(date=day.date(), sku=sku, type="receipt", qty=arr[1], ref=arr[2]))
                pipeline.remove(arr)
            need = int(issues.get((sku, day), 0))
            if need:
                issued = min(need, on_hand)
                on_hand -= issued
                for ref in use[(use.part_sku == sku) & (use.resolved_at.dt.normalize() == day)].ticket_id:
                    tx_rows.append(dict(date=day.date(), sku=sku, type="issue", qty=1, ref=ref))
                if issued < need:
                    stockout_days += 1
                    tx_rows.append(dict(date=day.date(), sku=sku, type="backorder", qty=need - issued, ref="expedite"))
            if on_hand + sum(p[1] for p in pipeline) <= rop:
                delay = SUPPLIER_DELAY.get(sku, 0) if day > END - pd.Timedelta(days=60) else 0
                lt = lead + delay + int(rng.integers(-1, 3))
                po_seq += 1
                pipeline.append((day + pd.Timedelta(days=lt), qty, f"PO-{po_seq}"))
                tx_rows.append(dict(date=day.date(), sku=sku, type="order", qty=qty, ref=f"PO-{po_seq}"))
            daily_rows.append(dict(date=day.date(), sku=sku, on_hand=on_hand, on_order=sum(p[1] for p in pipeline)))

        inbound = sorted(pipeline)
        sku_rows.append(dict(**s, safety_stock=safety, reorder_point=rop, reorder_qty=qty, on_hand=on_hand,
                             inbound_qty=sum(p[1] for p in inbound),
                             next_arrival=str(inbound[0][0].date()) if inbound else "",
                             issued_12m=int(annual), stockout_days_12m=stockout_days,
                             warehouse="WH-DAL-1"))

    pd.DataFrame(sku_rows).to_csv(OUT / "skus.csv", index=False)
    pd.DataFrame(tx_rows).to_csv(OUT / "transactions.csv", index=False)
    pd.DataFrame(daily_rows).to_csv(OUT / "stock_daily.csv", index=False)
    df = pd.DataFrame(sku_rows)
    print(df[["sku", "issued_12m", "on_hand", "reorder_point", "inbound_qty", "stockout_days_12m"]].to_string(index=False))


if __name__ == "__main__":
    generate()
