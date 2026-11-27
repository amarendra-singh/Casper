"""Read-only source inventory plus isolated-copy PKTY flow verification."""
import ast
import asyncio
from contextlib import closing
import json
from pathlib import Path
import sqlite3
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))


def inventory():
    endpoints = []
    for path in sorted((ROOT / 'backend/app/routes').glob('*.py')):
        tree = ast.parse(path.read_text(encoding='utf-8-sig'))
        prefixes = {}
        for node in tree.body:
            if isinstance(node, ast.Assign) and isinstance(node.value, ast.Call) and ast.unparse(node.value.func) == 'APIRouter':
                prefixes[ast.unparse(node.targets[0])] = next((ast.literal_eval(k.value) for k in node.value.keywords if k.arg == 'prefix'), '')
        for node in tree.body:
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            for dec in node.decorator_list:
                if not isinstance(dec, ast.Call) or not isinstance(dec.func, ast.Attribute) or dec.func.attr not in ('get', 'post', 'patch', 'put', 'delete'):
                    continue
                calls = sorted({ast.unparse(n.func) for n in ast.walk(node) if isinstance(n, ast.Call)})
                endpoints.append({'method': dec.func.attr.upper(), 'path': '/api/v1' + prefixes.get(ast.unparse(dec.func.value), '') + ast.literal_eval(dec.args[0]),
                    'handler': node.name, 'source': str(path.relative_to(ROOT)).replace('\\', '/'), 'line': node.lineno,
                    'dependencies': [c for c in calls if c.startswith(('require', 'get_active', 'get_company'))], 'calls': calls})
    out = ROOT / 'audit/FEATURE_ENDPOINT_INVENTORY_2026-10-05.json'
    out.write_text(json.dumps(endpoints, indent=2), encoding='utf-8')
    lines = ['# Endpoint trace index', '', 'Generated from route decorators and AST calls. Static inventory, not execution proof. All paths include /api/v1.', '', '| Method | Endpoint | Handler and source |', '|---|---|---|']
    for e in endpoints:
        lines.append(f"| {e['method']} | `{e['path']}` | `{e['handler']}` — {e['source']}:{e['line']} |")
    (ROOT / 'audit/FEATURE_ENDPOINT_INDEX_2026-10-05.md').write_text('\n'.join(lines), encoding='utf-8')
    return len(endpoints)


async def probe(path):
    from sqlalchemy import select
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
    from app.core.database import configure_sqlite_transactions
    import app.models  # noqa: F401
    from app.models.pnl import PnlSkuRow
    from app.models.company import Company
    from app.services.purchase import apply_cost
    from app.services.pnl import _build_pricing_lookup
    from app.services.pnl_statement import rematch_report
    from app.routes.skus import create_pricing
    from app.schemas.sku import PricingCreate
    engine = create_async_engine('sqlite+aiosqlite:///' + path.as_posix())
    configure_sqlite_transactions(engine)
    results = {}
    try:
        async with async_sessionmaker(engine, expire_on_commit=False)() as db:
            original = await db.get(PnlSkuRow, 168)
            assert original.sku_pricing_id is None
            original_snapshots = (await db.execute(select(PnlSkuRow.id, PnlSkuRow.snap_breakeven).where(PnlSkuRow.report_id == 7, PnlSkuRow.sku_pricing_id.isnot(None)))).all()
            lookup = await _build_pricing_lookup(db, 22, 8)
            assert original.platform_sku_name not in lookup
            results['known_sku_absent_from_pricing_lookup'] = True
            response = await apply_cost(db, 8, 134)
            assert response['ok'] is False and 'no pricing row' in response['error']
            results['bill_cost_cannot_initialize_pricing'] = response
            # Synthetic costing on the disposable copy only; not a business cost decision.
            pricing = await create_pricing(PricingCreate(sku_id=162, platform_id=22, price=270), db=db, company=await db.get(Company, 8), _=None)
            await db.refresh(original)
            assert original.sku_pricing_id is None
            results['pricing_create_does_not_rematch_report'] = True
            count = await rematch_report(db, 7, 8)
            assert count == 1
            assert original.sku_pricing_id == pricing.id
            assert original.snap_cogs_per_unit == 270
            assert await rematch_report(db, 7, 8) == 0
            for row_id, snapshot in original_snapshots:
                assert (await db.get(PnlSkuRow, row_id)).snap_breakeven == snapshot
            results['explicit_rematch_recovers_one_row_and_is_idempotent'] = True
            results['already_priced_snapshots_unchanged'] = True
            await db.rollback()
        from sqlalchemy import text
        from app.services.pnl import delete_report
        async with async_sessionmaker(engine, expire_on_commit=False)() as db:
            risk_before = (await db.execute(text('SELECT * FROM sku_risk_scores WHERE company_id=8 ORDER BY id'))).all()
            events_before = await db.scalar(text('SELECT count(*) FROM order_events WHERE report_id=7'))
            assert events_before > 0
            assert await delete_report(db, 7, 8)
            events_after = await db.scalar(text('SELECT count(*) FROM order_events WHERE report_id=7'))
            risk_after = (await db.execute(text('SELECT * FROM sku_risk_scores WHERE company_id=8 ORDER BY id'))).all()
            assert events_after == 0
            assert risk_before == risk_after
            results['report_delete_leaves_risk_aggregates_unchanged'] = {
                'removed_source_events': events_before, 'unchanged_risk_rows': len(risk_after)}
    finally:
        await engine.dispose()
    return results


if __name__ == '__main__':
    count = inventory()
    with tempfile.TemporaryDirectory() as folder:
        path = Path(folder) / 'probe.sqlite'
        with closing(sqlite3.connect('file:' + (ROOT / 'backend/casper.db').as_posix() + '?mode=ro', uri=True)) as src:
            with closing(sqlite3.connect(path)) as dst:
                src.backup(dst)
        results = asyncio.run(probe(path))
    results.update(endpoint_count=count, live_database_writes=False)
    (ROOT / 'audit/FEATURE_FLOW_PROBES_2026-10-05.json').write_text(json.dumps(results, indent=2), encoding='utf-8')
    print(json.dumps(results, indent=2))
