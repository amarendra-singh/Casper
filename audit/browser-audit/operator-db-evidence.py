import json, sqlite3
from pathlib import Path
work=Path(__file__).resolve().parent
db=sqlite3.connect(f'file:{(work/"operator/operator.sqlite").as_posix()}?mode=ro',uri=True)
data={
 'database':'Disposable operator.sqlite only; read-only connection',
 'financial_changes':db.execute('select id,entity_type,action,"before","after" from financial_changes').fetchall(),
 'reports':db.execute('select id,platform_id,bank_settlement,status,processing_warnings,uploaded_at from pnl_reports').fetchall(),
 'companies':db.execute('select id,name,is_active from companies').fetchall(),
 'pricing':db.execute('select id,platform_id,price,gst from sku_pricing').fetchall(),
}
(work/'operator-database-evidence.json').write_text(json.dumps(data,indent=2),encoding='utf-8')
for r in data['financial_changes']:
 if r[1]=='sku_pricing':
  before=json.loads(r[3] or '{}') or {}; after=json.loads(r[4] or '{}') or {}
  print(json.dumps({'change':r[0],'gst_before':before.get('gst'),'gst_after':after.get('gst')}))
