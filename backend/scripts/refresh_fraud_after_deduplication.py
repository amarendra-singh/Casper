"""Refresh derived intelligence for companies with preserved prior order observations."""

import asyncio
import json

from sqlalchemy import select

from app.core.database import AsyncSessionLocal, engine
from app.models.fraud import OrderEvent
from app.models.pnl import PnlReport
from app.services.fraud import (
    compute_sku_risk_scores,
    compute_return_reason_clusters,
    compute_state_risk_profiles,
    compute_actor_risk_profiles,
    generate_fraud_alerts,
)


async def main():
    refreshed = []
    try:
        async with AsyncSessionLocal() as session:
            companies = list(
                await session.scalars(
                    select(OrderEvent.company_id).where(OrderEvent.is_current.is_(False)).distinct()
                )
            )
            for company_id in companies:
                platforms = list(
                    await session.scalars(
                        select(OrderEvent.platform_id)
                        .where(OrderEvent.company_id == company_id, OrderEvent.is_current.is_(True))
                        .distinct()
                    )
                )
                for platform_id in platforms:
                    await compute_sku_risk_scores(session, platform_id, company_id)
                    await session.flush()
                    report_id = await session.scalar(
                        select(PnlReport.id)
                        .where(
                            PnlReport.company_id == company_id,
                            PnlReport.platform_id == platform_id,
                            PnlReport.status.in_(["done", "done_with_warnings"]),
                        )
                        .order_by(PnlReport.id.desc())
                        .limit(1)
                    )
                    if report_id is not None:
                        await generate_fraud_alerts(session, platform_id, report_id, company_id)
                await compute_return_reason_clusters(session, company_id)
                await compute_state_risk_profiles(session, company_id)
                await compute_actor_risk_profiles(session, company_id)
                await session.commit()
                refreshed.append({"company_id": company_id, "platform_ids": platforms})
        print(json.dumps({"refreshed": refreshed}))
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
