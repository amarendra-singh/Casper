"""
ShopDeck Customer-Fraud Service
===============================

ShopDeck exports per-CUSTOMER order history (phone, purchased/cancelled/
delivered/RTO counts + revenue) — the customer-level signal Casper's fraud
system has always lacked (return refusers, serial cancellers).

Layers (clean architecture):
  • parse_customer_csv(text)        — tolerant CSV → normalized customer dicts.
  • score_customer(c)               — PURE per-customer fraud score + action.
  • build_customer_fraud(customers) — PURE summary + ranked offenders.
  • ingest_customer_fraud(db, rows) — upsert into actor_risk_profiles so they
                                      surface in the Fraud Action Pipeline.

Scoring (return-on-behaviour):
    rto_rate    = RTO / orders              (refusal / address fraud)
    cancel_rate = Cancelled / orders        (serial canceller)
    score       = clamp(rto_rate·0.7 + cancel_rate·0.3, 0..100)
A volume gate dampens 1-order noise; tiers BLOCK/WATCH mirror action_pipeline.
"""
from __future__ import annotations

import csv
import hashlib
import io
from datetime import datetime

AVG_ORDER_VALUE = 600
MIN_ORDERS_FOR_TIER = 3      # need history before flagging CRITICAL
CRITICAL_SCORE = 70.0
AMBER_SCORE = 40.0


# ── CSV parsing (column names vary: "Phone No" vs "Customer No") ─────────────────

def _find(headers: list[str], *needles: str) -> int:
    for i, h in enumerate(headers):
        hl = h.strip().lower()
        if any(n in hl for n in needles):
            return i
    return -1


def parse_customer_csv(text: str) -> list[dict]:
    """Tolerant parse of a ShopDeck customer export into normalized dicts."""
    reader = csv.reader(io.StringIO(text))
    rows = [r for r in reader if any(c.strip() for c in r)]
    if not rows:
        return []
    hdr = rows[0]
    ci = {
        "name":      _find(hdr, "name"),
        "phone":     _find(hdr, "phone", "customer no", "customer number", "mobile"),
        "purchased": _find(hdr, "purchased order count"),
        "cancelled": _find(hdr, "cancelled order count"),
        "delivered": _find(hdr, "delivered order count"),
        "rto":       _find(hdr, "rto order count"),
        "revenue":   _find(hdr, "purchased order revenue", "delivered order revenue"),
    }

    def num(row, key):
        i = ci[key]
        if i < 0 or i >= len(row):
            return 0
        try:
            return int(float(str(row[i]).replace(",", "").strip() or 0))
        except ValueError:
            return 0

    out = []
    for r in rows[1:]:
        phone = str(r[ci["phone"]]).strip() if 0 <= ci["phone"] < len(r) else ""
        name = str(r[ci["name"]]).strip() if 0 <= ci["name"] < len(r) else ""
        if not phone and not name:
            continue
        out.append({
            "name": name,
            "phone": phone,
            "purchased": num(r, "purchased"),
            "cancelled": num(r, "cancelled"),
            "delivered": num(r, "delivered"),
            "rto": num(r, "rto"),
            "revenue": num(r, "revenue"),
        })
    return out


# ── Scoring (pure) ──────────────────────────────────────────────────────────────

def score_customer(c: dict) -> dict:
    purchased = int(c.get("purchased") or 0)
    rto = int(c.get("rto") or 0)
    cancelled = int(c.get("cancelled") or 0)
    delivered = int(c.get("delivered") or 0)
    base = max(purchased, rto + cancelled + delivered, 1)

    rto_rate = round(rto / base * 100, 1)
    cancel_rate = round(cancelled / base * 100, 1)
    raw = rto_rate * 0.7 + cancel_rate * 0.3
    # Dampen single-order noise — one RTO on one order isn't a pattern.
    score = round(min(raw, 100.0), 1) if base >= 2 else round(raw * 0.5, 1)

    if base >= MIN_ORDERS_FOR_TIER and score >= CRITICAL_SCORE:
        tier, action = "CRITICAL", "BLOCK"
    elif score >= AMBER_SCORE:
        tier, action = "AMBER", "WATCH"
    else:
        tier, action = "GREEN", "OK"

    return {
        "name": c.get("name"),
        "phone": c.get("phone"),
        "orders": base,
        "rto": rto,
        "cancelled": cancelled,
        "delivered": delivered,
        "rto_rate": rto_rate,
        "cancel_rate": cancel_rate,
        "score": score,
        "tier": tier,
        "action": action,
        "est_loss": rto * AVG_ORDER_VALUE,
    }


def build_customer_fraud(customers: list[dict]) -> dict:
    scored = [score_customer(c) for c in customers]
    crit = [s for s in scored if s["tier"] == "CRITICAL"]
    amber = [s for s in scored if s["tier"] == "AMBER"]
    offenders = sorted(
        [s for s in scored if s["action"] != "OK"],
        key=lambda x: (x["score"], x["est_loss"]), reverse=True,
    )
    return {
        "summary": {
            "total_customers": len(scored),
            "critical": len(crit),
            "amber": len(amber),
            "block": len(crit),
            "est_loss": sum(s["est_loss"] for s in crit + amber),
        },
        "offenders": offenders[:25],
    }


# ── Persistence: surface customers in the Fraud Action Pipeline ─────────────────

def _actor_key(phone: str, name: str, company_id: int) -> str:
    # Namespace by company_id: actor_key is globally unique, so two companies
    # with the same customer phone must not collide (tenancy isolation).
    raw = (phone or name or "unknown").strip().lower()
    digest = hashlib.sha1(raw.encode()).hexdigest()[:16]
    return f"shopdeck:{company_id}:{digest}"


async def ingest_customer_fraud(db, customers: list[dict], company_id: int) -> int:
    """Upsert scored customers into actor_risk_profiles for one company (idempotent by key)."""
    from sqlalchemy import select
    from app.models.fraud import ActorRiskProfile

    count = 0
    for c in customers:
        s = score_customer(c)
        if s["action"] == "OK":
            continue
        key = _actor_key(s["phone"], s["name"], company_id)
        existing = await db.scalar(
            select(ActorRiskProfile).where(
                ActorRiskProfile.actor_key == key,
                ActorRiskProfile.company_id == company_id,
            )
        )
        fields = dict(
            total_orders=s["orders"],
            return_count=s["rto"],
            fraud_reason_count=s["rto"] + s["cancelled"],
            actor_fraud_score=s["score"],
            risk_tier=s["tier"],
            dominant_reason="RTO_REFUSAL" if s["rto"] >= s["cancelled"] else "SERIAL_CANCEL",
            fraud_signal_type="FRAUD_SIGNAL" if s["tier"] == "CRITICAL" else "QUALITY",
            computed_at=datetime.utcnow(),
        )
        if existing:
            for k, v in fields.items():
                setattr(existing, k, v)
        else:
            db.add(ActorRiskProfile(actor_key=key, company_id=company_id, **fields))
        count += 1
    await db.commit()
    return count
