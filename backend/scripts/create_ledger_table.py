"""
Create the ledger_entries table (idempotent). Run from backend/:
    SECRET_KEY=x python scripts/create_ledger_table.py
"""
import asyncio
from app.core.database import engine, Base
from app.models.ledger import LedgerEntry  # noqa: F401 — registers the table on Base.metadata


async def main():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all, tables=[LedgerEntry.__table__])
    print("ledger_entries table ready.")


if __name__ == "__main__":
    asyncio.run(main())
