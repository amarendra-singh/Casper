"""Independent audit probes; every write is to a disposable in-memory SQLite DB."""
import asyncio
from datetime import date
import json
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'backend'))
import httpx
from sqlalchemy import event, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
import app.models
from app.core.database import Base, get_db
from app.core.security import create_access_token
from app.main import app
from app.models.user import User, UserRole
from app.models.company import Company, CompanyMembership, CompanyRole, CompanyModule
from app.models.platform import Platform
from app.models.sku import Sku, SkuPricing
from app.models.pnl import PnlReport, PnlSkuRow
from app.models.fraud import OrderEvent
from app.services.fraud import compute_actor_risk_profiles
from app.services.pnl import check_duplicate, get_dashboard_summary
from app.services.profitability import compute_sku_intelligence
from app.services.reconciliation import compute_reconciliation

async def main():
    engine=create_async_engine('sqlite+aiosqlite:///:memory:')
    @event.listens_for(engine.sync_engine,'connect')
    def fk(conn,_): conn.execute('PRAGMA foreign_keys=ON')
    async with engine.begin() as conn: await conn.run_sync(Base.metadata.create_all)
    output={'scope':'Foreign-key-enforced in-memory SQLite only; no live financial writes'}
    async with async_sessionmaker(engine,expire_on_commit=False)() as db:
        db.add_all([User(id=i,name=r,email=f'{r}@audit.invalid',password_hash='unusable',role=UserRole.viewer) for i,r in [(1,'owner'),(2,'admin'),(3,'viewer')]])
        await db.flush()
        db.add(Company(id=1,name='DISPOSABLE AUDIT',slug='disposable-audit',owner_id=1))
        await db.flush()
        db.add_all([CompanyMembership(company_id=1,user_id=i,role=r) for i,r in [(1,CompanyRole.owner),(2,CompanyRole.admin),(3,CompanyRole.viewer)]])
        db.add_all([Platform(id=1,name='CostAnchor',company_id=1,cr_charge=20,cr_percentage=5),Platform(id=2,name='SourceMarket',company_id=1,cr_charge=0,cr_percentage=0)])
        db.add(CompanyModule(company_id=1,module_key='billing',enabled=False))
        db.add(Sku(id=1,company_id=1,shringar_sku='AUDIT-ALIAS'))
        await db.flush()
        db.add(SkuPricing(id=1,company_id=1,sku_id=1,platform_id=1,price=100,cr_percentage=5,cr_cost=1,damage_percentage=0,damage_cost=0,breakeven=101,bank_settlement=121))
        db.add(PnlReport(id=1,company_id=1,platform_id=2,period_start=date(2026,1,1),period_end=date(2026,1,31),filename='synthetic-only',uploaded_by=1,gross_sales=1000,bank_settlement=900,net_earnings=900,gross_units=10,net_units=10))
        await db.flush()
        db.add(PnlSkuRow(company_id=1,report_id=1,platform_sku_name='AUDIT-ALIAS',sku_pricing_id=1,net_units=10,gross_units=10,bank_settlement_projected=900,casper_expected_bs=120,snap_breakeven=100))
        await db.commit()
        output['overlap_guard']={'exact_duplicate_detected':bool(await check_duplicate(db,2,date(2026,1,1),date(2026,1,31),1)), 'overlapping_period_detected':bool(await check_duplicate(db,2,date(2026,1,1),date(2026,2,28),1))}
        db.add(PnlReport(id=2,company_id=1,platform_id=2,period_start=date(2026,1,1),period_end=date(2026,2,28),filename='synthetic-cumulative',uploaded_by=1,gross_sales=1500,bank_settlement=1350,net_earnings=1350,gross_units=15,net_units=15))
        await db.commit()
        output['overlap_summary']=await get_dashboard_summary(db,1)
        output['alias_profitability']=await compute_sku_intelligence(db,1)
        output['alias_reconciliation']=await compute_reconciliation(db,1)
        for signal in ['FRAUD_SIGNAL','QUALITY']:
            db.add(OrderEvent(company_id=1,platform_id=2,sku_platform_name='AUDIT-ALIAS',order_status='RETURNED',return_reason='SAME-REASON',customer_state_name='SAME-STATE',fraud_signal_type=signal))
        await db.commit()
        try:
            await compute_actor_risk_profiles(db,1)
            output['actor_unique_conflict']=False
        except IntegrityError as exc:
            output['actor_unique_conflict']='UNIQUE constraint failed' in str(exc)
            output['actor_unique_error']=str(exc.orig)
            await db.rollback()
        async def override():
            try:
                yield db
                await db.commit()
            except Exception:
                await db.rollback()
                raise
        app.dependency_overrides[get_db]=override
        try:
            matrix={}
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app,raise_app_exceptions=False),base_url='http://isolated-audit') as client:
                for uid,role in [(1,'owner'),(2,'admin'),(3,'viewer')]:
                    headers={'Authorization':'Bearer '+create_access_token({'sub':str(uid)}),'X-Company-Id':'1'}
                    read=await client.get('/api/v1/platforms/',headers=headers)
                    write=await client.patch('/api/v1/platforms/1',headers=headers,json={'default_ad_pct':-5,'cr_percentage':150})
                    grouped=await client.patch('/api/v1/platforms/1',headers={**headers,'X-Company-Id':'all'},json={'default_ad_pct':2})
                    matrix[role]={'read':read.status_code,'invalid_financial_setting_write':write.status_code,'all_company_write':grouped.status_code}
                output['roles']=matrix
                headers={'Authorization':'Bearer '+create_access_token({'sub':'1'}),'X-Company-Id':'1'}
                output['fraud_sku_risk_scope_status']={scope:(await client.get('/api/v1/fraud/sku-risk',headers={**headers,'X-Company-Id':scope})).status_code for scope in ['1','all']}
                pricing=(await db.execute(select(SkuPricing).where(SkuPricing.id==1))).scalar_one()
                output['platform_update_does_not_recalculate']={'updated_return_rate':(await db.get(Platform,1)).cr_percentage,'pricing_breakeven':pricing.breakeven,'pricing_settlement':pricing.bank_settlement}
                invoice=await client.post('/api/v1/billing/',headers=headers,json={'invoice_date':'2026-10-04','customer_name':'DISPOSABLE ONLY','status':'paid','amount_paid':100,'lines':[{'description':'Synthetic','quantity':1,'unit_price':100}]})
                output['disabled_billing_create_status']=invoice.status_code
                if invoice.status_code==201:
                    iid=invoice.json()['id']
                    edit=await client.patch(f'/api/v1/billing/{iid}',headers=headers,json={'customer_name':'Changed after paid'})
                    delete=await client.delete(f'/api/v1/billing/{iid}',headers=headers)
                    output['paid_invoice_edit_delete']={'edit':edit.status_code,'delete':delete.status_code}
        finally: app.dependency_overrides.clear()
    await engine.dispose()
    serialized=json.dumps(output,indent=2,default=str)
    Path(__file__).with_name('isolated-checks.json').write_text(serialized,encoding='utf-8')
    print(serialized)

if __name__=='__main__': asyncio.run(main())
