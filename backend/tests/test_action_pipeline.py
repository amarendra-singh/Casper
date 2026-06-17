"""Unit tests for fraud action pipeline pure function."""
import pytest
from app.services.action_pipeline import build_action_pipeline, AVG_ORDER_VALUE


def _actor(key, tier="GREEN", score=10.0, orders=5, returns=1, fraud_reasons=0,
           signal=None, reason="LOGISTICS", velocity=None, state="MH"):
    return dict(actor_key=key, state_name=state, dominant_reason=reason,
                fraud_signal_type=signal, risk_tier=tier, total_orders=orders,
                return_count=returns, fraud_reason_count=fraud_reasons,
                avg_velocity_days=velocity, actor_fraud_score=score)


# ── Empty ───────────────────────────────────────────────────────────────────────

def test_empty():
    out = build_action_pipeline([])
    assert out["summary"]["total_actors"] == 0
    assert out["summary"]["est_recovery"] == 0.0
    assert out["queue"] == []
    assert out["blocklist"] == []


# ── BLOCK action for CRITICAL ────────────────────────────────────────────────────

def test_critical_actor_blocked():
    out = build_action_pipeline([_actor("C1", tier="CRITICAL", score=99.0, returns=10)])
    assert out["summary"]["block"] == 1
    assert out["summary"]["critical"] == 1
    assert out["blocklist"][0]["actor_key"] == "C1"
    assert out["queue"][0]["action"] == "BLOCK"


def test_high_score_blocked_without_critical_tier():
    # score 90 ≥ BLOCK_SCORE(85) but tier AMBER → still BLOCK
    out = build_action_pipeline([_actor("H1", tier="AMBER", score=90.0)])
    assert out["queue"][0]["action"] == "BLOCK"


# ── DISPUTE action ───────────────────────────────────────────────────────────────

def test_fraud_signal_disputed():
    out = build_action_pipeline([_actor("D1", tier="AMBER", score=50.0, signal="FRAUD_SIGNAL", fraud_reasons=3)])
    assert out["queue"][0]["action"] == "DISPUTE"
    assert out["summary"]["dispute"] == 1
    assert out["blocklist"] == []


# ── WATCH action (low risk) ──────────────────────────────────────────────────────

def test_low_risk_watched():
    out = build_action_pipeline([_actor("W1", tier="GREEN", score=10.0, signal=None, fraud_reasons=0)])
    assert out["queue"][0]["action"] == "WATCH"
    assert out["summary"]["watch"] == 1


# ── Recovery estimate (BLOCK + DISPUTE only) ─────────────────────────────────────

def test_recovery_estimate():
    actors = [
        _actor("B", tier="CRITICAL", score=99.0, returns=10),   # block → 10*600
        _actor("D", tier="AMBER", score=40.0, signal="FRAUD_SIGNAL", returns=5),  # dispute → 5*600
        _actor("W", tier="GREEN", score=5.0, returns=3),        # watch → excluded
    ]
    out = build_action_pipeline(actors)
    assert out["summary"]["est_recovery"] == (10 + 5) * AVG_ORDER_VALUE


# ── Template selection ───────────────────────────────────────────────────────────

def test_template_by_reason():
    out = build_action_pipeline([_actor("T1", tier="CRITICAL", score=99.0, reason="MISSHIPMENT")])
    assert "SAFE-T" in out["queue"][0]["template"]


def test_template_default():
    out = build_action_pipeline([_actor("T2", tier="CRITICAL", score=99.0, reason="SOMETHING_ELSE")])
    assert out["queue"][0]["template"].startswith("Return dispute")


# ── Repeat offender flag ─────────────────────────────────────────────────────────

def test_repeat_offender_flagged():
    # 10 orders, 8 returns = 80% ≥ 60% and orders ≥ 3
    out = build_action_pipeline([_actor("R1", tier="AMBER", score=50.0, orders=10, returns=8, signal="FRAUD_SIGNAL")])
    assert out["queue"][0]["repeat_offender"] is True
    assert out["summary"]["repeat_offenders"] == 1


def test_not_repeat_when_few_orders():
    out = build_action_pipeline([_actor("R2", tier="AMBER", score=50.0, orders=2, returns=2, signal="FRAUD_SIGNAL")])
    assert out["queue"][0]["repeat_offender"] is False


# ── Queue prioritised by impact desc ─────────────────────────────────────────────

def test_queue_sorted_by_impact():
    actors = [
        _actor("SMALL", tier="CRITICAL", score=99.0, returns=2),
        _actor("BIG",   tier="CRITICAL", score=99.0, returns=20),
    ]
    out = build_action_pipeline(actors)
    assert out["queue"][0]["actor_key"] == "BIG"
    assert out["queue"][1]["actor_key"] == "SMALL"


# ── Return pct computed ──────────────────────────────────────────────────────────

def test_return_pct():
    out = build_action_pipeline([_actor("P1", orders=8, returns=2)])
    assert out["queue"][0]["return_pct"] == 25.0
