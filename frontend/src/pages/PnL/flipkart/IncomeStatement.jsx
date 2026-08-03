import { useState, useEffect } from 'react'
import { getPnlStatement, getPnlTrend } from '../../../api/client'
import { fmt } from './utils'

/**
 * P&L Statement — industry-standard contribution-margin income statement.
 * All math comes from the backend engine (/pnl/statement/{id}); this view only
 * presents it: statement lines with margin tiers, settlement reconciliation,
 * COGS-coverage data-quality, a period-over-period trend, and CSV/print export.
 */

// Which subtotal lines carry a margin % (of net sales).
const MARGIN_FOR = {
  net_sales:        'net_sales_100',
  gross_profit:     'gross_margin_pct',
  contribution:     'contribution_margin_pct',
  operating_profit: 'operating_margin_pct',
}

function money(v) {
  if (v == null) return '—'
  const neg = v < 0
  const s = fmt(Math.abs(v))
  return neg ? `(${s})` : s
}

export default function IncomeStatement({ report }) {
  const [stmt, setStmt]       = useState(null)
  const [trend, setTrend]     = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr]         = useState(null)

  useEffect(() => {
    let alive = true
    setLoading(true); setErr(null)
    getPnlStatement(report.id)
      .then(s => { if (alive) { setStmt(s); setLoading(false) } })
      .catch(() => { if (alive) { setErr('Could not build statement'); setLoading(false) } })
    getPnlTrend(report.platform_id).then(t => alive && setTrend(t)).catch(() => {})
    return () => { alive = false }
  }, [report.id, report.platform_id])

  if (loading) return <div className="pnl-body"><div className="pnl-empty">Building statement…</div></div>
  if (err || !stmt) return <div className="pnl-body"><div className="pnl-empty">{err || 'No statement data'}</div></div>

  const st = stmt.subtotals, m = stmt.margins, rec = stmt.reconciliation, cov = stmt.coverage
  const reconciled = Math.abs(rec.variance || 0) < 1
  const profitTone = (st.operating_profit || 0) >= 0 ? 'pos' : 'neg'

  return (
    <div className="pnl-body pnl-body-full pnl-animate-in">

      {/* KPI header */}
      <div className="is-kpis">
        <Kpi label="Net Sales"        value={fmt(st.net_sales)} />
        <Kpi label="Net Payout"       value={fmt(st.net_payout)} sub={reconciled ? 'Reconciled' : 'Check settlement'} subTone={reconciled ? 'pos' : 'amber'} />
        <Kpi label="Operating Profit" value={fmt(st.operating_profit)} tone={profitTone} big />
        <Kpi label="Operating Margin" value={m.operating_margin_pct != null ? m.operating_margin_pct + '%' : '—'} tone={profitTone} />
        <Kpi label="Platform Take"    value={m.take_rate_pct != null ? m.take_rate_pct + '%' : '—'} tone="muted" />
        <div className="is-actions">
          <button className="pnl-btn-ghost" onClick={() => exportCsv(stmt)}>Export CSV</button>
          <button className="pnl-btn-ghost" onClick={() => window.print()}>Print</button>
        </div>
      </div>

      {!cov.reliable && cov.cogs_coverage_pct != null && (
        <div className="is-warn">
          COGS coverage {cov.cogs_coverage_pct}% — {cov.total_units - cov.matched_units} of {cov.total_units} units
          have no cost match, so profit is understated. Add pricing in SKUs to complete the statement.
        </div>
      )}

      <div className="is-grid">
        {/* The statement */}
        <div className="is-statement" id="income-statement-print">
          <div className="is-hdr">
            <span>{stmt.report.platform} · {stmt.report.period}</span>
            <span className="is-hdr-amt">Amount</span>
            <span className="is-hdr-margin">% Net Sales</span>
          </div>
          {stmt.lines.map(l => {
            const mKey = MARGIN_FOR[l.key]
            const marginPct = mKey === 'net_sales_100' ? 100 : (mKey ? m[mKey] : null)
            return <StatementLine key={l.key} line={l} marginPct={marginPct} />
          })}
        </div>

        {/* Reconciliation + trend */}
        <div className="is-side">
          <div className={`is-recon ${reconciled ? 'ok' : 'warn'}`}>
            <div className="is-recon-title">Settlement Reconciliation</div>
            <div className="is-recon-row"><span>Computed net payout</span><span>{fmt(rec.computed_net_payout)}</span></div>
            <div className="is-recon-row"><span>Actual bank settlement</span><span>{fmt(rec.actual_bank_settlement)}</span></div>
            <div className="is-recon-row strong"><span>Variance</span><span>{fmt(rec.variance)}</span></div>
            <div className="is-recon-badge">{reconciled ? 'Statement reconciles to platform settlement' : 'Does not fully reconcile — review fees'}</div>
          </div>
          <TrendCard trend={trend} />
        </div>
      </div>
    </div>
  )
}

function Kpi({ label, value, sub, subTone, tone = '', big }) {
  return (
    <div className={`is-kpi${big ? ' big' : ''}`}>
      <div className="is-kpi-label">{label}</div>
      <div className={`is-kpi-val ${tone}`}>{value}</div>
      {sub && <div className={`is-kpi-sub ${subTone || ''}`}>{sub}</div>}
    </div>
  )
}

function StatementLine({ line, marginPct }) {
  const neg = (line.amount || 0) < 0
  const cls = line.kind === 'total' ? 'total' : line.kind === 'subtotal' ? 'subtotal' : line.kind === 'revenue' ? 'revenue' : 'expense'
  return (
    <div className={`is-line ${cls}`} style={{ paddingLeft: 16 + line.depth * 18 }}>
      <span className="is-line-label">
        {line.label}
        {line.note && <span className="is-line-note">{line.note}</span>}
      </span>
      <span className={`is-line-amt ${neg ? 'neg' : ''}`}>{money(line.amount)}</span>
      <span className="is-line-margin">{marginPct != null ? `${marginPct}%` : ''}</span>
    </div>
  )
}

function TrendCard({ trend }) {
  if (!trend || !trend.series || trend.series.length < 2) {
    return (
      <div className="is-trend">
        <div className="is-recon-title">Profit Trend</div>
        <div className="is-trend-empty">Upload more periods to see a month-over-month trend.</div>
      </div>
    )
  }
  const series = trend.series
  const max = Math.max(...series.map(s => Math.abs(s.operating_profit || 0)), 1)
  const d = trend.delta
  return (
    <div className="is-trend">
      <div className="is-recon-title">Operating Profit Trend</div>
      <div className="is-trend-bars">
        {series.map((s, i) => {
          const h = Math.round((Math.abs(s.operating_profit || 0) / max) * 100)
          const neg = (s.operating_profit || 0) < 0
          return (
            <div key={i} className="is-trend-bar-wrap" title={`${s.period}: ${fmt(s.operating_profit)}`}>
              <div className={`is-trend-bar ${neg ? 'neg' : ''}`} style={{ height: `${Math.max(h, 3)}%` }} />
              <div className="is-trend-lbl">{(s.period || '').slice(5)}</div>
            </div>
          )
        })}
      </div>
      {d && (
        <div className="is-trend-delta">
          <span>vs previous</span>
          <span className={(d.operating_profit || 0) >= 0 ? 'pos' : 'neg'}>
            {(d.operating_profit || 0) >= 0 ? '+' : ''}{fmt(d.operating_profit)}
            {d.operating_margin_pct != null && <> · {(d.operating_margin_pct >= 0 ? '+' : '')}{d.operating_margin_pct}pp</>}
          </span>
        </div>
      )}
    </div>
  )
}

// ── CSV export ───────────────────────────────────────────────────────────────
function exportCsv(stmt) {
  const rows = [['Line', 'Amount (INR)']]
  stmt.lines.forEach(l => rows.push([l.label, l.amount ?? 0]))
  rows.push([])
  rows.push(['Gross margin %', stmt.margins.gross_margin_pct ?? ''])
  rows.push(['Contribution margin %', stmt.margins.contribution_margin_pct ?? ''])
  rows.push(['Operating margin %', stmt.margins.operating_margin_pct ?? ''])
  rows.push(['Platform take %', stmt.margins.take_rate_pct ?? ''])
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `pnl-statement-${stmt.report.platform}-${stmt.report.period}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
