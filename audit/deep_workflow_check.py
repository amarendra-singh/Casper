"""Validate the migration and matching against a disposable copy of local data."""
import asyncio
import json
from pathlib import Path
import sqlite3
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))

from alembic import command
from alembic.config import Config
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from app.core.database import configure_sqlite_transactions
from app.services.purchase import bills_view, rematch_bills


def financial_values(conn):
    return {
        'ledger': conn.execute('SELECT id,amount FROM ledger_entries ORDER BY id').fetchall(),
        'pricing': conn.execute('SELECT id,price,breakeven,bank_settlement FROM sku_pricing ORDER BY id').fetchall(),
        'bills': conn.execute('SELECT id,total,lines_total FROM purchase_bills ORDER BY id').fetchall(),
    }


async def run():
    target = Path(tempfile.mkdtemp(prefix='casper-deep-audit-')) / 'validation.sqlite'
    source = sqlite3.connect(f'file:{(ROOT / "backend/casper.db").as_posix()}?mode=ro', uri=True)
    copy = sqlite3.connect(target)
    source.backup(copy)
    source.close()
    before = financial_values(copy)
    copy.close()
    cfg = Config(str(ROOT / 'backend/alembic.ini'))
    cfg.set_main_option('script_location', str(ROOT / 'backend/alembic'))
    cfg.set_main_option('sqlalchemy.url', f'sqlite:///{target.as_posix()}')
    command.upgrade(cfg, 'head')
    engine = create_async_engine(f'sqlite+aiosqlite:///{target.as_posix()}')
    configure_sqlite_transactions(engine)
    async with async_sessionmaker(engine, expire_on_commit=False)() as db:
        matched = await rematch_bills(db, 8)
        await db.commit()
        rows = await bills_view(db, 8, None)
    await engine.dispose()
    with sqlite3.connect(target) as conn:
        unchanged = before == financial_values(conn)
        assert unchanged, 'Matching changed monetary values'
        aliases = conn.execute('SELECT item_name,supplier_key FROM vendor_item_aliases WHERE company_id=8').fetchall()
        unsupported = conn.execute("SELECT count(*) FROM purchase_bills WHERE txn_type != 'Sale'").fetchone()[0]
    lines = [line for bill in rows for line in bill['lines']]
    evidence = {
        'live_database_writes': False, 'migration': 'passed',
        'financial_values_unchanged': unchanged, 'auto_matched_existing': matched,
        'saved_lines': len(lines),
        'confirmed_lines': sum(bool(l['sku_id']) and l['match_source'] in ('manual','alias') for l in lines),
        'candidate_lines': sum(bool(l['candidates']) for l in lines),
        'no_reliable_candidate_lines': sum(not l['sku_id'] and not l['candidates'] for l in lines),
        'legacy_non_purchase_bills': unsupported,
        'migrated_alias_scopes': aliases,
        'unconfirmed': [{'item': l['item_name'], 'reason': l['match_reason'],
                         'candidates': [s['code'] for s in l['candidates']]}
                        for l in lines if not l['sku_id']],
    }
    (ROOT / 'audit/deep-workflow-evidence-2026-10-05.json').write_text(json.dumps(evidence, indent=2), encoding='utf-8')
    print(json.dumps(evidence, indent=2))


if __name__ == '__main__':
    asyncio.run(run())
