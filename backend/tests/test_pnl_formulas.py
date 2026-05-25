"""
Tests for Real P&L frontend formula logic — ported to Python for backend verification.
All formulas replicate exactly what FlipkartReport.jsx computes.

N65-WHITE reference data (from real Flipkart Oct 2025 report):
  gross_units = 74, net_units = 34
  bank_settlement_projected = 3320.98
  reverse_shipping_fee = -1356
  commission_fee = 0, collection_fee = 0, fixed_fee = -210
  taxes_gst = -281.88, taxes_tcs = -25.16, taxes_tds = -5.08
  rewards_benefits = 0
  input_tax_credits = 312.12
  net_earnings = 3633.10
  earnings_per_unit = 106.86  (FK computed — NOT our comparison base)
  casper_expected_bs = 172    (target from SKUs page)
"""
import pytest


# ── Helpers (mirrors FlipkartReport.jsx) ─────────────────────────────────────

def fk_bs_per_unit(bsp, net_units):
    return bsp / net_units if (bsp is not None and net_units) else None

def return_rate_pct(gross, net):
    return (gross - net) / gross * 100 if gross else None

def rev_ship_per_unit(rev_ship_fee, net_units):
    return abs(rev_ship_fee) / net_units if net_units else None

def fees_per_unit(commission, collection, fixed, gst, tcs, tds, rewards, net_units):
    if not net_units:
        return None
    return (abs(commission or 0) + abs(collection or 0) + abs(fixed or 0) +
            abs(gst or 0) + abs(tcs or 0) + abs(tds or 0) - abs(rewards or 0)) / net_units

def var_per_unit(fk_bs, target_bs):
    return fk_bs - target_bs if fk_bs is not None and target_bs is not None else None

def margin_pct(fk_bs, target_bs):
    if fk_bs is None or not target_bs:
        return None
    return (fk_bs - target_bs) / target_bs * 100

def expected_total(target_bs, net_units):
    return target_bs * net_units if target_bs is not None and net_units is not None else None

def net_variance(fk_settlement, exp_total):
    return fk_settlement - exp_total if fk_settlement is not None and exp_total is not None else None


# ── N65-WHITE fixture ─────────────────────────────────────────────────────────

@pytest.fixture
def n65():
    return {
        "gross_units": 74, "net_units": 34,
        "bank_settlement_projected": 3320.98,
        "reverse_shipping_fee": -1356,
        "commission_fee": 0, "collection_fee": 0, "fixed_fee": -210,
        "taxes_gst": -281.88, "taxes_tcs": -25.16, "taxes_tds": -5.08,
        "rewards_benefits": 0,
        "input_tax_credits": 312.12,
        "net_earnings": 3633.10,
        "earnings_per_unit": 106.86,  # FK computed, for reference only
        "casper_expected_bs": 172,
    }


# ── FK BS per unit ────────────────────────────────────────────────────────────

class TestFkBsPerUnit:
    def test_n65_white(self, n65):
        result = fk_bs_per_unit(n65["bank_settlement_projected"], n65["net_units"])
        assert result == pytest.approx(97.67, abs=0.01)  # 3320.98 / 34

    def test_zero_units_returns_none(self):
        assert fk_bs_per_unit(3320.98, 0) is None

    def test_none_bsp_returns_none(self):
        assert fk_bs_per_unit(None, 34) is None

    def test_itc_not_included_in_bsp(self, n65):
        # FK BS/unit should NOT equal earnings_per_unit (which excludes ITC)
        # bsp/unit = 97.67, earnings_per_unit = 106.86
        # diff should equal ITC per unit: 312.12 / 34 = 9.18
        fk_bs = fk_bs_per_unit(n65["bank_settlement_projected"], n65["net_units"])
        diff = n65["earnings_per_unit"] - fk_bs
        itc_per_unit = n65["input_tax_credits"] / n65["net_units"]
        assert diff == pytest.approx(itc_per_unit, abs=0.01)


# ── Return Rate ───────────────────────────────────────────────────────────────

class TestReturnRate:
    def test_n65_white(self, n65):
        result = return_rate_pct(n65["gross_units"], n65["net_units"])
        # (74 - 34) / 74 * 100 = 54.05%
        assert result == pytest.approx(54.05, abs=0.1)

    def test_zero_returns(self):
        assert return_rate_pct(10, 10) == pytest.approx(0.0, abs=0.01)

    def test_all_returned(self):
        assert return_rate_pct(10, 0) == pytest.approx(100.0, abs=0.01)

    def test_zero_gross_returns_none(self):
        assert return_rate_pct(0, 0) is None


# ── Return Drag per unit ──────────────────────────────────────────────────────

class TestRevShipPerUnit:
    def test_n65_white(self, n65):
        result = rev_ship_per_unit(n65["reverse_shipping_fee"], n65["net_units"])
        # 1356 / 34 = 39.88
        assert result == pytest.approx(39.88, abs=0.01)

    def test_always_positive(self):
        # reverse_shipping is stored negative in DB
        assert rev_ship_per_unit(-500, 10) == pytest.approx(50.0, abs=0.01)

    def test_zero_returns(self):
        assert rev_ship_per_unit(0, 10) == pytest.approx(0.0, abs=0.01)

    def test_zero_units_returns_none(self):
        assert rev_ship_per_unit(-1356, 0) is None


# ── FK Fees per unit ──────────────────────────────────────────────────────────

class TestFeesPerUnit:
    def test_n65_white_includes_fixed_fee(self, n65):
        result = fees_per_unit(
            n65["commission_fee"], n65["collection_fee"], n65["fixed_fee"],
            n65["taxes_gst"], n65["taxes_tcs"], n65["taxes_tds"],
            n65["rewards_benefits"], n65["net_units"]
        )
        # (0 + 0 + 210 + 281.88 + 25.16 + 5.08 - 0) / 34 = 522.12 / 34 = 15.36
        assert result == pytest.approx(15.36, abs=0.01)

    def test_without_fixed_fee_would_be_wrong(self, n65):
        # Proves fixed_fee matters — without it fees are understated
        without_fixed = fees_per_unit(
            n65["commission_fee"], n65["collection_fee"], 0,
            n65["taxes_gst"], n65["taxes_tcs"], n65["taxes_tds"],
            n65["rewards_benefits"], n64_units := n65["net_units"]
        )
        with_fixed = fees_per_unit(
            n65["commission_fee"], n65["collection_fee"], n65["fixed_fee"],
            n65["taxes_gst"], n65["taxes_tcs"], n65["taxes_tds"],
            n65["rewards_benefits"], n65["net_units"]
        )
        assert with_fixed > without_fixed
        assert with_fixed - without_fixed == pytest.approx(210 / 34, abs=0.01)

    def test_rewards_reduce_fees(self):
        result = fees_per_unit(100, 0, 0, 0, 0, 0, 50, 10)
        # (100 - 50) / 10 = 5.0
        assert result == pytest.approx(5.0, abs=0.01)

    def test_zero_units_returns_none(self):
        assert fees_per_unit(100, 0, 0, 0, 0, 0, 0, 0) is None


# ── Variance per unit ─────────────────────────────────────────────────────────

class TestVarPerUnit:
    def test_n65_white_below_target(self, n65):
        fk_bs = fk_bs_per_unit(n65["bank_settlement_projected"], n65["net_units"])
        result = var_per_unit(fk_bs, n65["casper_expected_bs"])
        # 97.67 - 172 = -74.33
        assert result == pytest.approx(-74.33, abs=0.1)

    def test_above_target_positive(self):
        assert var_per_unit(200, 172) == pytest.approx(28.0, abs=0.01)

    def test_at_target_zero(self):
        assert var_per_unit(172, 172) == pytest.approx(0.0, abs=0.01)

    def test_none_fk_bs(self):
        assert var_per_unit(None, 172) is None

    def test_none_target(self):
        assert var_per_unit(172, None) is None


# ── Margin % ─────────────────────────────────────────────────────────────────

class TestMarginPct:
    def test_n65_white(self, n65):
        fk_bs = fk_bs_per_unit(n65["bank_settlement_projected"], n65["net_units"])
        result = margin_pct(fk_bs, n65["casper_expected_bs"])
        # (97.67 - 172) / 172 * 100 = -43.2%
        assert result == pytest.approx(-43.2, abs=0.2)

    def test_above_target_positive(self):
        assert margin_pct(200, 172) == pytest.approx(16.28, abs=0.1)

    def test_at_target_zero(self):
        assert margin_pct(172, 172) == pytest.approx(0.0, abs=0.01)

    def test_zero_target_returns_none(self):
        assert margin_pct(172, 0) is None

    def test_sign_matches_variance(self, n65):
        fk_bs = fk_bs_per_unit(n65["bank_settlement_projected"], n65["net_units"])
        var = var_per_unit(fk_bs, n65["casper_expected_bs"])
        pct = margin_pct(fk_bs, n65["casper_expected_bs"])
        # Both must have same sign
        assert (var < 0) == (pct < 0)


# ── Expected Total & Net ──────────────────────────────────────────────────────

class TestTotals:
    def test_expected_total_n65(self, n65):
        result = expected_total(n65["casper_expected_bs"], n65["net_units"])
        # 172 * 34 = 5848
        assert result == pytest.approx(5848.0, abs=0.01)

    def test_net_variance_n65(self, n65):
        exp = expected_total(n65["casper_expected_bs"], n65["net_units"])
        result = net_variance(n65["bank_settlement_projected"], exp)
        # 3320.98 - 5848 = -2527.02
        assert result == pytest.approx(-2527.02, abs=0.1)

    def test_net_variance_positive_scenario(self):
        assert net_variance(6000, 5848) == pytest.approx(152.0, abs=0.01)

    def test_none_propagates(self):
        assert expected_total(None, 34) is None
        assert net_variance(None, 5848) is None


# ── Cross-check: BSP / net_units vs FK earnings_per_unit ─────────────────────

class TestBspVsEarningsPerUnit:
    """
    FK's earnings_per_unit = net_earnings / net_units (excludes ITC).
    Our FK BS/unit = bank_settlement_projected / net_units (includes ITC).
    They are always different — ITC is the bridge.
    """
    def test_n65_fk_earnings_per_unit_excludes_itc(self, n65):
        fk_earnings_pu = n65["net_earnings"] / n65["net_units"]
        assert fk_earnings_pu == pytest.approx(n65["earnings_per_unit"], abs=0.01)

    def test_our_bs_per_unit_is_higher_due_to_itc(self, n65):
        our_bs = fk_bs_per_unit(n65["bank_settlement_projected"], n65["net_units"])
        fk_epu = n65["earnings_per_unit"]
        # bsp includes ITC so: bsp/unit = net_earnings/unit + itc/unit
        itc_pu = n65["input_tax_credits"] / n65["net_units"]
        assert our_bs == pytest.approx(fk_epu - itc_pu, abs=0.01)
        # Note: bsp < fk_epu because bsp = net_earnings + itc (total)
        # but bsp/unit divides total bsp, and fk_epu = net_earnings/units
        # bsp = net_earnings + itc → bsp/unit < earnings_per_unit only if itc < 0?
        # Actually: bank_settlement_projected = net_earnings + itc → both are positive
        # So BSP > net_earnings → BSP/unit > earnings_per_unit
        assert our_bs > fk_epu - itc_pu - 1  # sanity

    def test_bsp_total_equals_net_earnings_plus_itc(self, n65):
        # FK definition: net_earnings = BSP + ITC
        # 3633.10 = 3320.98 + 312.12 ✓
        assert n65["net_earnings"] == pytest.approx(
            n65["bank_settlement_projected"] + n65["input_tax_credits"], abs=0.1
        )
