import { useState, useEffect } from 'react'
import { getPnlConsolidated } from '../../api/client'
import { fmt } from './flipkart/utils'
import './Flipkart.css'

/**
 * Business P&L — blended contribution-margin statement across all platforms
 * (latest report per platform). All math from the backend /pnl/consolidated engine.
 */
export default function ConsolidatedPnL() {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr]         = useState(null)

  useEffect(() => {
    let alive = true
    getPnlConsolidated()
      .then(d => { if (alive) { setData(d); setLoading(false) } })
      .catch(() => { if (alive) { setErr('Could not load consolidated P&L'); setLoading(false) } })
    return () => { alive = false }
  }, [])

  if (loading) return <div className="pnl-page"><div className="pnl-empty">Building business P&L…</div></div>
  if (err || !data || !data.platforms?.length) return (
    <div className="pnl-page">
      <div className="pnl-empty-state">
        <div className="pnl-empty-title">{err || 'No platform reports yet'}</div>
        <div className="pnl-empty-sub">Upload settlement reports per platform to see a consolidated business P&L.</div>
      </div>
    </div>
  )

  const st = data.subtotals, m = data.margins
  const profitTone = (st.operating_profit || 0) >= 0 ? 'pos' : 'neg'

  return (
    <div className="pnl-page">
      <div className="pnl-header">
        <h1 className="pnl-title">Business P&amp;L</h1>
        <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
          Blended across {data.platforms.length} platform{data.platforms.length !== 1 ? 's' : ''} · latest report each
        </div>
      </div>

      <div className="pnl-body pnl-body-full pnl-animate-in">
        <div className="is-kpis">
          <Kpi label="Net Sales"        value={fmt(st.net_sales)} />
          <Kpi label="Contribution"     value={fmt(st.contribution)} />
          <Kpi label="Operating Profit" value={fmt(st.operating_profit)} tone={profitTone} big />
          <Kpi label="Operating Margin" value={m.operating_margin_pct != null ? m.operating_margin_pct + '%' : '—'} tone={profitTone} />
          <Kpi label="Blended Take"     value={m.take_rate_pct != null ? m.take_rate_pct + '%' : '—'} tone="muted" />
        </div>

        <div className="is-grid">
          {/* Blended statement */}
          <div className="is-statement">
            <div className="is-hdr"><span>Consolidated</span><span className="is-hdr-amt">Amount</span><span className="is-hdr-margin">% Net Sales</span></div>
            <Row label="Net Sales" amount={st.net_sales} kind="subtotal" margin={100} />
            <Row label="Platform Fees" amount={-(st.total_platform_fees || 0)} kind="expense" />
            <Row label="Net Payout" amount={st.net_payout} kind="subtotal" />
            <Row label="COGS (Product Cost)" amount={-(st.cogs || 0)} kind="expense" />
            <Row label="Contribution Margin" amount={st.contribution} kind="subtotal" margin={m.contribution_margin_pct} />
            <Row label="Overhead Absorption" amount={-(st.overhead || 0)} kind="expense" />
            <Row label="Operating / Net Profit" amount={st.operating_profit} kind="total" margin={m.operating_margin_pct} />
          </div>

          {/* Per-platform breakdown */}
          <div className="is-side">
            <div className="is-recon">
              <div className="is-recon-title">By Platform</div>
              {data.platforms.map((p, i) => (
                <div key={i} className="is-plat-row">
                  <span className="is-plat-name">{p.platform}</span>
                  <span className="is-plat-sales">{fmt(p.net_sales)}</span>
                  <span className={`is-plat-margin ${(p.operating_margin_pct || 0) >= 0 ? 'pos' : 'neg'}`}>
                    {p.operating_margin_pct != null ? p.operating_margin_pct + '%' : '—'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Kpi({ label, value, tone = '', big }) {
  return (
    <div className={`is-kpi${big ? ' big' : ''}`}>
      <div className="is-kpi-label">{label}</div>
      <div className={`is-kpi-val ${tone}`}>{value}</div>
    </div>
  )
}

function Row({ label, amount, kind, margin }) {
  const neg = (amount || 0) < 0
  const money = amount == null ? '—' : (neg ? `(${fmt(Math.abs(amount))})` : fmt(amount))
  return (
    <div className={`is-line ${kind}`} style={{ paddingLeft: 16 }}>
      <span className="is-line-label">{label}</span>
      <span className={`is-line-amt ${neg ? 'neg' : ''}`}>{money}</span>
      <span className="is-line-margin">{margin != null ? `${margin}%` : ''}</span>
    </div>
  )
}
