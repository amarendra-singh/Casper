"""Read actual endpoints against the upgraded local DB; never send mutations."""
import asyncio
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

import httpx
from sqlalchemy import select
from app.core.database import AsyncSessionLocal, engine
from app.core.security import create_access_token
from app.main import app
from app.models.company import Company
from app.models.user import User


async def main():
    async with AsyncSessionLocal() as session:
        company = await session.get(Company, 8)
        user = await session.get(User, company.owner_id)
        assert user is not None and user.is_active
        token = create_access_token({"sub": str(user.id), "ver": user.token_version})
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://audit.local",
                                    headers={"Authorization": "Bearer " + token, "X-Company-Id": "8"}) as client:
            health = await client.get("/health")
            entries = await client.get("/api/v1/entries/")
            platforms = await client.get("/api/v1/platforms/")
            history = await client.get("/api/v1/change-history/?limit=100")
            for response in (health, entries, platforms, history):
                response.raise_for_status()
            rows = entries.json()
            assert isinstance(rows, list) and len(rows) >= 95
            assert all(row["base_reference_valid"] for row in rows)
            assert all(row["company_id"] == 8 for row in rows)
            owned = platforms.json()
            assert any(row["id"] == 26 and row["company_id"] == 8 for row in owned)
            repaired = [row for row in history.json() if row["action"] == "update" and
                        row["before"].get("platform_id") == 1 and row["after"].get("platform_id") == 26]
            assert len(repaired) == 95
            result = {"read_only": True, "health": health.status_code, "entries": entries.status_code,
                      "entries_count": len(rows), "valid_base_references": True,
                      "platforms": platforms.status_code, "change_history": history.status_code,
                      "recorded_repairs": len(repaired)}
            (ROOT / "audit/local-api-check.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
            print(json.dumps(result))
    await engine.dispose()


asyncio.run(main())
