import { expect, it } from 'vitest'
import { compute, computePlatform } from '../pages/SKUs'
import cases from '../../../audit/unit-engine-cases.json'

it.each(cases)('grid preview agrees with saved engine fixture: $name', c => {
  const row = { price: String(c.price), pkg: String(c.package), log: String(c.logistics),
    addons: String(c.addons), misc: String(c.misc_total), crPct: String(c.cr_percentage),
    crAmt: String(c.cr_cost), dmgPct: String(c.damage_percentage), dmgAmt: String(c.damage_cost),
    profPct: String(c.profit_percentage), profAmt: '', gstType: String(c.gst) }
  const result = compute(row, 0, 20, [{ cr_charge: 100 }])
  expect(result.be).toBe(c.expected.breakeven)
  expect(result.profAmt).toBe(c.expected.net_profit_amt)
  expect(result.bsNoGst).toBe(c.expected.bs_wo_gst)
  expect(result.finalBS).toBe(c.expected.bank_settlement)
})

it('keeps advertising and fixed/percentage tier planning explicit', () => {
  const row = { price: '100', pkg: '0', log: '0', addons: '0', misc: '0',
    crPct: '10', crAmt: '', dmgPct: '0', dmgAmt: '', profPct: '20', profAmt: '',
    gstType: '5', tiers: {}, platOverrides: {} }
  const platform = { id: 1, cr_charge: 100, default_ad_pct: 10, tiers: [{ fee: 5 }] }
  const base = compute(row, 0, 20, [platform])
  expect(base.be).toBe(110)
  expect(base.finalBS).toBe(138.6)
  const plan = computePlatform(row, platform, base, 0)
  expect(plan.platBe).toBe(120)
  expect(plan.adAmt).toBe(10)
  expect(plan.bs).toBe(156.2)
  const percent = computePlatform(row, { ...platform, tiers: [{ fee: 99, fee_pct: 5 }] }, base, 0)
  expect(percent.bs).toBe(158.76)
  const zero = computePlatform({ ...row, platOverrides: { 1: { adPct: '0' } } }, platform, base, 0)
  expect(zero.adAmt).toBe(0)
  expect(zero.platBe).toBe(110)
})

it('uses loaded platform and company defaults when row overrides are blank', () => {
  const row = { price: '100', pkg: '', log: '', addons: '', misc: '', crPct: '', crAmt: '',
    dmgPct: '', dmgAmt: '', profPct: '', profAmt: '', gstType: '0' }
  const result = compute(row, 0, 20, [{ cr_charge: 80, cr_percentage: 5 }], 7)
  expect(result.crAmt).toBe(4)
  expect(result.dmgAmt).toBe(7)
  expect(result.be).toBe(111)
})

it('uses a SKU reverse-shipping override for only its platform, including zero', () => {
  const first = { id: 1, cr_charge: 100, default_ad_pct: 0, tiers: [] }
  const second = { id: 2, cr_charge: 80, default_ad_pct: 0, tiers: [] }
  const row = { price: '100', pkg: '', log: '', addons: '', misc: '', crPct: '10',
    crAmt: '', dmgPct: '0', dmgAmt: '', profPct: '0', profAmt: '', gstType: '0',
    tiers: {}, basePlatformId: 1, platOverrides: { 1: { reverseShippingCharge: '40' } } }
  const base = compute(row, 0, 0, [first, second])
  expect(base.crAmt).toBe(4)
  expect(computePlatform(row, first, base, 0).platBe).toBe(104)
  expect(computePlatform(row, second, base, 0).platBe).toBe(108)

  const zero = { ...row, platOverrides: { 1: { reverseShippingCharge: '0' } } }
  expect(compute(zero, 0, 0, [first, second]).crAmt).toBe(0)
  const inherited = { ...row, platOverrides: { 1: { reverseShippingCharge: '' } } }
  expect(compute(inherited, 0, 0, [first, second]).crAmt).toBe(10)
})
