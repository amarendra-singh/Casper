import { useState, useEffect, useMemo } from 'react'
import { useParams, useSearchParams, useNavigate } from 'react-router-dom'
import { getPnlReport } from '../../api/client'
import './Flipkart.css'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'

const VIEWS       = ['fk', 'pnl', 'insights']
const VIEW_LABELS = ['Flipkart Report', 'Real P&L', 'Insights']

const fmt = (v, d = 0) => {
  if (v == null) return '—'
  const n = Number(v)
  const abs = Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d })
  return (n < 0 ? '-' : '') + '₹' + abs
}
const fmtN   = v => v == null ? '—' : Number(v).toLocaleString('en-IN')
const fmtPct = v => v == null ? '—' : Number(v).toFixed(1) + '%'
const parseLocalDate = s => s ? new Date(s + 'T00:00:00') : null
const fmtPeriod = (start, end) => {
  const s = parseLocalDate(start), e = parseLocalDate(end)
  if (!s || !e) return '—'
  return `${s.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })} — ${e.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`
}

export default function FlipkartReport() {
  const { reportId }                    = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate                        = useNavigate()

  const view     = VIEWS.includes(searchParams.get('view')) ? searchParams.get('view') : 'fk'
  const tabIndex = VIEWS.indexOf(view)

  const [report,  setReport]  = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  const [skuFilter, setSkuFilter] = useState('all')
  const [skuSearch, setSkuSearch] = useState('')
  const [sortCol,   setSortCol]   = useState('total_true_profit')
  const [sortDir,   setSortDir]   = useState('asc')

  useEffect(() => {
    setLoading(true); setError(null)
    getPnlReport(Number(reportId))
      .then(data => { setReport(data); setLoading(false) })
      .catch(() => { setError('Report not found'); setLoading(false) })
  }, [reportId])

  function setView(v) { setSearchParams({ view: v }, { replace: true }) }

  // ── Augmented rows ──────────────────────────────────────────────────────────
  const matchedRows   = (report?.sku_rows || []).filter(r => r.is_matched)
  const augmentedRows = matchedRows.map(r => {
    const fkBsPerUnit = (r.bank_settlement_projected != null && r.net_units)
      ? r.bank_settlement_projected / r.net_units : null   // null-safe: bsp=null → null
    const varPerUnit = (fkBsPerUnit != null && r.casper_expected_bs != null)
      ? fkBsPerUnit - r.casper_expected_bs : null
    const varTotal = (varPerUnit != null && r.net_units != null)
      ? varPerUnit * r.net_units : null
    const revShipPerUnit = (r.reverse_shipping_fee != null && r.net_units)
      ? Math.abs(r.reverse_shipping_fee) / r.net_units : null
    const feesPerUnit = r.net_units ? (
      (Math.abs(r.commission_fee || 0) + Math.abs(r.collection_fee || 0) +
       Math.abs(r.fixed_fee || 0) +
       Math.abs(r.taxes_gst || 0) + Math.abs(r.taxes_tcs || 0) + Math.abs(r.taxes_tds || 0)
       - Math.abs(r.rewards_benefits || 0)) / r.net_units
    ) : null
    const totalEarned   = r.bank_settlement_projected ?? null
    const expectedTotal = (r.casper_expected_bs != null && r.net_units != null)
      ? r.casper_expected_bs * r.net_units : null
    const realMarginPct = (fkBsPerUnit != null && r.casper_expected_bs)
      ? ((fkBsPerUnit - r.casper_expected_bs) / r.casper_expected_bs) * 100 : null
    return {
      ...r,
      fk_bs_per_unit: fkBsPerUnit,
      true_profit_per_unit: varPerUnit, total_true_profit: varTotal,
      rev_ship_per_unit: revShipPerUnit,
      fees_per_unit: feesPerUnit, total_earned: totalEarned, expected_total: expectedTotal,
      real_margin_pct: realMarginPct,
    }
  })

  const filteredRows = augmentedRows
    .filter(r => {
      if (skuFilter === 'profit') return (r.total_true_profit ?? 0) > 0
      if (skuFilter === 'loss')   return (r.total_true_profit ?? 0) <= 0
      return true
    })
    .filter(r => !skuSearch || r.platform_sku_name.toLowerCase().includes(skuSearch.toLowerCase()))
    .sort((a, b) => {
      const av = a[sortCol] ?? (sortDir === 'asc' ? Infinity : -Infinity)
      const bv = b[sortCol] ?? (sortDir === 'asc' ? Infinity : -Infinity)
      return sortDir === 'asc' ? av - bv : bv - av
    })

  function toggleSort(col) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }
  const sortIcon = col => sortCol === col ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''

  // ── Insights data ────────────────────────────────────────────────────────────
  const insightsData = useMemo(() => {
    if (!report) return null
    const rows    = report.sku_rows || []
    const matched = rows.filter(r => r.is_matched && r.variance_bs != null)
    const totalActualBS    = matched.reduce((s, r) => s + (r.bank_settlement_projected || 0), 0)
    const totalExpectedBS  = matched.reduce((s, r) => s + (r.casper_expected_bs || 0) * (r.net_units || 0), 0)
    const netVariance      = totalActualBS - totalExpectedBS
    const totalRevShipping = rows.reduce((s, r) => s + Math.abs(r.reverse_shipping_fee || 0), 0)
    const totalCommission  = rows.reduce((s, r) => s + Math.abs(r.commission_fee || 0), 0)
    const totalCollection  = rows.reduce((s, r) => s + Math.abs(r.collection_fee || 0), 0)
    const totalGST         = rows.reduce((s, r) => s + Math.abs(r.taxes_gst || 0), 0)
    const totalTax         = rows.reduce((s, r) => s + Math.abs(r.taxes_tcs || 0) + Math.abs(r.taxes_tds || 0), 0)
    const totalRewards     = rows.reduce((s, r) => s + (r.rewards_benefits || 0), 0)
    const totalRTO         = rows.reduce((s, r) => s + (r.rto_units || 0), 0)
    const totalRVP         = rows.reduce((s, r) => s + (r.rvp_units || 0), 0)
    const totalCancelled   = rows.reduce((s, r) => s + (r.cancelled_units || 0), 0)
    const sortedByVar      = [...matched].sort((a, b) => b.variance_bs - a.variance_bs)
    const varianceChartData = [
      ...sortedByVar.filter(r => r.variance_bs < 0).slice(-6),
      ...sortedByVar.filter(r => r.variance_bs > 0).slice(0, 6),
    ].map(r => ({ name: r.platform_sku_name.split('-').slice(-2).join('-'), fullName: r.platform_sku_name, variance: Math.round(r.variance_bs) }))
    const marginBrackets = [
      { label: 'Loss',   count: rows.filter(r => (r.net_margin_pct||0) < 0).length,                                   color: '#ef4444' },
      { label: '0–20%',  count: rows.filter(r => (r.net_margin_pct||0) >= 0  && (r.net_margin_pct||0) < 20).length,  color: '#f97316' },
      { label: '20–50%', count: rows.filter(r => (r.net_margin_pct||0) >= 20 && (r.net_margin_pct||0) < 50).length,  color: '#eab308' },
      { label: '50–80%', count: rows.filter(r => (r.net_margin_pct||0) >= 50 && (r.net_margin_pct||0) < 80).length,  color: '#22c55e' },
      { label: '80%+',   count: rows.filter(r => (r.net_margin_pct||0) >= 80).length,                                  color: '#16a34a' },
    ]
    const beatingSkus = matched.filter(r => r.variance_bs > 0)
    const missingSkus = matched.filter(r => r.variance_bs < 0)
    return {
      totalActualBS, totalExpectedBS, netVariance,
      totalRevShipping, totalCommission, totalCollection, totalGST, totalTax, totalRewards,
      totalRTO, totalRVP, totalCancelled, varianceChartData, marginBrackets,
      beatingCount: beatingSkus.length, missingCount: missingSkus.length,
      beatingTotal: beatingSkus.reduce((s, r) => s + r.variance_bs, 0),
      missingTotal: missingSkus.reduce((s, r) => s + r.variance_bs, 0),
    }
  }, [report])

  // ── Loading / error states ────────────────────────────────────────────────────
  if (loading) return (
    <div className="pnl-page">
      <div className="pnl-empty">Loading report…</div>
    </div>
  )
  if (error) return (
    <div className="pnl-page">
      <div className="pnl-empty-state">
        <div className="pnl-empty-icon">⚠</div>
        <div className="pnl-empty-title">{error}</div>
        <button className="pnl-btn-ghost" onClick={() => navigate('/pnl/flipkart')}>← Back to Reports</button>
      </div>
    </div>
  )

  const profitSkus       = augmentedRows.filter(r => (r.total_true_profit ?? 0) > 0)
  const lossSkus         = augmentedRows.filter(r => (r.total_true_profit ?? 0) <= 0)
  const totalProfit      = augmentedRows.reduce((s, r) => s + (r.total_true_profit || 0), 0)
  const avgProfitPerUnit = augmentedRows.length
    ? augmentedRows.reduce((s, r) => s + (r.true_profit_per_unit || 0), 0) / augmentedRows.length
    : null

  return (
    <div className="pnl-page">

      {/* ── Header ── */}
      <div className="pnl-header">
        <div className="pnl-title-row">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <button className="pnl-btn-ghost" style={{ fontSize: 11, padding: '3px 10px' }}
                onClick={() => navigate('/pnl/flipkart')}>← Reports</button>
              <div className="pnl-platform-badge"><span className="pnl-fk-dot"/>Flipkart</div>
            </div>
            <h1 className="pnl-title">{fmtPeriod(report.period_start, report.period_end)}</h1>
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{report.filename}</div>
          </div>
        </div>
        <div className="pnl-tabs">
          {VIEW_LABELS.map((label, i) => (
            <button key={label} className={`pnl-tab${tabIndex === i ? ' active' : ''}`}
              onClick={() => setView(VIEWS[i])}>{label}</button>
          ))}
        </div>
      </div>

      {/* ── Flipkart Report ── */}
      {view === 'fk' && (
        <div className="pnl-body pnl-animate-in">
          <div className="pnl-fk-report">

            <div className="pnl-fk-section-title">Revenue Flow</div>
            <div className="pnl-fk-panels">

              <div className="pnl-fk-panel">
                <div className="pnl-fk-panel-title">Sales</div>
                <div className="pnl-fk-rows">
                  <div className="pnl-fk-row base"><span>Gross Sales</span><span>{fmt(report.gross_sales)}</span></div>
                  <div className="pnl-fk-row cost"><span>Returns Deducted</span><span>−{fmt(Math.abs(report.returns_amount || 0))}</span></div>
                  <div className="pnl-fk-row result"><span>Net Sales</span><span>{fmt(report.net_sales)}</span></div>
                </div>
              </div>

              <div className="pnl-fk-panel">
                <div className="pnl-fk-panel-title">Flipkart Fees</div>
                <div className="pnl-fk-rows">
                  {insightsData && [
                    { label: 'Reverse Shipping',   value: insightsData.totalRevShipping, neg: true  },
                    { label: 'Commission',         value: insightsData.totalCommission,  neg: true  },
                    { label: 'Collection Fee',     value: insightsData.totalCollection,  neg: true  },
                    { label: 'GST on Fees',        value: insightsData.totalGST,         neg: true  },
                    { label: 'TCS / TDS',          value: insightsData.totalTax,         neg: true  },
                    { label: 'Rewards / Benefits', value: insightsData.totalRewards,     neg: false },
                    { label: 'Total Expenses',     value: report.total_expenses, neg: true, bold: true },
                  ].filter(x => x.value != null && x.value !== 0).map((item, i) => (
                    <div key={i} className={`pnl-fk-row ${item.bold ? 'result' : item.neg ? 'cost' : 'benefit'}`}>
                      <span>{item.label}</span>
                      <span>{item.neg ? '−' : '+'}{fmt(Math.abs(item.value))}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="pnl-fk-panel">
                <div className="pnl-fk-panel-title">Settlement</div>
                <div className="pnl-fk-rows">
                  <div className="pnl-fk-row base"><span>Net Earnings</span><span>{fmt(report.net_earnings)}</span></div>
                  <div className="pnl-fk-row base"><span>Input Tax Credits</span><span>{fmt(report.input_tax_credits)}</span></div>
                  <div className="pnl-fk-row result gold"><span>Bank Settlement</span><span>{fmt(report.bank_settlement)}</span></div>
                  <div className="pnl-fk-row benefit"><span>Amount Settled</span><span>{fmt(report.amount_settled)}</span></div>
                  {(report.amount_pending || 0) !== 0 && (
                    <div className="pnl-fk-row cost"><span>Amount Pending</span><span>{fmt(report.amount_pending)}</span></div>
                  )}
                  <div className="pnl-fk-row result"><span>Flipkart Margin</span><span>{fmtPct(report.net_margin_pct)}</span></div>
                </div>
              </div>

            </div>

            <div className="pnl-fk-section-title" style={{ marginTop: 24 }}>Unit Flow</div>
            <div className="pnl-fk-units">
              {[
                { label: 'Gross Orders',  value: report.gross_units,               cls: 'base',   icon: '📦' },
                { label: 'RTO',           value: insightsData?.totalRTO || 0,      cls: 'cost',   icon: '↩' },
                { label: 'RVP',           value: insightsData?.totalRVP || 0,      cls: 'cost',   icon: '↩' },
                { label: 'Cancelled',     value: insightsData?.totalCancelled || 0, cls: 'cost',  icon: '✕' },
                { label: 'Net Delivered', value: report.net_units,                 cls: 'result', icon: '✓' },
              ].map((item, i) => (
                <div key={i} className={`pnl-fk-unit-card pnl-fk-unit-${item.cls}`}>
                  <div className="pnl-fku-icon">{item.icon}</div>
                  <div className="pnl-fku-num">{fmtN(item.value)}</div>
                  <div className="pnl-fku-label">{item.label}</div>
                  <div className="pnl-fku-pct">{((item.value / (report.gross_units || 1)) * 100).toFixed(1)}%</div>
                </div>
              ))}
            </div>

            <div className="pnl-fk-section-title" style={{ marginTop: 24 }}>SKU Summary</div>
            <div className="pnl-fk-sku-summary">
              <div className="pnl-fk-sku-stat">
                <div className="pnl-fk-sku-num">{report.total_skus}</div>
                <div className="pnl-fk-sku-lbl">Total SKUs</div>
              </div>
              <div className="pnl-fk-sku-stat green">
                <div className="pnl-fk-sku-num">{report.matched_skus}</div>
                <div className="pnl-fk-sku-lbl">Matched to pricing</div>
              </div>
              {report.unmatched_skus > 0 && (
                <div className="pnl-fk-sku-stat amber">
                  <div className="pnl-fk-sku-num">{report.unmatched_skus}</div>
                  <div className="pnl-fk-sku-lbl">No pricing data</div>
                </div>
              )}
              <button className="pnl-fk-switch-btn" onClick={() => setView('pnl')}>
                View Real P&amp;L → SKU Breakdown
              </button>
            </div>

          </div>
        </div>
      )}

      {/* ── Real P&L ── */}
      {view === 'pnl' && (
        <div className="pnl-body pnl-body-full pnl-animate-in">

          {/* Summary bar */}
          {(() => {
            const totalExpected = augmentedRows.reduce((s, r) => s + ((r.casper_expected_bs || 0) * (r.net_units || 0)), 0)
            const totalActual   = augmentedRows.reduce((s, r) => s + (r.bank_settlement_projected || 0), 0)
            const overallVarPct = totalExpected > 0 ? ((totalActual - totalExpected) / totalExpected) * 100 : null
            return (
              <div className="pnl-summary-bar">
                <div className="pnl-sum-item">
                  <div className="pnl-sum-label">Total Expected BS</div>
                  <div className="pnl-sum-val muted">{fmt(totalExpected)}</div>
                </div>
                <div className="pnl-sum-item">
                  <div className="pnl-sum-label">FK Bank Settlement</div>
                  <div className="pnl-sum-val gold">{fmt(totalActual)}</div>
                </div>
                <div className="pnl-sum-item">
                  <div className="pnl-sum-label">Net Variance</div>
                  <div className={`pnl-sum-val ${totalProfit >= 0 ? 'green' : 'red'}`}>
                    {totalProfit >= 0 ? '+' : ''}{fmt(totalProfit)}
                    {overallVarPct != null && <span className="pnl-sum-pct"> ({overallVarPct >= 0 ? '+' : ''}{overallVarPct.toFixed(1)}%)</span>}
                  </div>
                </div>
                <div className="pnl-sum-divider"/>
                <div className="pnl-sum-item">
                  <div className="pnl-sum-label">Avg Var/unit</div>
                  <div className={`pnl-sum-val ${(avgProfitPerUnit ?? 0) >= 0 ? 'green' : 'red'}`}>
                    {avgProfitPerUnit != null ? ((avgProfitPerUnit >= 0 ? '+' : '') + fmt(avgProfitPerUnit, 2)) : '—'}
                  </div>
                </div>
                <div className="pnl-sum-divider"/>
                <div className="pnl-sum-item">
                  <div className="pnl-sum-label">Beating Target</div>
                  <div className="pnl-sum-val green">{profitSkus.length}</div>
                </div>
                <div className="pnl-sum-item">
                  <div className="pnl-sum-label">Missing Target</div>
                  <div className="pnl-sum-val red">{lossSkus.length}</div>
                </div>
                <div className="pnl-sum-divider"/>
                <div className="pnl-sum-item">
                  <div className="pnl-sum-label">Net Units</div>
                  <div className="pnl-sum-val">{fmtN(report.net_units)}</div>
                </div>
                {report.unmatched_skus > 0 && (
                  <div className="pnl-sum-item">
                    <div className="pnl-sum-label">No Pricing Data</div>
                    <div className="pnl-sum-val amber">{report.unmatched_skus} SKUs hidden</div>
                  </div>
                )}
              </div>
            )
          })()}

          {/* Controls */}
          <div className="pnl-tbl-controls">
            <input className="pnl-search" placeholder="Search SKU…" value={skuSearch}
              onChange={e => setSkuSearch(e.target.value)} />
            <div className="pnl-filter-pills">
              {[
                { key: 'all',    label: `All Matched (${augmentedRows.length})` },
                { key: 'profit', label: `Beating (${profitSkus.length})` },
                { key: 'loss',   label: `Missing (${lossSkus.length})` },
              ].map(f => (
                <button key={f.key}
                  className={`pnl-fpill${skuFilter === f.key ? ' active' : ''}`}
                  onClick={() => setSkuFilter(f.key)}>{f.label}</button>
              ))}
            </div>
            <span className="pnl-row-count">{filteredRows.length} SKUs</span>
          </div>

          {/* Table */}
          <div className="pnl-tbl-wrap">
            <table className="pnl-tbl">
              <thead>
                <tr>
                  <th className="pnl-th sticky-col">SKU</th>
                  <th className="pnl-th sortable" onClick={() => toggleSort('net_units')}>
                    <span className="pnl-th-label">Net Units</span>
                    {sortIcon('net_units')}
                  </th>
                  <th className="pnl-th sortable" onClick={() => toggleSort('return_rate_pct')}>
                    <span className="pnl-th-label">Return Rate</span>
                    {sortIcon('return_rate_pct')}
                  </th>
                  <th className="pnl-th sortable" onClick={() => toggleSort('rev_ship_per_unit')}>
                    <span className="pnl-th-label">Return Drag/unit</span>
                    <span className="pnl-th-sub">Rev. ship ÷ delivered</span>
                    {sortIcon('rev_ship_per_unit')}
                  </th>
                  <th className="pnl-th sortable" onClick={() => toggleSort('fees_per_unit')}>
                    <span className="pnl-th-label">FK Fees/unit</span>
                    <span className="pnl-th-sub">Comm + collection + tax</span>
                    {sortIcon('fees_per_unit')}
                  </th>
                  <th className="pnl-th sortable" onClick={() => toggleSort('fk_bs_per_unit')}>
                    <span className="pnl-th-label">FK BS/unit</span>
                    <span className="pnl-th-sub">Settlement per unit</span>
                    {sortIcon('fk_bs_per_unit')}
                  </th>
                  <th className="pnl-th sortable" onClick={() => toggleSort('casper_expected_bs')}>
                    <span className="pnl-th-label">Target BS/unit</span>
                    <span className="pnl-th-sub">All costs + profit + GST</span>
                    {sortIcon('casper_expected_bs')}
                  </th>
                  <th className="pnl-th sortable pnl-th-primary" onClick={() => toggleSort('true_profit_per_unit')}>
                    <span className="pnl-th-label">Var/unit</span>
                    <span className="pnl-th-sub">FK BS − Target BS</span>
                    {sortIcon('true_profit_per_unit')}
                  </th>
                  <th className="pnl-th sortable pnl-th-primary" onClick={() => toggleSort('real_margin_pct')}>
                    <span className="pnl-th-label">Margin %</span>
                    <span className="pnl-th-sub">vs Target BS</span>
                    {sortIcon('real_margin_pct')}
                  </th>
                  <th className="pnl-th sortable" onClick={() => toggleSort('expected_total')}>
                    <span className="pnl-th-label">Expected BS</span>
                    <span className="pnl-th-sub">Target BS × units</span>
                    {sortIcon('expected_total')}
                  </th>
                  <th className="pnl-th sortable" onClick={() => toggleSort('total_earned')}>
                    <span className="pnl-th-label">FK Settlement</span>
                    <span className="pnl-th-sub">Total settled by FK</span>
                    {sortIcon('total_earned')}
                  </th>
                  <th className="pnl-th sortable pnl-th-primary" onClick={() => toggleSort('total_true_profit')}>
                    <span className="pnl-th-label">Net</span>
                    <span className="pnl-th-sub">FK Settlement − Expected BS</span>
                    {sortIcon('total_true_profit')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map(row => {
                  const profit    = row.true_profit_per_unit
                  const totalP    = row.total_true_profit
                  const profitCls = profit == null ? '' : profit > 0 ? 'positive' : 'negative'
                  const totalCls  = totalP == null ? '' : totalP > 0 ? 'positive' : 'negative'
                  return (
                    <tr key={row.id} className={`pnl-tr${totalP != null && totalP < 0 ? ' pnl-tr-loss' : ''}`}>
                      <td className="pnl-td sku-col sticky-col">
                        <span className="pnl-sku-name">{row.platform_sku_name}</span>
                      </td>
                      <td className="pnl-td center">
                        <span className="pnl-units-net">{fmtN(row.net_units)}</span>
                      </td>
                      <td className="pnl-td center">
                        {row.return_rate_pct != null
                          ? <span className={`pnl-ret-rate ${row.return_rate_pct > 40 ? 'high' : row.return_rate_pct > 20 ? 'mid' : 'low'}`}>{fmtPct(row.return_rate_pct)}</span>
                          : '—'}
                      </td>
                      <td className="pnl-td right mono red">
                        {row.rev_ship_per_unit != null ? fmt(row.rev_ship_per_unit, 1) : '—'}
                      </td>
                      <td className="pnl-td right mono red">{row.fees_per_unit != null ? fmt(row.fees_per_unit, 1) : '—'}</td>
                      <td className="pnl-td right mono">{row.fk_bs_per_unit != null ? fmt(row.fk_bs_per_unit, 1) : '—'}</td>
                      <td className="pnl-td right mono muted">{fmt(row.casper_expected_bs, 1)}</td>
                      <td className={`pnl-td right mono pnl-td-primary variance ${profitCls}`}>
                        {profit == null ? '—' : (profit >= 0 ? '+' : '') + fmt(profit, 1)}
                      </td>
                      <td className="pnl-td center pnl-td-primary">
                        {row.real_margin_pct == null ? '—' : (
                          <span className={`pnl-ret-rate ${row.real_margin_pct > 0 ? 'low' : row.real_margin_pct > -10 ? 'mid' : 'high'}`}>
                            {row.real_margin_pct >= 0 ? '+' : ''}{row.real_margin_pct.toFixed(1)}%
                          </span>
                        )}
                      </td>
                      <td className="pnl-td right mono muted">{row.expected_total != null ? fmt(row.expected_total) : '—'}</td>
                      <td className="pnl-td right mono">{row.total_earned != null ? fmt(row.total_earned) : '—'}</td>
                      <td className={`pnl-td right mono pnl-td-primary variance ${totalCls}`}>
                        {totalP == null ? '—' : (totalP >= 0 ? '+' : '') + fmt(totalP)}
                      </td>
                    </tr>
                  )
                })}
                {filteredRows.length === 0 && (
                  <tr><td colSpan={12} className="pnl-td center" style={{ padding: '32px', color: 'var(--text-3)' }}>No SKUs match your filter</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Insights ── */}
      {view === 'insights' && (
        <div className="pnl-body pnl-insights-body pnl-animate-in">
          {insightsData && (
            <div className="ins-grid">
              <div className="ins-kpis">
                <div className="ins-kpi">
                  <div className="ins-kpi-label">Flipkart Settlement</div>
                  <div className="ins-kpi-val gold">{fmt(insightsData.totalActualBS)}</div>
                  <div className="ins-kpi-sub">{insightsData.beatingCount + insightsData.missingCount} matched SKUs</div>
                </div>
                <div className="ins-kpi">
                  <div className="ins-kpi-label">Your Target Settlement</div>
                  <div className="ins-kpi-val">{fmt(insightsData.totalExpectedBS)}</div>
                  <div className="ins-kpi-sub">Based on SKU pricing formula</div>
                </div>
                <div className={`ins-kpi ${insightsData.netVariance >= 0 ? 'ins-kpi-pos' : 'ins-kpi-neg'}`}>
                  <div className="ins-kpi-label">Net P&amp;L Signal</div>
                  <div className={`ins-kpi-val ${insightsData.netVariance >= 0 ? 'green' : 'red'}`}>
                    {insightsData.netVariance >= 0 ? '+' : ''}{fmt(insightsData.netVariance)}
                  </div>
                  <div className="ins-kpi-sub">Actual vs your target</div>
                </div>
                <div className="ins-kpi ins-kpi-warn">
                  <div className="ins-kpi-label">Return Shipping Cost</div>
                  <div className="ins-kpi-val red">{fmt(-insightsData.totalRevShipping)}</div>
                  <div className="ins-kpi-sub">Biggest single fee this period</div>
                </div>
              </div>

              <div className="ins-two-col">
                <div className="ins-panel">
                  <div className="ins-panel-hdr">
                    <div>
                      <div className="ins-panel-title">Settlement Variance by SKU</div>
                      <div className="ins-panel-sub">Actual Flipkart payment vs your pricing target</div>
                    </div>
                  </div>
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={insightsData.varianceChartData} layout="vertical"
                      margin={{ top: 4, right: 48, left: 4, bottom: 0 }}>
                      <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => `₹${v}`} axisLine={false} tickLine={false} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={70} axisLine={false} tickLine={false} />
                      <Tooltip formatter={v => [`₹${Number(v).toLocaleString('en-IN')}`, 'Variance']}
                        labelFormatter={(_, p) => p?.[0]?.payload?.fullName || ''} contentStyle={{ fontSize: 12 }} />
                      <Bar dataKey="variance" radius={[0, 3, 3, 0]} barSize={14}>
                        {insightsData.varianceChartData.map((entry, i) => (
                          <Cell key={i} fill={entry.variance >= 0 ? '#22c55e' : '#ef4444'} fillOpacity={0.85} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                  <div className="ins-var-legend">
                    <span className="ins-vleg green">▲ {insightsData.beatingCount} SKUs beating target (+{fmt(insightsData.beatingTotal)})</span>
                    <span className="ins-vleg red">▼ {insightsData.missingCount} SKUs below target ({fmt(insightsData.missingTotal)})</span>
                  </div>
                </div>

                <div className="ins-panel">
                  <div className="ins-panel-hdr">
                    <div>
                      <div className="ins-panel-title">Where Your Money Goes</div>
                      <div className="ins-panel-sub">Net sales → bank settlement breakdown</div>
                    </div>
                  </div>
                  <div className="ins-waterfall">
                    {[
                      { label: 'Net Sales',        value: report.net_sales,              type: 'base'    },
                      { label: 'Reverse Shipping', value: -insightsData.totalRevShipping, type: 'cost'    },
                      { label: 'GST on Fees',      value: -insightsData.totalGST,         type: 'cost'    },
                      { label: 'TCS / TDS',        value: -insightsData.totalTax,         type: 'cost'    },
                      { label: 'Commission',       value: -insightsData.totalCommission,  type: 'cost'    },
                      { label: 'Collection Fee',   value: -insightsData.totalCollection,  type: 'cost'    },
                      { label: 'Rewards',          value: insightsData.totalRewards,      type: 'benefit' },
                      { label: 'Bank Settlement',  value: report.bank_settlement,         type: 'result'  },
                    ].map((item, i) => {
                      const base   = report.net_sales || 1
                      const barW   = Math.min(Math.abs(item.value) / base * 100, 100)
                      const pctLbl = ((item.value / base) * 100).toFixed(1) + '%'
                      return (
                        <div key={i} className={`ins-wf-row ins-wf-${item.type}`}>
                          <div className="ins-wf-label">{item.label}</div>
                          <div className="ins-wf-bar-wrap"><div className="ins-wf-bar" style={{ width: `${barW}%` }} /></div>
                          <div className="ins-wf-val">{item.value < 0 ? '−' : ''}{fmt(Math.abs(item.value))}</div>
                          <div className="ins-wf-pct">{pctLbl}</div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>

              <div className="ins-two-col">
                <div className="ins-panel">
                  <div className="ins-panel-hdr">
                    <div>
                      <div className="ins-panel-title">Return Analysis</div>
                      <div className="ins-panel-sub">Where your {fmtN(report.gross_units)} gross units went</div>
                    </div>
                  </div>
                  <div className="ins-ret-grid">
                    {[
                      { label: 'Delivered', value: report.net_units,             cls: 'green', icon: '✓' },
                      { label: 'RTO',       value: insightsData.totalRTO,        cls: 'amber', icon: '↩' },
                      { label: 'RVP',       value: insightsData.totalRVP,        cls: 'red',   icon: '↩' },
                      { label: 'Cancelled', value: insightsData.totalCancelled,  cls: 'muted', icon: '✕' },
                    ].map((item, i) => {
                      const pct = ((item.value / (report.gross_units || 1)) * 100).toFixed(1)
                      return (
                        <div key={i} className={`ins-ret-card ins-ret-${item.cls}`}>
                          <div className="ins-ret-icon">{item.icon}</div>
                          <div className="ins-ret-num">{item.value}</div>
                          <div className="ins-ret-lbl">{item.label}</div>
                          <div className="ins-ret-pct">{pct}%</div>
                        </div>
                      )
                    })}
                  </div>
                  <div className="ins-ret-note">
                    Avg return shipping cost per returned unit: {fmt(insightsData.totalRevShipping / Math.max(insightsData.totalRTO + insightsData.totalRVP, 1))}
                  </div>
                </div>

                <div className="ins-panel">
                  <div className="ins-panel-hdr">
                    <div>
                      <div className="ins-panel-title">Flipkart Margin Distribution</div>
                      <div className="ins-panel-sub">Net margin % per SKU after Flipkart fees</div>
                    </div>
                  </div>
                  <div className="ins-margin-dist">
                    {insightsData.marginBrackets.map((b, i) => {
                      const pct = (b.count / (report.total_skus || 1)) * 100
                      return (
                        <div key={i} className="ins-md-row">
                          <div className="ins-md-label">{b.label}</div>
                          <div className="ins-md-bar-wrap"><div className="ins-md-bar" style={{ width: `${pct}%`, background: b.color }} /></div>
                          <div className="ins-md-count">{b.count} SKUs</div>
                          <div className="ins-md-pct">{pct.toFixed(0)}%</div>
                        </div>
                      )
                    })}
                  </div>
                  <div className="ins-margin-note">
                    ⚠ Flipkart Margin = after Flipkart fees only. Add your purchase cost for true business margin.
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

    </div>
  )
}
