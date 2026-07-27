"""Create invoices + invoice_lines tables (idempotent). Run from backend/:
    SECRET_KEY=x python -m scripts.create_billing_tables
"""
import asyncio
from app.core.database import engine, Base
from app.models.billing import Invoice, InvoiceLine  # noqa: F401


async def main():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all, tables=[Invoice.__table__, InvoiceLine.__table__])
    print("invoices + invoice_lines tables ready.")


if __name__ == "__main__":
    asyncio.run(main())
