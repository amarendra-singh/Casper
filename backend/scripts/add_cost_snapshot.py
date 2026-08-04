"""
Add the frozen cost-snapshot columns to pnl_sku_rows.

Idempotent — safe to run repeatedly. The worktree's Alembic chain is behind the
live DB, so schema changes go through scripts like this one.

Existing rows keep NULL snapshots on purpose: NULL means "uploaded before this
feature existed", which makes the P&L engines fall back to live pricing and label
the report's cost basis "estimated". We do NOT backfill today's pricing onto old
rows — that would fabricate history.

    python -m scripts.add_cost_snapshot        (from backend/)
"""
import sqlite3
from pathlib import Path

COLUMNS = [
    "snap_cogs_per_unit",
    "snap_fulfillment_per_unit",
    "snap_return_per_unit",
    "snap_overhead_per_unit",
    "snap_breakeven",
    "snap_gst",
]

DB_PATH = Path(__file__).resolve().parent.parent / "casper.db"


def main() -> None:
    conn = sqlite3.connect(DB_PATH)
    existing = {r[1] for r in conn.execute("PRAGMA table_info(pnl_sku_rows)")}
    added = []
    for col in COLUMNS:
        if col not in existing:
            conn.execute(f"ALTER TABLE pnl_sku_rows ADD COLUMN {col} FLOAT")
            added.append(col)
    conn.commit()

    total = conn.execute("SELECT COUNT(*) FROM pnl_sku_rows").fetchone()[0]
    conn.close()
    print(f"db: {DB_PATH}")
    print(f"added: {added or 'nothing (already present)'}")
    # ASCII only: the Windows console runs cp1252 and dies on box-drawing/arrows.
    print(f"pnl_sku_rows: {total} rows (existing rows keep NULL snapshots -> 'estimated')")


if __name__ == "__main__":
    main()
