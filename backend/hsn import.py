"""
Casper — HSN Codes Importer
Run this to seed HSN codes into the database.
Usage: python casper_hsn_import.py
"""

import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

from sqlalchemy import select
from app.core.database import AsyncSessionLocal
from app.models.hsn_code import HsnCode

SEED_FILE = os.path.join(os.path.dirname(__file__), "casper_hsn_seed.json")


async def main():
    print("\n🚀 Casper — HSN Codes Importer")
    print("=" * 40)

    with open(SEED_FILE, "r", encoding="utf-8") as f:
        seed = json.load(f)

    hsn_data = seed.get("hsn_codes", [])
    print(f"   Found {len(hsn_data)} HSN codes to import\n")

    added = 0
    skipped = 0

    async with AsyncSessionLocal() as session:
        async with session.begin():
            for item in hsn_data:
                existing = await session.execute(
                    select(HsnCode).where(HsnCode.code == item["code"])
                )
                if existing.scalar_one_or_none():
                    print(f"   skip (exists): {item['code']} — {item['description'][:50]}")
                    skipped += 1
                    continue

                session.add(HsnCode(
                    code=item["code"],
                    description=item["description"],
                    gst_rate=item["gst_rate"],
                    category=item.get("category"),
                    is_custom=False
                ))
                print(f"   added: {item['code']} — {item['description'][:50]} ({item['gst_rate']}%)")
                added += 1

    print(f"\n✅ Done! Added: {added} · Skipped: {skipped}\n")


if __name__ == "__main__":
    asyncio.run(main())