from alembic import command
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from tests.test_schema_migrations import _config
from app.models.purchase import PurchaseBill
from datetime import date


def test_legacy_supplier_aliases_only_gain_unambiguous_scope(tmp_path):
    path = str(tmp_path / 'migration.db')
    cfg = _config(path)
    command.upgrade(cfg, 'e5f0audit0005')
    engine = create_engine(f'sqlite:///{path}')
    with Session(engine) as db:
        # The test deliberately starts at an older revision. Use that revision's
        # SQL shape rather than today's ORM model, which has newer catalogue fields.
        db.execute(text("""INSERT INTO users (id,name,email,password_hash,role,is_active,created_at,updated_at)
            VALUES (1,'Synthetic','migration@example.test','x','admin',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)"""))
        db.flush()
        db.execute(text("""INSERT INTO companies (id,name,slug,owner_id,color,is_active,created_at)
            VALUES (1,'Synthetic','synthetic',1,'#000000',1,CURRENT_TIMESTAMP)"""))
        db.flush()
        db.execute(text("""INSERT INTO skus (id,company_id,shringar_sku,is_active,created_at,updated_at)
            VALUES (1,1,'TEST-P1',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)"""))
        db.flush()
        for n, supplier in enumerate(['party:A', 'party:B'], 1):
            bill = PurchaseBill(company_id=1, supplier_key=supplier, ref_no=str(n), bill_date=date(2026, 10, 1))
            db.add(bill)
            db.flush()
            db.execute(text('''INSERT INTO purchase_bill_lines
                (bill_id, line_no, item_name, sku_id, pack_multiple, match_source)
                VALUES (:bill_id, 1, 'AMBIGUOUS', 1, 6, 'alias')'''), {'bill_id': bill.id})
            if n == 1:
                db.execute(text('''INSERT INTO purchase_bill_lines
                    (bill_id, line_no, item_name, sku_id, pack_multiple, match_source)
                    VALUES (:bill_id, 2, 'KNOWN', 1, 1, 'alias')'''), {'bill_id': bill.id})
        for item, pack in [('KNOWN', 1), ('AMBIGUOUS', 6)]:
            db.execute(text('''INSERT INTO vendor_item_aliases
                (company_id,item_name,sku_id,pack_multiple,created_at)
                VALUES (1,:item,1,:pack,CURRENT_TIMESTAMP)'''), {'item': item, 'pack': pack})
        db.commit()
    engine.dispose()
    command.upgrade(cfg, 'head')
    engine = create_engine(f'sqlite:///{path}')
    with engine.connect() as conn:
        result = dict(conn.execute(text('SELECT item_name,supplier_key FROM vendor_item_aliases')).all())
        assert result['KNOWN'] == 'party:A'
        assert result['AMBIGUOUS'].startswith('legacy-unscoped:')
    engine.dispose()
