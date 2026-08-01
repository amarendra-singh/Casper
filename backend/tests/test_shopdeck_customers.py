"""Unit tests for ShopDeck customer-fraud scoring."""
import pytest
from app.services.shopdeck_customers import (
    parse_customer_csv, score_customer, build_customer_fraud, _actor_key,
)

CSV = (
    '"Name","Phone No","Purchased Order Count","Cancelled Order Count",'
    '"Delivered Order Count","RTO Order Count","Purchased Order Revenue"\n'
    '"Refuser","999","5","0","0","5","4500"\n'
    '"Good","888","4","0","4","0","3600"\n'
    '"Mixed","777","4","2","1","1","3000"\n'
)


# ── CSV parse ───────────────────────────────────────────────────────────────────

def test_parse_csv():
    rows = parse_customer_csv(CSV)
    assert len(rows) == 3
    assert rows[0]["phone"] == "999"
    assert rows[0]["purchased"] == 5
    assert rows[0]["rto"] == 5


def test_parse_csv_alt_phone_header():
    csv = '"Name","Customer No","Purchased Order Count","RTO Order Count"\n"X","123","2","2"\n'
    rows = parse_customer_csv(csv)
    assert rows[0]["phone"] == "123"
    assert rows[0]["rto"] == 2


def test_parse_empty_csv():
    assert parse_customer_csv("") == []
    assert parse_customer_csv('"Name","Phone No"\n') == []   # header only


# ── Scoring ─────────────────────────────────────────────────────────────────────

def test_serial_refuser_critical():
    s = score_customer({"name": "R", "phone": "9", "purchased": 5, "rto": 5})
    assert s["rto_rate"] == 100.0
    assert s["score"] == 70.0     # 100*0.7
    assert s["tier"] == "CRITICAL"
    assert s["action"] == "BLOCK"
    assert s["est_loss"] == 5 * 600


def test_clean_customer_green():
    s = score_customer({"purchased": 4, "delivered": 4, "rto": 0})
    assert s["score"] == 0.0
    assert s["tier"] == "GREEN"
    assert s["action"] == "OK"


def test_single_order_noise_dampened():
    # 1 order, 1 RTO → would be 100% but base<2 → halved, and base<3 → not CRITICAL
    s = score_customer({"purchased": 1, "rto": 1})
    assert s["score"] == 35.0      # 100*0.7*0.5
    assert s["tier"] == "GREEN"    # below AMBER(40) and orders<3


def test_canceller_weighted_less_than_rto():
    rto = score_customer({"purchased": 4, "rto": 4})
    can = score_customer({"purchased": 4, "cancelled": 4})
    assert rto["score"] > can["score"]   # RTO weighted 0.7 vs cancel 0.3


# ── Aggregate ───────────────────────────────────────────────────────────────────

def test_build_summary():
    out = build_customer_fraud(parse_customer_csv(CSV))
    assert out["summary"]["total_customers"] == 3
    assert out["summary"]["critical"] == 1            # Refuser
    assert out["summary"]["block"] == 1
    # offenders exclude the clean "Good" customer
    phones = [o["phone"] for o in out["offenders"]]
    assert "888" not in phones
    assert out["offenders"][0]["phone"] == "999"      # worst first


def test_actor_key_stable_and_namespaced():
    k1 = _actor_key("999", "Refuser", 1)
    k2 = _actor_key("999", "Refuser", 1)
    assert k1 == k2
    assert k1.startswith("shopdeck:1:")
    # Same customer, different company → different key (tenancy isolation).
    assert _actor_key("999", "Refuser", 2) != k1
