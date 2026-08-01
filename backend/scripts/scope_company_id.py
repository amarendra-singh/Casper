"""
Phase 2 schema step — add company_id to every tenant-scoped table and backfill
existing rows to the default company (id 1). Idempotent: skips columns that
already exist. SQLite ADD COLUMN + UPDATE, safe on the backed-up dev DB.

Run from backend/:  python -m scripts.scope_company_id
"""
from sqlalchemy import create_engine, text
from app.core.config import settings

# Tables backfilled to the default company (all existing rows belong to it).
SCOPED = [
    "categories", "vendors", "misc_items", "platforms", "platform_tiers",
    "skus", "sku_pricing", "sku_platform_config", "pnl_reports", "pnl_sku_rows",
    "order_events", "sku_risk_scores", "return_reason_clusters",
    "state_risk_profiles", "actor_risk_profiles", "fraud_alerts", "global_settings",
]
DEFAULT_COMPANY_ID = 1


def has_column(conn, table: str, col: str) -> bool:
    rows = conn.execute(text(f"PRAGMA table_info({table})")).fetchall()
    return any(r[1] == col for r in rows)


def main() -> None:
    engine = create_engine(settings.DATABASE_URL_SYNC)
    with engine.begin() as conn:
        for t in SCOPED:
            if has_column(conn, t, "company_id"):
                print(f"  {t}: company_id already present")
                continue
            conn.execute(text(f"ALTER TABLE {t} ADD COLUMN company_id INTEGER REFERENCES companies(id)"))
            n = conn.execute(text(f"UPDATE {t} SET company_id = :c WHERE company_id IS NULL"),
                             {"c": DEFAULT_COMPANY_ID}).rowcount
            print(f"  {t}: added company_id, backfilled {n} rows -> company {DEFAULT_COMPANY_ID}")

        # hsn_codes: only CUSTOM rows are company-scoped; standard reference stays global (NULL).
        if not has_column(conn, "hsn_codes", "company_id"):
            conn.execute(text("ALTER TABLE hsn_codes ADD COLUMN company_id INTEGER REFERENCES companies(id)"))
            n = conn.execute(text("UPDATE hsn_codes SET company_id = :c WHERE is_custom = 1"),
                             {"c": DEFAULT_COMPANY_ID}).rowcount
            print(f"  hsn_codes: added company_id, backfilled {n} custom rows (standard stay global)")
        else:
            print("  hsn_codes: company_id already present")
    print("Done.")


if __name__ == "__main__":
    main()
