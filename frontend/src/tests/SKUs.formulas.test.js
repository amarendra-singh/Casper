/**
 * Verifies the SKU pricing math (target world) against logic.md:
 *   breakeven = price + pkg + log + addons + misc + CR-reserve + damage-reserve
 *   CR-reserve   = cr_charge × CR%   (default 20%)
 *   damage-reserve = price × damage% (default 15%)
 *   profit       = breakeven × profit%   (return-on-cost)
 *   target BS (pre-GST) = round(breakeven + profit)   → whole rupee
 *   final BS = target + round(target × gst%)
 */
import { compute, resolveGst } from '../pages/SKUs'

const row = (o = {}) => ({
  price: '', pkg: '', log: '', addons: '', misc: '',
  crPct: '', crAmt: '', dmgPct: '', dmgAmt: '',
  profPct: '', profAmt: '', gstType: '5', ...o,
})
const PLAT = [{ cr_charge: 100 }]

test('breakeven, profit, GST and final BS on a clean worked example', () => {
  // price 200, defaults: CR 20% of ₹100 = ₹20, damage 15% of 200 = ₹30
  const o = compute(row({ price: '200' }), 0, 20, PLAT)
  expect(o.crAmt).toBe(20)
  expect(o.dmgAmt).toBe(30)
  expect(o.be).toBe(250)            // 200 + 20 + 30
  expect(o.beGst).toBe(262.5)       // 250 × 1.05
  expect(o.profAmt).toBe(50)        // 250 × 20%
  expect(o.bsNoGst).toBe(300)       // round(250 + 50)
  expect(o.gstAmt).toBe(15)         // 300 × 5%
  expect(o.finalBS).toBe(315)       // 300 + 15
})

test('margin is return-on-cost: profit ÷ breakeven', () => {
  const o = compute(row({ price: '200' }), 0, 20, PLAT)
  expect(o.profAmt / o.be * 100).toBeCloseTo(o.profPct, 6)
  expect(o.profPct).toBe(20)
})

test('target BS is rounded to a whole rupee, GST computed on that integer', () => {
  // choose inputs that make be+profit fractional
  const o = compute(row({ price: '164', pkg: '3.4' }), 0, 20, PLAT)
  expect(Number.isInteger(o.bsNoGst)).toBe(true)
  expect(o.gstAmt).toBeCloseTo(+(o.bsNoGst * 0.05).toFixed(2), 2)
  expect(o.finalBS).toBeCloseTo(o.bsNoGst + o.gstAmt, 2)
})

test('amount overrides back-derive their percentages', () => {
  // give CR ₹ and damage ₹ directly
  const o = compute(row({ price: '200', crAmt: '25', dmgAmt: '40' }), 0, 20, PLAT)
  expect(o.crAmt).toBe(25)
  expect(o.crPct).toBeCloseTo(25 / 100 * 100, 2)   // 25 of cr_charge 100 = 25%
  expect(o.dmgAmt).toBe(40)
  expect(o.dmgPct).toBeCloseTo(40 / 200 * 100, 2)  // 40 of price 200 = 20%
  expect(o.be).toBe(265)                            // 200 + 25 + 40
})

test('profit amount override back-derives profit %', () => {
  const o = compute(row({ price: '200', profAmt: '75' }), 0, 20, PLAT)
  expect(o.profAmt).toBe(75)
  expect(o.profPct).toBeCloseTo(75 / o.be * 100, 2) // 75 / 250 = 30%
  expect(o.bsNoGst).toBe(325)                        // round(250 + 75)
})

test('resolveGst: numeric passthrough and category slabs', () => {
  expect(resolveGst('5', '200')).toBe(5)
  expect(resolveGst('3', '9999')).toBe(3)
  expect(resolveGst('apparel', '2000')).toBe(5)    // ≤2500
  expect(resolveGst('apparel', '3000')).toBe(18)   // >2500
  expect(resolveGst('footwear', '2500')).toBe(5)   // boundary inclusive
})

test('CR reserve is based on cr_charge, not price', () => {
  // empty price but cr_charge 100 → breakeven is just the CR reserve (₹20)
  const o = compute(row({ price: '' }), 0, 20, PLAT)
  expect(o.be).toBe(20)
  // with no cr_charge, empty price gives a truly zero breakeven, no NaN
  const z = compute(row({ price: '' }), 0, 20, [{ cr_charge: 0 }])
  expect(z.be).toBe(0)
  expect(Number.isNaN(z.finalBS)).toBe(false)
})
