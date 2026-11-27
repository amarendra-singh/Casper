"""Apply the user's confirmed JDS identity; default is a disposable-copy check.

Run from backend with env/Scripts/python.exe ../audit/link_jds_supplier.py [--apply].
"""
import json
from contextlib import closing
import sqlite3
import sys
import tempfile
from datetime import datetime
from pathlib import Path
from alembic import command
from alembic.config import Config

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))
SOURCE = ROOT / 'backend/casper.db'


def copy_db(destination):
    with closing(sqlite3.connect(f'file:{SOURCE.as_posix()}?mode=ro', uri=True)) as src:
        with closing(sqlite3.connect(destination)) as dst:
            src.backup(dst)


def repair(path):
    config = Config(str(ROOT / 'backend/alembic.ini'))
    config.set_main_option('script_location', str(ROOT / 'backend/alembic'))
    config.set_main_option('sqlalchemy.url', 'sqlite:///' + Path(path).as_posix())
    command.upgrade(config, 'head')
    with closing(sqlite3.connect(path)) as db:
        db.execute('PRAGMA foreign_keys=ON')
        db.execute('BEGIN IMMEDIATE')
        assert db.execute('SELECT name,short_code FROM vendors WHERE id=2 AND company_id=8').fetchone() == ('JDS Enterprise', 'JE')
        queries = ['SELECT id,amount,sku_id FROM ledger_entries ORDER BY id',
                   'SELECT id,total,lines_total,supplier_key FROM purchase_bills ORDER BY id',
                   'SELECT * FROM purchase_bill_lines ORDER BY id',
                   'SELECT * FROM sku_pricing ORDER BY id']
        before = [db.execute(q).fetchall() for q in queries]
        existing = db.execute('SELECT vendor_id FROM vendor_name_aliases WHERE company_id=8 AND name=?', ('JDS',)).fetchone()
        assert existing in (None, (2,)), 'Alias belongs to another vendor'
        if existing is None:
            db.execute('INSERT INTO vendor_name_aliases(company_id,vendor_id,name) VALUES(8,2,?)', ('JDS',))
        assert not db.execute("SELECT id FROM purchase_bills WHERE company_id=8 AND supplier_key='party:JDS ENTERPRISE' AND vendor_id IS NOT NULL AND vendor_id<>2").fetchall()
        bills = db.execute("UPDATE purchase_bills SET vendor_id=2 WHERE company_id=8 AND supplier_key='party:JDS ENTERPRISE' AND vendor_id IS NULL").rowcount
        aliases = db.execute("UPDATE vendor_item_aliases SET vendor_id=2 WHERE company_id=8 AND supplier_key='party:JDS ENTERPRISE' AND vendor_id IS NULL").rowcount
        entries = db.execute("""UPDATE ledger_entries SET vendor_id=2 WHERE company_id=8 AND vendor_id IS NULL
            AND id IN (SELECT ledger_entry_id FROM purchase_bills WHERE company_id=8 AND vendor_id=2 AND supplier_key='party:JDS ENTERPRISE')""").rowcount
        assert before == [db.execute(q).fetchall() for q in queries], 'Amounts or SKU mappings changed'
        assert not db.execute('PRAGMA foreign_key_check').fetchall()
        db.commit()
        return {'bills_linked': bills, 'item_aliases_linked': aliases, 'ledger_entries_linked': entries,
                'amounts_and_sku_mappings_unchanged': True}


if __name__ == '__main__':
    if '--apply' in sys.argv:
        backup = ROOT / 'audit/backups' / ('casper-before-jds-identity-' + datetime.now().strftime('%Y%m%d-%H%M%S') + '.sqlite')
        backup.parent.mkdir(exist_ok=True)
        copy_db(backup)
        result = repair(SOURCE)
        result['backup'] = str(backup)
    else:
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'check.sqlite'
            copy_db(path)
            result = repair(path)
    print(json.dumps(result, indent=2))
