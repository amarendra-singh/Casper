"""Synthetic browser fixtures; run only against this directory's disposable DB."""
import asyncio
import sys
from pathlib import Path
from datetime import date
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'backend'))
from app.core.config import settings
assert 'browser-checks-20261007' in settings.DATABASE_URL
from app.core.database import engine
from sqlalchemy.ext.asyncio import async_sessionmaker
from sqlalchemy import select, func
from app.core.security import hash_password
from app.models import User, Company, CompanyMembership, Platform, Vendor, Sku, SkuPricing, Invoice, InvoiceLine, PnlReport, PnlSkuRow, PurchaseBill, PurchaseBillLine, MiscItem
from app.models.company import CompanyRole
from app.models.user import UserRole

async def seed():
    async with async_sessionmaker(engine, expire_on_commit=False)() as db:
        assert await db.scalar(select(func.count()).select_from(User)) == 0
        db.add(User(id=1, name='Browser Tester', email='browser@example.com',
            password_hash=hash_password('CasperBrowserTest-2026!'), role=UserRole.admin))
        await db.flush()
        db.add(Company(id=1, name='Browser Test Company', slug='browser-test', owner_id=1))
        await db.flush()
        db.add_all([CompanyMembership(company_id=1,user_id=1,role=CompanyRole.owner),
            Platform(id=1,company_id=1,name='Flipkart',cr_charge=0,cr_percentage=0),
            Vendor(id=1,company_id=1,name='Test Supplier',short_code='TEST'),
            MiscItem(company_id=1,name='Handling',amount=10,is_active=True)])
        await db.flush()
        db.add_all([Sku(id=1,company_id=1,shringar_sku='PRICED-P1',vendor_id=1),
            Sku(id=2,company_id=1,shringar_sku='TRAY-P1',vendor_id=1,vendor_sku='PKTY-26')])
        await db.flush()
        db.add(SkuPricing(id=1,company_id=1,sku_id=1,platform_id=1,price=100,
            package=0,logistics=0,addons=0,misc_total=0,gst=0,profit_percentage=20,
            cr_percentage=0,cr_cost=0,damage_percentage=0,damage_cost=0,
            breakeven=100,net_profit_amt=20,bs_wo_gst=120,bank_settlement=120))
        report=PnlReport(id=1,company_id=1,platform_id=1,period_start=date(2026,9,1),
            period_end=date(2026,9,30),filename='synthetic-report.xlsx',uploaded_by=1,
            gross_sales=600,net_sales=600,net_units=3,bank_settlement=540)
        invoice=Invoice(id=1,company_id=1,number='BROWSER-001',invoice_date=date(2026,9,1),
            customer_name='Test Customer',status='sent',subtotal=100,tax_amount=0,total=100,amount_paid=0)
        invoice.lines=[InvoiceLine(description='Synthetic product',sku_id=1,quantity=1,unit_price=100,amount=100)]
        bill=PurchaseBill(id=1,company_id=1,ref_no='BROWSER-BILL',bill_date=date(2026,9,1),
            vendor_id=1,party_name='Test Supplier',supplier_key='vendor:1',total=270,lines_total=270)
        db.add_all([report,invoice,bill]);await db.flush()
        db.add_all([PnlSkuRow(company_id=1,report_id=1,platform_sku_name='Candy Tray Listing',
            gross_units=3,net_units=3,accounted_net_sales=600,bank_settlement_projected=540),
            PurchaseBillLine(bill_id=1,line_no=1,item_name='PKTY-26 CANDY TRAY',sku_id=2,
                match_source='manual',price_unit=270,pack_multiple=6,quantity=1,amount=270)])
        await db.commit()
    await engine.dispose()
asyncio.run(seed())
