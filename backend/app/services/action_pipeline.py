"""Evidence review queue. Scores prioritise investigation, not customer sanctions.

Neither cohort counts nor heuristic scores establish claim eligibility or money
owed. Monetary recovery stays unavailable until a documented claim exists.
"""
from __future__ import annotations
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.fraud import ActorRiskProfile
from app.services.scope import company_ids

QUEUE_LIMIT = 20


def build_action_pipeline(actors: list[dict]) -> dict:
    queue = []
    counts = {"INVESTIGATE": 0, "WATCH": 0}
    for actor in actors:
        score = float(actor.get("actor_fraud_score") or 0)
        orders = int(actor.get("total_orders") or 0)
        returns = int(actor.get("return_count") or 0)
        investigate = (actor.get("risk_tier") in ('CRITICAL', 'RED', 'AMBER')
                       or score >= 85 or actor.get("fraud_signal_type") == 'FRAUD_SIGNAL'
                       or (actor.get("fraud_reason_count") or 0) > 0)
        action = 'INVESTIGATE' if investigate else 'WATCH'
        counts[action] += 1
        queue.append({
            "actor_key": actor.get("actor_key"),
            "company_id": actor.get("company_id"),
            "entity_type": "customer" if str(actor.get("actor_key", "")).startswith("shopdeck:") else "cohort",
            "state": actor.get("state_name"),
            "reason": (actor.get("dominant_reason") or "UNKNOWN").replace('_', ' ').title(),
            "tier": actor.get("risk_tier"), "score": int(score),
            "orders": orders, "returns": returns,
            "return_pct": round(returns / orders * 100, 1) if orders else None,
            "velocity_days": actor.get("avg_velocity_days"),
            "action": action, "est_impact": None, "repeat_offender": False,
            "template": "Review source orders, return evidence and marketplace eligibility before any customer or claim action.",
        })
    queue.sort(key=lambda item: (item['action'] != 'INVESTIGATE', -item['returns'], -item['score']))
    return {
        "summary": {"total_actors": len(actors), "block": 0, "dispute": 0,
                    "investigate": counts['INVESTIGATE'], "watch": counts['WATCH'],
                    "critical": sum(actor.get('risk_tier') == 'CRITICAL' for actor in actors),
                    "repeat_offenders": 0, "est_recovery": None},
        "queue": queue[:QUEUE_LIMIT], "blocklist": [],
    }


async def compute_action_pipeline(db: AsyncSession, company_id: int | list[int]) -> dict:
    """Load actor risk profiles, feed the pure pipeline builder."""
    _cids = company_ids(company_id)   # group mode passes several
    result = await db.execute(select(ActorRiskProfile).where(ActorRiskProfile.company_id.in_(_cids)))
    actors = [
        {
            "actor_key": a.actor_key,
            "company_id": a.company_id,
            "state_name": a.state_name,
            "dominant_reason": a.dominant_reason,
            "fraud_signal_type": a.fraud_signal_type,
            "risk_tier": a.risk_tier,
            "total_orders": a.total_orders,
            "return_count": a.return_count,
            "fraud_reason_count": a.fraud_reason_count,
            "avg_velocity_days": a.avg_velocity_days,
            "actor_fraud_score": a.actor_fraud_score,
        }
        for a in result.scalars().all()
    ]
    return build_action_pipeline(actors)
