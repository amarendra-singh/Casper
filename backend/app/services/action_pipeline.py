"""
Fraud → Action Pipeline Service
===============================

Turns passive actor_risk_profiles into an actionable queue:
  • BLOCK    — CRITICAL actors / score ≥ threshold → blocklist export.
  • DISPUTE  — fraud-signal returns with a recommended claim template.
  • WATCH    — elevated but not yet actionable.

Plus estimated recoverable rupees and repeat-offender flags.

Layers (clean architecture):
  • build_action_pipeline(actors)  — PURE, unit-testable.
  • compute_action_pipeline(db)    — async DB wrapper.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.fraud import ActorRiskProfile
from app.services.scope import company_ids


# Estimated avg order value (₹) for recovery sizing — matches insight-card basis.
AVG_ORDER_VALUE = 600
BLOCK_SCORE = 85.0          # score at/above this → BLOCK regardless of tier
REPEAT_ORDER_MIN = 3        # ≥ this many orders + high return → repeat offender
REPEAT_RETURN_PCT = 60.0
QUEUE_LIMIT = 20


# Recommended claim template by dominant return reason.
_TEMPLATES = [
    ("MISSHIP",  "Empty/wrong shipment — file SAFE-T claim with packed-weight proof"),
    ("MISSING",  "Missing-item claim — submit dispatch weight + packing video"),
    ("DAMAGE",   "Damage claim — courier liability + unboxing evidence"),
    ("QUALITY",  "Quality dispute — request returned-unit inspection photos"),
    ("WRONG",    "Wrong-product claim — attach SKU/barcode dispatch proof"),
]
_TEMPLATE_DEFAULT = "Return dispute — attach order invoice + courier proof"


def _template(reason: str | None) -> str:
    r = (reason or "").upper()
    for key, tmpl in _TEMPLATES:
        if key in r:
            return tmpl
    return _TEMPLATE_DEFAULT


def _action(tier: str | None, score: float, signal: str | None, fraud_reasons: int) -> str:
    if tier == "CRITICAL" or score >= BLOCK_SCORE:
        return "BLOCK"
    if signal == "FRAUD_SIGNAL" or fraud_reasons > 0 or tier == "AMBER":
        return "DISPUTE"
    return "WATCH"


def build_action_pipeline(actors: list[dict]) -> dict:
    """
    actors: one entry per actor_risk_profile:
        actor_key, state_name, dominant_reason, fraud_signal_type, risk_tier,
        total_orders, return_count, fraud_reason_count, avg_velocity_days,
        actor_fraud_score
    """
    queue: list[dict] = []
    blocklist: list[dict] = []
    est_recovery = 0.0
    counts = {"BLOCK": 0, "DISPUTE": 0, "WATCH": 0}
    critical = 0

    for a in actors:
        score   = float(a.get("actor_fraud_score") or 0)
        orders  = int(a.get("total_orders") or 0)
        returns = int(a.get("return_count") or 0)
        fr      = int(a.get("fraud_reason_count") or 0)
        tier    = a.get("risk_tier")
        signal  = a.get("fraud_signal_type")
        reason  = a.get("dominant_reason")

        action = _action(tier, score, signal, fr)
        counts[action] += 1
        if tier == "CRITICAL":
            critical += 1

        ret_pct = round(returns / orders * 100, 1) if orders else None
        impact  = returns * AVG_ORDER_VALUE
        repeat  = bool(orders >= REPEAT_ORDER_MIN and ret_pct is not None and ret_pct >= REPEAT_RETURN_PCT)

        item = {
            "actor_key": a.get("actor_key"),
            "state": a.get("state_name"),
            "reason": (reason or "UNKNOWN").replace("_", " ").title(),
            "tier": tier,
            "score": int(score),
            "orders": orders,
            "returns": returns,
            "return_pct": ret_pct,
            "velocity_days": round(a["avg_velocity_days"], 1) if a.get("avg_velocity_days") is not None else None,
            "action": action,
            "est_impact": impact,
            "repeat_offender": repeat,
            "template": _template(reason),
        }
        queue.append(item)

        if action in ("BLOCK", "DISPUTE"):
            est_recovery += impact
        if action == "BLOCK":
            blocklist.append({
                "actor_key": item["actor_key"],
                "state": item["state"],
                "reason": item["reason"],
                "score": item["score"],
                "orders": orders,
            })

    # Prioritise actionable items first (BLOCK > DISPUTE > WATCH), then by
    # recoverable impact, then score — so the queue reads as a to-do list.
    _rank = {"BLOCK": 0, "DISPUTE": 1, "WATCH": 2}
    queue.sort(key=lambda x: (_rank[x["action"]], -x["est_impact"], -x["score"]))
    blocklist.sort(key=lambda x: x["score"], reverse=True)

    return {
        "summary": {
            "total_actors": len(actors),
            "block": counts["BLOCK"],
            "dispute": counts["DISPUTE"],
            "watch": counts["WATCH"],
            "critical": critical,
            "repeat_offenders": sum(1 for q in queue if q["repeat_offender"]),
            "est_recovery": round(est_recovery, 2),
        },
        "queue": queue[:QUEUE_LIMIT],
        "blocklist": blocklist,
    }


async def compute_action_pipeline(db: AsyncSession, company_id: int | list[int]) -> dict:
    """Load actor risk profiles, feed the pure pipeline builder."""
    _cids = company_ids(company_id)   # group mode passes several
    result = await db.execute(select(ActorRiskProfile).where(ActorRiskProfile.company_id.in_(_cids)))
    actors = [
        {
            "actor_key": a.actor_key,
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
