"""Back up local data, rehearse migrations/repair, then apply the verified local rollout."""

import argparse
from contextlib import closing
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
DATABASE = BACKEND / "casper.db"
PYTHON = BACKEND / "env/Scripts/python.exe"


def run(database, *arguments):
    variables = dict(os.environ, DATABASE_URL="sqlite+aiosqlite:///" + database.as_posix(),
                     DATABASE_URL_SYNC="sqlite:///" + database.as_posix(),
                     APP_DEBUG="false", PYTHONIOENCODING="utf-8")
    variables.setdefault("SECRET_KEY", "migration-verification-only-key-at-least-32-bytes")
    result = subprocess.run([str(PYTHON), *arguments], cwd=BACKEND, env=variables,
                            capture_output=True, text=True, encoding="utf-8")
    if result.returncode:
        raise RuntimeError(result.stderr[-2500:] or result.stdout[-2500:])
    return result.stdout


def backup(source, destination):
    with closing(sqlite3.connect(f"file:{source.as_posix()}?mode=ro", uri=True)) as original:
        with closing(sqlite3.connect(destination)) as target:
            original.backup(target)


def financial_snapshot(database, columns=None):
    with closing(sqlite3.connect(f"file:{database.as_posix()}?mode=ro", uri=True)) as connection:
        if columns is None:
            columns = {}
            for table in ("sku_pricing", "pnl_reports", "pnl_sku_rows", "invoices", "invoice_lines",
                          "purchase_bills", "purchase_bill_lines", "ledger_entries"):
                if not connection.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone():
                    continue
                columns[table] = [row[1] for row in connection.execute(f'PRAGMA table_info("{table}")')
                                  if row[1] not in {"updated_at", "platform_id"}]
        snapshots = {}
        for table, names in columns.items():
            selected = ",".join(f'"{name}"' for name in names)
            rows = connection.execute(f'SELECT {selected} FROM "{table}" ORDER BY id').fetchall()
            snapshots[table] = {"rows": len(rows), "sha256": hashlib.sha256(json.dumps(rows).encode()).hexdigest()}
        return columns, snapshots


def verify(database, expected, columns):
    _, actual = financial_snapshot(database, columns)
    if actual != expected:
        raise RuntimeError("Stored financial values changed; rollout verification failed")
    with closing(sqlite3.connect(f"file:{database.as_posix()}?mode=ro", uri=True)) as connection:
        integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
        foreign_keys = connection.execute("PRAGMA foreign_key_check").fetchall()
        mismatches = connection.execute("""SELECT COUNT(*) FROM sku_pricing p JOIN platforms f
            ON p.platform_id=f.id WHERE p.company_id<>f.company_id""").fetchone()[0]
        if integrity != "ok" or foreign_keys or mismatches:
            raise RuntimeError(f"Integrity failed: {integrity}, foreign keys={len(foreign_keys)}, pricing scope={mismatches}")
        return {"revision": connection.execute("SELECT version_num FROM alembic_version").fetchone()[0],
                "integrity": integrity, "foreign_key_violations": len(foreign_keys),
                "foreign_pricing_platform_links": mismatches, "financial_snapshots": actual,
                "order_observations": connection.execute("SELECT COUNT(*) FROM order_events").fetchone()[0],
                "prior_order_observations": connection.execute("SELECT COUNT(*) FROM order_events WHERE is_current=false").fetchone()[0]}


def upgrade_and_repair(database):
    run(database, "-m", "alembic", "upgrade", "head")
    repaired = json.loads(run(database, "-m", "scripts.repair_pricing_platform", "--company-id", "8",
                              "--source-platform-id", "1", "--apply"))
    refreshed = json.loads(run(database, "-m", "scripts.refresh_fraud_after_deduplication"))
    return {"repair": repaired, "derived_intelligence": refreshed}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Apply only after the rehearsal passes")
    args = parser.parse_args()
    folder = BACKEND / "backups" / ("audit-" + datetime.now().strftime("%Y%m%d-%H%M%S"))
    folder.mkdir(parents=True)
    saved = folder / "casper.before.db"
    backup(DATABASE, saved)
    if (BACKEND / "uploads").is_dir():
        shutil.make_archive(str(folder / "original-uploads"), "zip", BACKEND, "uploads")
    rehearsal = folder / "rehearsal.db"
    backup(saved, rehearsal)
    columns, expected = financial_snapshot(saved)
    result = {"backup_directory": str(folder), "applied": False}
    result["rehearsal"] = upgrade_and_repair(rehearsal)
    result["rehearsal"]["checks"] = verify(rehearsal, expected, columns)
    if args.apply:
        # Refuse a stale rehearsal if another writer changed the financial records.
        if financial_snapshot(DATABASE, columns)[1] != expected:
            raise RuntimeError("Database changed during rehearsal; take a new backup and retry")
        result["live"] = upgrade_and_repair(DATABASE)
        result["live"]["checks"] = verify(DATABASE, expected, columns)
        result["applied"] = True
    (ROOT / "audit/local-rollout-check.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
