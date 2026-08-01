import { useState } from 'react'
import './ProfitCalculator.css'

/**
 * Profit Calculator — channel-aware unit economics.
 *
 * Money fields accept either ₹ or % of selling price (bidirectional toggle).
 * Models real leakage: marketplace absorbs RTO logistics (only ad spend sunk
 * on a failed order); own website eats both shipping legs + the RTO charge;
 * returns add a COGS damage haircut. Two tabs — Calculator (inputs + summary)
 * and Overview (full calculation). Pure client-side math, nothing persisted.
 */

const num = v => (v === '' || v == null ? 0 : parseFloat(v) || 0)
const r2 = n => Math.round(n * 100) / 100
const rupee = n => `₹${(r2(n)).toLocaleString('en-IN')}`
const pct1 = n => `${(Math.round(n * 10) / 10).toLocaleString('en-IN')}%`

// Money fields resolve to ₹ from either unit; rate fields are always %.
const MONEY = ['commission', 'shipping', 'paymentFee', 'ads', 'rtoShip', 'cogs', 'packaging', 'other']

const GROUPS = [
  { title: 'Revenue', fields: [{ key: 'price', label: 'Selling price', hint: 'What the customer pays', money: false, unit: '₹' }] },
  {
    title: 'Platform & fulfilment', fields: [
      { key: 'commission', label: 'Commission / gateway', money: true },
      { key: 'shipping', label: 'Forward shipping', money: true },
      { key: 'paymentFee', label: 'Fixed / collection fee', money: true },
      { key: 'ads', label: 'Ad / acquisition cost', hint: 'Spend to win the order', money: true },
      { key: 'rtoShip', label: 'RTO / reverse shipping', hint: 'Own-site only', money: true, ownOnly: true },
    ],
  },
  {
    title: 'Product cost', fields: [
      { key: 'cogs', label: 'COGS / landed cost', money: true },
      { key: 'packaging', label: 'Packaging', money: true },
      { key: 'other', label: 'Other expenses', money: true },
    ],
  },
  {
    title: 'Failure rates', fields: [
      { key: 'rtoPct', label: 'RTO rate', hint: 'Courier could not deliver', money: false, unit: '%' },
      { key: 'cancelPct', label: 'Cancellation rate', hint: 'Post-dispatch', money: false, unit: '%' },
      { key: 'returnPct', label: 'Return rate', hint: 'Delivered then returned', money: false, unit: '%' },
      { key: 'returnHaircutPct', label: 'Return damage haircut', hint: '% of COGS lost on returns', money: false, unit: '%' },
    ],
  },
  { title: 'Tax', fields: [{ key: 'gstPct', label: 'GST rate', hint: 'Informational', money: false, unit: '%' }] },
]

const M = (v, u = 'rs') => ({ v, u })
const DEFAULTS = {
  channel: 'own', price: '1499',
  commission: M('5', 'pct'), shipping: M('80'), paymentFee: M('20'), ads: M('60'), rtoShip: M('120'),
  cogs: M('450'), packaging: M('30'), other: M('20'),
  rtoPct: '8', cancelPct: '5', returnPct: '6', returnHaircutPct: '40', gstPct: '3',
}

export function calc(v) {
  const own = v.channel === 'own'
  const P = num(v.price)
  // {amt, frac, fix} — frac/fix let break-even stay exact when a field is %-of-price.
  const part = k => {
    const f = v[k] || {}
    const val = num(f.v)
    return f.u === 'pct' ? { amt: P * val / 100, frac: val / 100, fix: 0 } : { amt: val, frac: 0, fix: val }
  }
  const commission = part('commission'), shipping = part('shipping'), pay = part('paymentFee')
  const ads = part('ads'), rtoShip = part('rtoShip')
  const cogs = part('cogs'), pkg = part('packaging'), other = part('other')

  const commissionAmt = commission.amt, fwd = shipping.amt, payAmt = pay.amt
  const adsAmt = ads.amt, rtoShipAmt = rtoShip.amt
  const productCost = cogs.amt + pkg.amt + other.amt

  const netSettlement = P - commissionAmt - fwd - payAmt
  const deliveredProfit = netSettlement - productCost - adsAmt

  const shipLegsAmt = own ? fwd + rtoShipAmt : 0
  const rtoLoss = adsAmt + shipLegsAmt
  const cancelLoss = adsAmt + shipLegsAmt
  const hc = num(v.returnHaircutPct) / 100
  const haircutAmt = cogs.amt * hc
  const returnLoss = adsAmt + shipLegsAmt + haircutAmt

  const rto = num(v.rtoPct) / 100, cancel = num(v.cancelPct) / 100, ret = num(v.returnPct) / 100
  const delivered = Math.max(0, 1 - rto - cancel - ret)
  const rtoDrag = rto * rtoLoss, cancelDrag = cancel * cancelLoss, returnDrag = ret * returnLoss
  const totalDrag = rtoDrag + cancelDrag + returnDrag
  const blendedProfit = delivered * deliveredProfit - totalDrag

  const totalCost = productCost + commissionAmt + fwd + payAmt + adsAmt
  const deliveredMarginCost = totalCost > 0 ? deliveredProfit / totalCost * 100 : 0
  const deliveredMarginRev = P > 0 ? deliveredProfit / P * 100 : 0
  const netMargin = P > 0 ? blendedProfit / P * 100 : 0   // blended net margin on revenue

  // Break-even price (linear in P). Accumulate proportional (frac) and fixed (fix) parts.
  const dFrac = commission.frac + shipping.frac + pay.frac + ads.frac + cogs.frac + pkg.frac + other.frac
  const dFix = commission.fix + shipping.fix + pay.fix + ads.fix + cogs.fix + pkg.fix + other.fix
  const lossFrac = ads.frac + (own ? shipping.frac + rtoShip.frac : 0)
  const lossFix = ads.fix + (own ? shipping.fix + rtoShip.fix : 0)
  const retLossFrac = lossFrac + cogs.frac * hc
  const retLossFix = lossFix + cogs.fix * hc
  const dragFrac = rto * lossFrac + cancel * lossFrac + ret * retLossFrac
  const dragFix = rto * lossFix + cancel * lossFix + ret * retLossFix
  const denom = delivered * (1 - dFrac) - dragFrac
  const breakeven = denom > 0 ? (delivered * dFix + dragFix) / denom : 0

  const gstOnSale = P * num(v.gstPct) / 100

  return {
    commissionAmt, fwd, payAmt, adsAmt, netSettlement, productCost, deliveredProfit,
    rtoLoss, cancelLoss, returnLoss, haircutAmt,
    rtoDrag, cancelDrag, returnDrag, totalDrag, blendedProfit, deliveredShare: delivered,
    deliveredMarginCost, deliveredMarginRev, netMargin, breakeven, gstOnSale, own,
  }
}

export default function ProfitCalculator() {
  const [v, setV] = useState(DEFAULTS)
  const [tab, setTab] = useState('calc')
  const set = (k, val) => setV(p => ({ ...p, [k]: val }))
  const o = calc(v)
  const own = v.channel === 'own'
  const price = num(v.price)
  const blendedPos = o.blendedProfit >= 0
  const deliveredPos = o.deliveredProfit >= 0

  return (
    <div className="pcalc">
      <header className="pcalc-head">
        <div>
          <h1 className="pcalc-title">Profit calculator</h1>
          <p className="pcalc-sub">True unit economics per channel — after RTO, cancellations and returns.</p>
        </div>
        <div className="pcalc-head-right">
          <div className="pcalc-tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'calc'} className={`pcalc-tab${tab === 'calc' ? ' active' : ''}`} onClick={() => setTab('calc')}>Calculator</button>
            <button role="tab" aria-selected={tab === 'overview'} className={`pcalc-tab${tab === 'overview' ? ' active' : ''}`} onClick={() => setTab('overview')}>Overview</button>
          </div>
          <button className="pcalc-reset" onClick={() => setV(DEFAULTS)}>Reset</button>
        </div>
      </header>

      {tab === 'calc' ? (
        <div className="pcalc-grid">
          {/* Inputs — packed into columns so the whole form fits without scrolling */}
          <div className="pcalc-inputs">
            <section className="pcalc-group pcalc-group-channel">
              <h2 className="pcalc-group-title">Channel</h2>
              <div className="pcalc-seg" role="tablist" aria-label="Channel type">
                <button role="tab" aria-selected={!own} className={`pcalc-seg-btn${!own ? ' active' : ''}`} onClick={() => set('channel', 'marketplace')}>Marketplace</button>
                <button role="tab" aria-selected={own} className={`pcalc-seg-btn${own ? ' active' : ''}`} onClick={() => set('channel', 'own')}>Own website</button>
              </div>
              <p className="pcalc-seg-note">
                {own ? 'Self-ship: failed orders eat ad spend + both shipping legs.'
                     : 'Platform-fulfilled: only ad spend is sunk on a failed order.'}
              </p>
            </section>

            {GROUPS.map(g => (
              <section key={g.title} className="pcalc-group">
                <h2 className="pcalc-group-title">{g.title}</h2>
                <div className="pcalc-fields">
                  {g.fields.filter(f => !f.ownOnly || own).map(f =>
                    f.money
                      ? <MoneyField key={f.key} f={f} field={v[f.key]} price={price} onChange={val => set(f.key, val)} />
                      : <RateField key={f.key} f={f} value={v[f.key]} onChange={val => set(f.key, val)} />
                  )}
                </div>
              </section>
            ))}
          </div>

          {/* Compact summary rail */}
          <div className="pcalc-results">
            <div className="pcalc-result-card">
              <div className={`pcalc-hero ${blendedPos ? 'pos' : 'neg'}`}>
                <span className="pcalc-hero-label">Blended profit / order</span>
                <span className="pcalc-hero-val">{rupee(o.blendedProfit)}</span>
                <span className="pcalc-hero-sub">Net margin {pct1(o.netMargin)} · {pct1(o.deliveredShare * 100)} deliver</span>
              </div>
              <div className="pcalc-metrics">
                <Metric label="Net margin" hint="blended, on revenue" val={pct1(o.netMargin)} tone={blendedPos ? 'pos' : 'neg'} />
                <Metric label="Delivered profit" hint="best case" val={rupee(o.deliveredProfit)} tone={deliveredPos ? 'pos' : 'neg'} />
                <Metric label="Break-even price" hint="failure-adjusted" val={rupee(o.breakeven)} tone="neutral" />
                <Metric label="Failure drag" hint="per order" val={`−${rupee(o.totalDrag)}`} tone="neg" />
              </div>
              <p className="pcalc-note">Open the <b>Overview</b> tab for the full step-by-step calculation.</p>
            </div>
          </div>
        </div>
      ) : (
        <Overview v={v} o={o} own={own} />
      )}
    </div>
  )
}

// ── Overview tab: the full calculation ───────────────────────────────────────
function Overview({ v, o, own }) {
  const blendedPos = o.blendedProfit >= 0
  const deliveredPos = o.deliveredProfit >= 0
  return (
    <div className="pcalc-ov">
      <div className="pcalc-ov-col">
        <div className="pcalc-result-card">
          <h2 className="pcalc-ov-h">Settlement waterfall <span>per delivered order</span></h2>
          <div className="pcalc-waterfall">
            <Row label="Selling price" val={rupee(num(v.price))} kind="base" />
            <Row label="Commission / gateway" val={`−${rupee(o.commissionAmt)}`} kind="neg" />
            <Row label="Forward shipping" val={`−${rupee(o.fwd)}`} kind="neg" />
            <Row label="Fixed / collection fee" val={`−${rupee(o.payAmt)}`} kind="neg" />
            <Row label="Net settlement" val={rupee(o.netSettlement)} kind="sub" />
            <Row label="Product cost" val={`−${rupee(o.productCost)}`} kind="neg" />
            <Row label="Ad / acquisition" val={`−${rupee(o.adsAmt)}`} kind="neg" />
            <Row label="Delivered profit" val={rupee(o.deliveredProfit)} kind={deliveredPos ? 'pos' : 'neg-bold'} />
          </div>
        </div>

        <div className="pcalc-result-card">
          <h2 className="pcalc-ov-h">Margins</h2>
          <div className="pcalc-metrics pcalc-metrics-3">
            <Metric label="Net margin" hint="blended · on revenue" val={pct1(o.netMargin)} tone={blendedPos ? 'pos' : 'neg'} />
            <Metric label="Delivered · on revenue" val={pct1(o.deliveredMarginRev)} tone={deliveredPos ? 'pos' : 'neg'} />
            <Metric label="Delivered · on cost" val={pct1(o.deliveredMarginCost)} tone={deliveredPos ? 'pos' : 'neg'} />
          </div>
        </div>
      </div>

      <div className="pcalc-ov-col">
        <div className="pcalc-result-card">
          <div className={`pcalc-hero ${blendedPos ? 'pos' : 'neg'}`}>
            <span className="pcalc-hero-label">Blended profit / order</span>
            <span className="pcalc-hero-val">{rupee(o.blendedProfit)}</span>
            <span className="pcalc-hero-sub">Net margin {pct1(o.netMargin)} · {pct1(o.deliveredShare * 100)} of orders deliver</span>
          </div>
          <div className="pcalc-drag">
            <div className="pcalc-drag-head">Failure drag <span>per order, blended</span></div>
            <Row label={`RTO (${num(v.rtoPct)}%) · −${rupee(o.rtoLoss)}/order`} val={`−${rupee(o.rtoDrag)}`} kind="neg" />
            <Row label={`Cancellations (${num(v.cancelPct)}%) · −${rupee(o.cancelLoss)}/order`} val={`−${rupee(o.cancelDrag)}`} kind="neg" />
            <Row label={`Returns (${num(v.returnPct)}%) · −${rupee(o.returnLoss)}/order`} val={`−${rupee(o.returnDrag)}`} kind="neg" />
            <Row label="Blended profit / order" val={rupee(o.blendedProfit)} kind={blendedPos ? 'pos' : 'neg-bold'} />
          </div>
          <div className="pcalc-metrics">
            <Metric label="Break-even price" hint="failure-adjusted" val={rupee(o.breakeven)} tone="neutral" />
            <Metric label="Return haircut" hint="COGS lost / return" val={rupee(o.haircutAmt)} tone="neutral" />
            <Metric label="Channel" val={own ? 'Own website' : 'Marketplace'} tone="muted" />
            <Metric label="GST on sale" hint={`${num(v.gstPct)}% · info`} val={rupee(o.gstOnSale)} tone="muted" />
          </div>
          <p className="pcalc-note">
            GST is reference-only — input tax credit typically offsets output GST. Margin “on cost” uses Casper’s return-on-cost basis.
          </p>
        </div>
      </div>
    </div>
  )
}

// ── Field components ─────────────────────────────────────────────────────────
function MoneyField({ f, field, price, onChange }) {
  const amt = field.u === 'pct' ? price * num(field.v) / 100 : num(field.v)
  const equiv = field.u === 'pct'
    ? `= ${rupee(amt)}`
    : `= ${price > 0 ? pct1(amt / price * 100) : '—'} of price`
  const toUnit = u => {
    if (u === field.u) return
    const nv = u === 'pct' ? (price > 0 ? String(r2(amt / price * 100)) : field.v) : String(r2(amt))
    onChange({ v: nv, u })
  }
  return (
    <label className="pcalc-field">
      <span className="pcalc-flabel">{f.label}{f.hint && <span className="pcalc-fhint">{f.hint}</span>}</span>
      <span className="pcalc-input-wrap">
        <input type="number" inputMode="decimal" min="0" step="any" className="pcalc-input"
          value={field.v} onChange={e => onChange({ ...field, v: e.target.value })} aria-label={f.label} />
        <span className="pcalc-uxtoggle">
          <button type="button" className={field.u === 'rs' ? 'on' : ''} onClick={() => toUnit('rs')} aria-label="rupees">₹</button>
          <button type="button" className={field.u === 'pct' ? 'on' : ''} onClick={() => toUnit('pct')} aria-label="percent">%</button>
        </span>
      </span>
      <span className="pcalc-equiv">{equiv}</span>
    </label>
  )
}

function RateField({ f, value, onChange }) {
  return (
    <label className="pcalc-field">
      <span className="pcalc-flabel">{f.label}{f.hint && <span className="pcalc-fhint">{f.hint}</span>}</span>
      <span className="pcalc-input-wrap">
        <span className="pcalc-unit">{f.unit}</span>
        <input type="number" inputMode="decimal" min="0" step="any" className="pcalc-input"
          value={value} onChange={e => onChange(e.target.value)} aria-label={f.label} />
      </span>
    </label>
  )
}

function Row({ label, val, kind }) {
  return (
    <div className={`pcalc-wrow pcalc-wrow-${kind}`}>
      <span className="pcalc-wlabel">{label}</span>
      <span className="pcalc-wval">{val}</span>
    </div>
  )
}

function Metric({ label, hint, val, tone }) {
  return (
    <div className={`pcalc-metric pcalc-metric-${tone}`}>
      <span className="pcalc-mlabel">{label}{hint && <em>{hint}</em>}</span>
      <span className="pcalc-mval">{val}</span>
    </div>
  )
}
