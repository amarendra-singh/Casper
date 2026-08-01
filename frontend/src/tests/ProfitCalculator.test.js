import { calc } from '../pages/ProfitCalculator'

const M = (v, u = 'rs') => ({ v, u })
const OWN = {
  channel: 'own', price: '1499',
  commission: M('5', 'pct'), shipping: M('80'), paymentFee: M('20'), ads: M('60'), rtoShip: M('120'),
  cogs: M('450'), packaging: M('30'), other: M('20'),
  rtoPct: '8', cancelPct: '5', returnPct: '6', returnHaircutPct: '40', gstPct: '3',
}
const MKT = { ...OWN, channel: 'marketplace' }

test('delivered waterfall and best-case profit', () => {
  const o = calc(OWN)
  expect(o.commissionAmt).toBeCloseTo(74.95, 2)
  expect(o.netSettlement).toBeCloseTo(1324.05, 2)
  expect(o.productCost).toBeCloseTo(500, 2)
  expect(o.deliveredProfit).toBeCloseTo(764.05, 2)
})

test('₹ and % entry are equivalent at the current price (bidirectional)', () => {
  const asPct = calc(OWN)                                        // commission = 5% of 1499
  const asRs = calc({ ...OWN, commission: M('74.95', 'rs') })    // = ₹74.95
  expect(asRs.commissionAmt).toBeCloseTo(asPct.commissionAmt, 2)
  expect(asRs.deliveredProfit).toBeCloseTo(asPct.deliveredProfit, 2)
  expect(asRs.blendedProfit).toBeCloseTo(asPct.blendedProfit, 2)
  // break-even legitimately differs: a fixed ₹ fee doesn't scale with price, a % one does.
})

test('own-site failure eats ad spend + both shipping legs + return haircut', () => {
  const o = calc(OWN)
  expect(o.rtoLoss).toBeCloseTo(260, 2)     // 60 + 80 + 120
  expect(o.cancelLoss).toBeCloseTo(260, 2)
  expect(o.haircutAmt).toBeCloseTo(180, 2)  // 450 * 40%
  expect(o.returnLoss).toBeCloseTo(440, 2)
})

test('marketplace absorbs RTO logistics — only ad spend is sunk', () => {
  const o = calc(MKT)
  expect(o.rtoLoss).toBeCloseTo(60, 2)
  expect(o.returnLoss).toBeCloseTo(240, 2)  // 60 + haircut 180
})

test('own-site has more drag and lower blended profit than marketplace', () => {
  const own = calc(OWN), mkt = calc(MKT)
  expect(own.totalDrag).toBeGreaterThan(mkt.totalDrag)
  expect(own.blendedProfit).toBeCloseTo(558.68, 1)
  expect(mkt.blendedProfit).toBeCloseTo(596.68, 1)
})

test('net margin is blended profit over revenue', () => {
  const o = calc(OWN)
  expect(o.netMargin).toBeCloseTo(558.68 / 1499 * 100, 1) // ~37.3%
  expect(o.deliveredShare).toBeCloseTo(0.81, 5)
})

test('failure-adjusted break-even solves blended profit to zero', () => {
  const o = calc(OWN)
  expect(o.breakeven).toBeCloseTo(772.97, 1)
  const z = calc({ ...OWN, price: String(o.breakeven) })
  expect(z.blendedProfit).toBeCloseTo(0, 1)
})

test('break-even is self-consistent when a cost is entered as % of price', () => {
  // shipping entered as % of price — feeding the break-even back must zero out blended profit
  const withPctShip = { ...OWN, shipping: M(String(80 / 1499 * 100), 'pct') }
  const o = calc(withPctShip)
  const z = calc({ ...withPctShip, price: String(o.breakeven) })
  expect(z.blendedProfit).toBeCloseTo(0, 1)
})

test('handles empty inputs without NaN or divide-by-zero', () => {
  const o = calc({ channel: 'own' })
  expect(o.deliveredProfit).toBe(0)
  expect(o.blendedProfit).toBe(0)
  expect(o.breakeven).toBe(0)
  expect(Number.isNaN(o.totalDrag)).toBe(false)
})
