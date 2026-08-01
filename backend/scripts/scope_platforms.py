"""
Idempotent backfill for per-company platforms.

1. Seed the standard platform set (Flipkart/Meesho/Snapdeal/ShopDeck) for every
   active company that is missing them.
2. Re-map any tenant row (sku_pricing, sku_platform_config, pnl_reports,
   order_events, sku_risk_scores) whose platform_id points at ANOTHER company's
   platform → that row's own company platform with the same name.

Safe to run multiple times. Run from backend/:  python scripts/scope_platforms.py
"""
import sqlite3
from datetime import datetime

DB = "casper.db"
STANDARD = [
    # name, cr_charge, cr_percentage, default_ad_pct, default_profit_pct
    ("Flipkart", 50.0, 5.0, 2.0, 25.0),
    ("Meesho", 0.0, 0.0, 2.0, 25.0),
    ("Snapdeal", 0.0, 0.0, 2.0, 25.0),
    ("ShopDeck", 100.0, 20.0, 10.0, 20.0),
]
TENANT_TABLES = ["sku_pricing", "sku_platform_config", "pnl_reports", "order_events", "sku_risk_scores"]


def main():
    db = sqlite3.connect(DB)
    db.execute("PRAGMA foreign_keys=OFF")
    cur = db.cursor()
    now = datetime.utcnow().isoformat()

    # Platform names are per-company now — drop the global UNIQUE index, keep a
    # plain index for name lookups. (Idempotent.)
    idx = cur.execute(
        "SELECT sql FROM sqlite_master WHERE type='index' AND name='ix_platforms_name'"
    ).fetchone()
    if idx and "UNIQUE" in (idx[0] or "").upper():
        cur.execute("DROP INDEX ix_platforms_name")
        cur.execute("CREATE INDEX ix_platforms_name ON platforms (name)")
        print("Dropped UNIQUE constraint on platforms.name -> plain index.")

    active = [r[0] for r in cur.execute("SELECT id FROM companies WHERE is_active=1 ORDER BY id")]
    print("Active companies:", active)

    # 1. Seed missing standard platforms per company
    seeded = 0
    for cid in active:
        have = {r[0] for r in cur.execute("SELECT name FROM platforms WHERE company_id=?", (cid,))}
        for (name, cr, crp, ad, prof) in STANDARD:
            if name not in have:
                cur.execute(
                    "INSERT INTO platforms (name, cr_charge, cr_percentage, default_ad_pct, "
                    "default_profit_pct, target_monthly_units, is_active, created_at, updated_at, company_id) "
                    "VALUES (?,?,?,?,?,?,?,?,?,?)",
                    (name, cr, crp, ad, prof, 700, 1, now, now, cid),
                )
                seeded += 1
    print(f"Seeded {seeded} platform rows.")

    # 2. Build lookups
    all_plats = {r[0]: (r[1], r[2]) for r in cur.execute("SELECT id, company_id, name FROM platforms")}  # id -> (co, name)
    by_co_name = {}
    for pid, (pco, pname) in all_plats.items():
        by_co_name[(pco, pname)] = pid

    # 3. Re-map cross-company platform references
    remapped = 0
    for t in TENANT_TABLES:
        cols = [d[1] for d in cur.execute(f"PRAGMA table_info({t})")]
        if "platform_id" not in cols or "company_id" not in cols:
            continue
        for rid, rco, pid in cur.execute(f"SELECT id, company_id, platform_id FROM {t}").fetchall():
            if pid is None or rco is None:
                continue
            info = all_plats.get(pid)
            if not info:
                continue
            pco, pname = info
            if pco != rco:  # points at another company's platform
                target = by_co_name.get((rco, pname))
                if target:
                    cur.execute(f"UPDATE {t} SET platform_id=? WHERE id=?", (target, rid))
                    remapped += 1
                    print(f"  remap {t}#{rid} (co{rco}): {pid}({pname}/co{pco}) -> {target}")
                else:
                    print(f"  WARN {t}#{rid} co{rco} refs {pname}/co{pco} but co{rco} has no '{pname}' platform")
    print(f"Re-mapped {remapped} cross-company refs.")

    db.commit()
    print("\n=== platforms per company after ===")
    for cid, n in cur.execute("SELECT company_id, COUNT(*) FROM platforms GROUP BY company_id ORDER BY company_id"):
        print(f"  company {cid}: {n}")
    db.close()


if __name__ == "__main__":
    main()
