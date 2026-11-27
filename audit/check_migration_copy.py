"""Read-only backup of local SQLite, then migrate only that disposable copy."""
import json, os, sqlite3, subprocess, tempfile
from contextlib import closing
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
source = ROOT / 'backend/casper.db'
with tempfile.TemporaryDirectory(prefix='casper-migration-review-') as folder:
    copy = Path(folder) / 'copy.db'
    with closing(sqlite3.connect(f'file:{source.as_posix()}?mode=ro', uri=True)) as original:
        with closing(sqlite3.connect(copy)) as target:
            original.backup(target)
    variables = dict(os.environ, DATABASE_URL='sqlite+aiosqlite:///' + copy.as_posix(),
        DATABASE_URL_SYNC='sqlite:///' + copy.as_posix(), SECRET_KEY='synthetic-migration-check-key')
    result = subprocess.run([str(ROOT/'backend/env/Scripts/python.exe'), '-m', 'alembic', 'upgrade', 'head'],
        cwd=ROOT/'backend', env=variables, capture_output=True, text=True)
    summary = {'disposable_copy_only': True, 'exit_code': result.returncode,
        'diagnostic': result.stderr[-2500:] if result.returncode else 'Upgrade to head succeeded'}
    with closing(sqlite3.connect(copy)) as connection:
        summary['total_observations'] = connection.execute('SELECT COUNT(*) FROM order_events').fetchone()[0]
        if not result.returncode:
            summary['preserved_prior_observations'] = connection.execute('SELECT COUNT(*) FROM order_events WHERE is_current = false').fetchone()[0]
    if result.returncode:
        with closing(sqlite3.connect(copy)) as connection:
            duplicate_orders = connection.execute("""SELECT COUNT(*) FROM
                (SELECT company_id, platform_id, external_order_id, sku_platform_name
                 FROM order_events WHERE report_id IS NULL AND external_order_id IS NOT NULL
                 GROUP BY company_id, platform_id, external_order_id, sku_platform_name HAVING COUNT(*) > 1)""").fetchone()[0]
            summary['duplicate_order_groups'] = duplicate_orders
    with closing(sqlite3.connect(copy)) as connection:
        checks = {
            'sku_vendor': 'SELECT COUNT(*) FROM skus s JOIN vendors v ON s.vendor_id=v.id WHERE s.company_id<>v.company_id',
            'sku_category': 'SELECT COUNT(*) FROM skus s JOIN categories c ON s.category_id=c.id WHERE s.company_id<>c.company_id',
            'pricing_sku': 'SELECT COUNT(*) FROM sku_pricing p JOIN skus s ON p.sku_id=s.id WHERE p.company_id<>s.company_id',
            'pricing_platform': 'SELECT COUNT(*) FROM sku_pricing p JOIN platforms f ON p.platform_id=f.id WHERE p.company_id<>f.company_id',
            'invoice_line_sku': 'SELECT COUNT(*) FROM invoice_lines l JOIN invoices i ON l.invoice_id=i.id JOIN skus s ON l.sku_id=s.id WHERE i.company_id<>s.company_id',
            'purchase_line_sku': 'SELECT COUNT(*) FROM purchase_bill_lines l JOIN purchase_bills b ON l.bill_id=b.id JOIN skus s ON l.sku_id=s.id WHERE b.company_id<>s.company_id',
        }
        summary['cross_company_reference_counts'] = {name: connection.execute(query).fetchone()[0] for name, query in checks.items()}
    (ROOT/'audit/migration-copy-check.json').write_text(json.dumps(summary,indent=2),encoding='utf-8')
    print(json.dumps(summary))
