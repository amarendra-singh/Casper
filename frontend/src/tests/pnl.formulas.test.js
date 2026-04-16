/**
 * Tests for Real P&L formula logic extracted from FlipkartReport.jsx
 * These are pure functions — no React, no DOM needed.
 *
 * N65-WHITE reference (Oct 2025 Flipkart report):
 *   gross=74, net=34, bsp=3320.98, rev_ship=-1356
 *   fixed=-210, gst=-281.88, tcs=-25.16, tds=-5.08
 *   itc=312.12, net_earnings=3633.10, earnings_per_unit=106.86
 *   target_bs=172
 */
import { describe, it, expect } from 'vitest'

// ── Pure formula functions (same logic as FlipkartReport.jsx) ────────────────

const fkBsPerUnit    = (bsp, units) => (bsp != null && units) ? bsp / units : null
const returnRate     = (gross, net)  => gross ? (gross - net) / gross * 100 : null
const revShipPerUnit = (fee, units)  => units ? Math.abs(fee) / units : null
const feesPerUnit    = (comm, coll, fixed, gst, tcs, tds, rewards, units) =>
  units
    ? (Math.abs(comm||0) + Math.abs(coll||0) + Math.abs(fixed||0) +
       Math.abs(gst||0)  + Math.abs(tcs||0)  + Math.abs(tds||0)  - Math.abs(rewards||0)) / units
    : null
const varPerUnit     = (fkBs, target) => (fkBs != null && target != null) ? fkBs - target : null
const marginPct      = (fkBs, target) => (fkBs != null && target) ? (fkBs - target) / target * 100 : null
const expectedTotal  = (target, units) => (target != null && units != null) ? target * units : null
const netVariance    = (fkTotal, exp)  => (fkTotal != null && exp != null) ? fkTotal - exp : null

// ── fmt helper (same as Flipkart.jsx) ────────────────────────────────────────

const fmt = (v, d = 0) => {
  if (v == null) return '—'
  const n = Number(v)
  const abs = Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d })
  return (n < 0 ? '-' : '') + '₹' + abs
}

const fmtPct = v => v == null ? '—' : Number(v).toFixed(1) + '%'


// ── N65-WHITE reference data ──────────────────────────────────────────────────

const N65 = {
  gross_units: 74, net_units: 34,
  bank_settlement_projected: 3320.98,
  reverse_shipping_fee: -1356,
  commission_fee: 0, collection_fee: 0, fixed_fee: -210,
  taxes_gst: -281.88, taxes_tcs: -25.16, taxes_tds: -5.08,
  rewards_benefits: 0,
  input_tax_credits: 312.12,
  net_earnings: 3633.10,
  earnings_per_unit: 106.86,
  casper_expected_bs: 172,
}


// ── FK BS per unit ────────────────────────────────────────────────────────────

describe('fkBsPerUnit', () => {
  it('N65: 3320.98 / 34 = 97.67', () => {
    expect(fkBsPerUnit(N65.bank_settlement_projected, N65.net_units)).toBeCloseTo(97.67, 1)
  })
  it('returns null for 0 units', () => {
    expect(fkBsPerUnit(3320.98, 0)).toBeNull()
  })
  it('returns null for null bsp', () => {
    expect(fkBsPerUnit(null, 34)).toBeNull()
  })
  it('is different from earnings_per_unit (ITC not included in bsp)', () => {
    const our = fkBsPerUnit(N65.bank_settlement_projected, N65.net_units)
    // earnings_per_unit = 106.86, our = 97.67
    // bsp/unit < earnings_per_unit because bsp excludes ITC in its per-unit interpretation
    expect(our).not.toBeCloseTo(N65.earnings_per_unit, 0)
  })
})


// ── Return Rate ───────────────────────────────────────────────────────────────

describe('returnRate', () => {
  it('N65: (74-34)/74*100 = 54.1%', () => {
    expect(returnRate(N65.gross_units, N65.net_units)).toBeCloseTo(54.05, 1)
  })
  it('0% when all delivered', () => {
    expect(returnRate(10, 10)).toBeCloseTo(0)
  })
  it('100% when all returned', () => {
    expect(returnRate(10, 0)).toBeCloseTo(100)
  })
  it('null for 0 gross units', () => {
    expect(returnRate(0, 0)).toBeNull()
  })
})


// ── Return Drag per unit ──────────────────────────────────────────────────────

describe('revShipPerUnit', () => {
  it('N65: 1356/34 = 39.88', () => {
    expect(revShipPerUnit(N65.reverse_shipping_fee, N65.net_units)).toBeCloseTo(39.88, 1)
  })
  it('always positive regardless of sign', () => {
    expect(revShipPerUnit(-500, 10)).toBeCloseTo(50)
    expect(revShipPerUnit(500, 10)).toBeCloseTo(50)
  })
  it('null for 0 units', () => {
    expect(revShipPerUnit(-500, 0)).toBeNull()
  })
})


// ── FK Fees per unit ──────────────────────────────────────────────────────────

describe('feesPerUnit', () => {
  it('N65: (0+0+210+281.88+25.16+5.08-0)/34 = 15.36', () => {
    const result = feesPerUnit(
      N65.commission_fee, N65.collection_fee, N65.fixed_fee,
      N65.taxes_gst, N65.taxes_tcs, N65.taxes_tds,
      N65.rewards_benefits, N65.net_units
    )
    expect(result).toBeCloseTo(15.36, 1)
  })

  it('fixed_fee included — without it result is lower', () => {
    const withFixed = feesPerUnit(0, 0, -210, -281.88, -25.16, -5.08, 0, 34)
    const withoutFixed = feesPerUnit(0, 0, 0, -281.88, -25.16, -5.08, 0, 34)
    expect(withFixed).toBeGreaterThan(withoutFixed)
    expect(withFixed - withoutFixed).toBeCloseTo(210 / 34, 1)
  })

  it('rewards reduce fees', () => {
    const result = feesPerUnit(100, 0, 0, 0, 0, 0, 50, 10)
    expect(result).toBeCloseTo(5.0)
  })

  it('null for 0 units', () => {
    expect(feesPerUnit(100, 0, 0, 0, 0, 0, 0, 0)).toBeNull()
  })
})


// ── Variance per unit ─────────────────────────────────────────────────────────

describe('varPerUnit', () => {
  it('N65: 97.67 - 172 = -74.33 (below target)', () => {
    const fk = fkBsPerUnit(N65.bank_settlement_projected, N65.net_units)
    expect(varPerUnit(fk, N65.casper_expected_bs)).toBeCloseTo(-74.33, 0)
  })
  it('positive when above target', () => {
    expect(varPerUnit(200, 172)).toBeCloseTo(28)
  })
  it('zero at target', () => {
    expect(varPerUnit(172, 172)).toBeCloseTo(0)
  })
  it('null when fkBs is null', () => {
    expect(varPerUnit(null, 172)).toBeNull()
  })
})


// ── Margin % ─────────────────────────────────────────────────────────────────

describe('marginPct', () => {
  it('N65: (97.67-172)/172*100 ≈ -43.2%', () => {
    const fk = fkBsPerUnit(N65.bank_settlement_projected, N65.net_units)
    expect(marginPct(fk, N65.casper_expected_bs)).toBeCloseTo(-43.2, 0)
  })
  it('positive above target', () => {
    expect(marginPct(200, 172)).toBeCloseTo(16.28, 1)
  })
  it('zero at target', () => {
    expect(marginPct(172, 172)).toBeCloseTo(0)
  })
  it('null when target is 0', () => {
    expect(marginPct(172, 0)).toBeNull()
  })
  it('sign matches varPerUnit sign', () => {
    const fk = fkBsPerUnit(N65.bank_settlement_projected, N65.net_units)
    const v = varPerUnit(fk, N65.casper_expected_bs)
    const m = marginPct(fk, N65.casper_expected_bs)
    expect(Math.sign(v)).toBe(Math.sign(m))
  })
})


// ── Totals ────────────────────────────────────────────────────────────────────

describe('totals', () => {
  it('expectedTotal: 172 * 34 = 5848', () => {
    expect(expectedTotal(N65.casper_expected_bs, N65.net_units)).toBeCloseTo(5848)
  })
  it('netVariance: 3320.98 - 5848 = -2527.02', () => {
    const exp = expectedTotal(N65.casper_expected_bs, N65.net_units)
    expect(netVariance(N65.bank_settlement_projected, exp)).toBeCloseTo(-2527, 0)
  })
  it('positive net variance when beating target', () => {
    expect(netVariance(6000, 5848)).toBeCloseTo(152)
  })
  it('null propagation', () => {
    expect(expectedTotal(null, 34)).toBeNull()
    expect(netVariance(null, 5848)).toBeNull()
  })
})


// ── fmt helper ────────────────────────────────────────────────────────────────

describe('fmt', () => {
  it('formats positive numbers with ₹', () => {
    // 89480.52 at d=0 rounds to 89481; strip commas for locale portability
    expect(fmt(89480.52).replace(/,/g, '')).toBe('₹89481')
  })
  it('formats negative numbers with - prefix', () => {
    expect(fmt(-2527.02)).toBe('-₹2,527')
  })
  it('formats with decimals', () => {
    expect(fmt(97.67, 1)).toBe('₹97.7')
  })
  it('returns — for null', () => {
    expect(fmt(null)).toBe('—')
  })
  it('returns — for undefined', () => {
    expect(fmt(undefined)).toBe('—')
  })
  it('formats zero correctly', () => {
    expect(fmt(0)).toBe('₹0')
  })
})

describe('fmtPct', () => {
  it('formats to 1 decimal', () => {
    expect(fmtPct(-43.2)).toBe('-43.2%')
    expect(fmtPct(75.76)).toBe('75.8%')
  })
  it('returns — for null', () => {
    expect(fmtPct(null)).toBe('—')
  })
  it('shows + sign for positives via caller (fmtPct does not add +)', () => {
    // caller adds + prefix: `${val >= 0 ? '+' : ''}${fmtPct(val)}`
    const val = 16.28
    const display = `${val >= 0 ? '+' : ''}${fmtPct(val)}`
    expect(display).toBe('+16.3%')
  })
})


// ── Margin badge class logic ──────────────────────────────────────────────────

describe('margin badge class', () => {
  // From FlipkartReport.jsx:
  // > 0   → 'low'  (green — beating target)
  // > -10 → 'mid'  (amber — slightly missing)
  // ≤ -10 → 'high' (red   — significantly missing)
  const badgeClass = pct => pct > 0 ? 'low' : pct > -10 ? 'mid' : 'high'

  it('positive → green (low)', () => {
    expect(badgeClass(5)).toBe('low')
    expect(badgeClass(0.1)).toBe('low')
  })
  it('-1% to 0% → amber (mid)', () => {
    expect(badgeClass(-5)).toBe('mid')
    expect(badgeClass(-9.9)).toBe('mid')
  })
  it('-10% or worse → red (high)', () => {
    expect(badgeClass(-10)).toBe('high')
    expect(badgeClass(-43.2)).toBe('high')
  })
  it('N65 at -43.2% → red', () => {
    const fk = fkBsPerUnit(N65.bank_settlement_projected, N65.net_units)
    const pct = marginPct(fk, N65.casper_expected_bs)
    expect(badgeClass(pct)).toBe('high')
  })
})
