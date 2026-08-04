import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { fmt, fmtN, fmtPct } from './utils'
import { getPnlRows } from '../../../api/client'

/**
 * Profit & Loss tab — per-SKU actual-vs-target reconciliation.
 * ALL math comes from the backend engine (GET /pnl/rows/{id}) — single source of
 * truth. Every computed number carries a `calc` breakdown so hovering it shows the
 * exact formula + underlying values.
 */

function fmtOp(v, kind) {
  if (v == null) return ''
  return kind === 'n' ? fmtN(v) : fmt(v)
}
function fmtRes(calc) {
  if (calc.result == null) return '—'
  return calc.unit === 'pct'
    ? (calc.result >= 0 ? '+' : '') + calc.result.toFixed(1) + '%'
    : fmt(calc.result)
}

// Hover-to-explain cell. Fixed-position popover (the table scrolls, so an
// absolutely-positioned one would be clipped by the overflow container).
function Calc({ value, title, calc }) {
  const [pos, setPos] = useState(null)
  const ref = useRef(null)
  if (!calc) return value
  const show = () => { const r = ref.current?.getBoundingClientRect(); if (r) setPos({ x: r.left + r.width / 2, y: r.top }) }
  return (
    <span ref={ref} className="calc-cell" onMouseEnter={show} onMouseLeave={() => setPos(null)}>
      {value}
      {pos && (
        <span className="calc-pop" style={{ left: pos.x, top: pos.y }}>
          <span className="calc-pop-title">{title}</span>
          {calc.ops.map(([label, val, kind], i) => (
            <span key={i} className="calc-pop-row"><span className="cl">{label}</span><span className="cv">{fmtOp(val, kind)}</span></span>
          ))}
          <span className="calc-pop-row calc-pop-result"><span className="cl">Result</span><span className="cv">{fmtRes(calc)}</span></span>
        </span>
      )}
    </span>
  )
}

const CALC_TITLES = {
  return_rate_pct: 'Return Rate', casper_breakeven: 'Breakeven / unit',
  fees_per_unit: 'Platform Fee / unit', total_earned: 'Net Payout',
  fk_bs_per_unit: 'Payout / unit', profit_no_gst: 'Profit / unit',
  expected_total: 'Total Cost', total_true_profit: 'Net Profit',
  real_margin_pct: 'Net Margin', margin_gst_pct: 'Net Margin (after GST)',
}
// Wrap a cell's value with its backend calc breakdown (hover to explain).
function C({ row, k, children }) {
  return <Calc value={children} title={CALC_TITLES[k]} calc={row.calc?.[k]} />
}

export default function ProfitLossView({ report, platform = 'flipkart' }) {
  const platformName = platform.charAt(0).toUpperCase() + platform.slice(1)
  const navigate = useNavigate()
  const [data, setData]       = useState(null)   // { rows, summary }
  const [loading, setLoading] = useState(true)
  const [err, setErr]         = useState(null)
  const [skuFilter, setSkuFilter] = useState('all')
  const [skuSearch, setSkuSearch] = useState('')
  const [sortCol,   setSortCol]   = useState('total_true_profit')
  const [sortDir,   setSortDir]   = useState('asc')

  useEffect(() => {
    let alive = true
    setLoading(true); setErr(null)
    getPnlRows(report.id)
      .then(d => { if (alive) { setData(d); setLoading(false) } })
      .catch(() => { if (alive) { setErr('Could not load P&L rows'); setLoading(false) } })
    return () => { alive = false }
  }, [report.id])

  if (loading) return <div className="pnl-body"><div className="pnl-empty">Loading P&amp;L…</div></div>
  if (err || !data) return <div className="pnl-body"><div className="pnl-empty">{err || 'No data'}</div></div>

  const rows = data.rows
  const s = data.summary

  const filteredRows = rows
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

  const pct = v => v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(1) + '%'

  return (
    <div className="pnl-body pnl-body-full pnl-animate-in">

      {/* Summary bar (from backend) */}
      <div className="pnl-summary-bar">
        <SumItem label="Total Cost" valClass="muted" value={fmt(s.total_expected)} />
        <SumItem label="Total Payout" valClass="gold" value={fmt(s.total_actual)} />
        <div className="pnl-sum-item">
          <div className="pnl-sum-label">Net Profit</div>
          <div className={`pnl-sum-val ${(s.total_profit ?? 0) >= 0 ? 'green' : 'red'}`}>
            {(s.total_profit ?? 0) >= 0 ? '+' : ''}{fmt(s.total_profit)}
            {s.overall_var_pct != null && (
              <span className="pnl-sum-pct"> ({s.overall_var_pct >= 0 ? '+' : ''}{s.overall_var_pct.toFixed(1)}%)</span>
            )}
          </div>
        </div>
        <div className="pnl-sum-divider"/>
        <SumItem label="Avg Profit / unit" valClass={(s.avg_profit_per_unit ?? 0) >= 0 ? 'green' : 'red'}
          value={s.avg_profit_per_unit != null ? ((s.avg_profit_per_unit >= 0 ? '+' : '') + fmt(s.avg_profit_per_unit, 2)) : '—'} />
        <SumItem label="Net Margin" valClass={(s.weighted_margin_pct ?? 0) >= 0 ? 'green' : 'red'} value={pct(s.weighted_margin_pct)} />
        <SumItem label="Net Margin (after GST)" valClass={(s.weighted_margin_gst_pct ?? 0) >= 0 ? 'green' : 'red'} value={pct(s.weighted_margin_gst_pct)} />
        <div className="pnl-sum-divider"/>
        <SumItem label="Profitable" valClass="green" value={s.profitable} />
        <SumItem label="Loss-making" valClass="red"   value={s.loss_making} />
        <div className="pnl-sum-divider"/>
        <SumItem label="Total Units" value={fmtN(s.total_units)} />
        {report.unmatched_skus > 0 && (
          <SumItem label="No Pricing Data" valClass="amber" value={`${report.unmatched_skus} SKUs hidden`} />
        )}
      </div>

      {/* Controls */}
      <div className="pnl-tbl-controls">
        <input className="pnl-search" placeholder="Search SKU…" value={skuSearch}
          onChange={e => setSkuSearch(e.target.value)} />
        <div className="pnl-filter-pills">
          {[
            { key: 'all',    label: `All (${rows.length})` },
            { key: 'profit', label: `Profitable (${s.profitable})` },
            { key: 'loss',   label: `Loss-making (${s.loss_making})` },
          ].map(f => (
            <button key={f.key} className={`pnl-fpill${skuFilter === f.key ? ' active' : ''}`}
              onClick={() => setSkuFilter(f.key)}>{f.label}</button>
          ))}
        </div>
        <span className="pnl-row-count">Hover any number to see its formula · {filteredRows.length} SKUs</span>
      </div>

      {/* Table */}
      <div className="pnl-tbl-wrap">
        <table className="pnl-tbl pnl-tbl-grouped">
          <thead>
            <tr className="pnl-gh-row">
              <th className="pnl-gh pnl-gh-sku sticky-col">SKU</th>
              <th className="pnl-gh pnl-gh-actual"  colSpan={3}>Sold</th>
              <th className="pnl-gh pnl-gh-bs"      colSpan={3}>Target</th>
              <th className="pnl-gh pnl-gh-ue"      colSpan={3}>Actual ({platformName})</th>
              <th className="pnl-gh pnl-gh-recon"   colSpan={6}>Variance / Bottom Line</th>
            </tr>
            <tr>
              <th className="pnl-th sticky-col"></th>
              <SortTh col="gross_units"            label="Gross Units"     sortCol={sortCol} sortDir={sortDir} onClick={toggleSort}/>
              <SortTh col="net_units"              label="Units Sold"      sub="after returns" sortCol={sortCol} sortDir={sortDir} onClick={toggleSort}/>
              <SortTh col="return_rate_pct"        label="Return Rate"     sortCol={sortCol} sortDir={sortDir} onClick={toggleSort}/>
              <SortTh col="casper_breakeven"       label="Breakeven"       sub="per unit · from SKU master" sortCol={sortCol} sortDir={sortDir} onClick={toggleSort}/>
              <SortTh col="casper_target_pre_gst"  label="Target Pre-GST"  sortCol={sortCol} sortDir={sortDir} onClick={toggleSort}/>
              <SortTh col="casper_target_post_gst" label="Target Post-GST" sortCol={sortCol} sortDir={sortDir} onClick={toggleSort}/>
              <SortTh col="fees_per_unit"          label="Platform Fee/u"  sub="commission + tax" sortCol={sortCol} sortDir={sortDir} onClick={toggleSort}/>
              <SortTh col="total_earned"           label="Net Payout"      sub="settled by platform" sortCol={sortCol} sortDir={sortDir} onClick={toggleSort}/>
              <SortTh col="fk_bs_per_unit"         label="Payout / unit"   sortCol={sortCol} sortDir={sortDir} onClick={toggleSort}/>
              <SortTh col="profit_no_gst"          label="Profit / unit"   sub="Payout − Breakeven" primary sortCol={sortCol} sortDir={sortDir} onClick={toggleSort}/>
              <SortTh col="expected_total"         label="Total Cost"      sub="Breakeven × Units" sortCol={sortCol} sortDir={sortDir} onClick={toggleSort}/>
              <SortTh col="total_true_profit"      label="Net Profit"      sub="Payout − Cost" primary sortCol={sortCol} sortDir={sortDir} onClick={toggleSort}/>
              <SortTh col="real_margin_pct"        label="Net Margin"      sub="Profit ÷ Cost" primary sortCol={sortCol} sortDir={sortDir} onClick={toggleSort}/>
              <SortTh col="margin_gst_pct"         label="Net Margin (after GST)" sub="GST-anchored" primary sortCol={sortCol} sortDir={sortDir} onClick={toggleSort}/>
              <th className="pnl-th center pnl-th-primary">Status</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map(row => <PnLRow key={row.id} row={row} onJumpToSku={() => navigate(`/skus?sku=${encodeURIComponent(row.platform_sku_name)}`)} />)}
            {filteredRows.length === 0 && (
              <tr><td colSpan={16} className="pnl-td center" style={{ padding: '32px', color: 'var(--text-3)' }}>
                No SKUs match your filter
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── helpers ──────────────────────────────────────────────────────────────────

function SumItem({ label, value, valClass = '' }) {
  return (
    <div className="pnl-sum-item">
      <div className="pnl-sum-label">{label}</div>
      <div className={`pnl-sum-val ${valClass}`}>{value}</div>
    </div>
  )
}

function SortTh({ col, label, sub, primary, sortCol, sortDir, onClick }) {
  const icon = sortCol === col ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''
  return (
    <th className={`pnl-th sortable${primary ? ' pnl-th-primary' : ''}`} onClick={() => onClick(col)}>
      <span className="pnl-th-label">{label}</span>
      {sub && <span className="pnl-th-sub">{sub}</span>}
      {icon}
    </th>
  )
}

function PnLRow({ row, onJumpToSku }) {
  const profitNo = row.profit_no_gst
  const totalP   = row.total_true_profit
  const noCls    = profitNo == null ? '' : profitNo > 0 ? 'positive' : 'negative'
  const totalCls = totalP == null   ? '' : totalP > 0   ? 'positive' : 'negative'
  const isLoss   = profitNo != null && profitNo < 0
  const marginCls = v => v == null ? '' : v > 0 ? 'low' : v > -10 ? 'mid' : 'high'
  const marginTxt = v => (v >= 0 ? '+' : '') + v.toFixed(1) + '%'

  return (
    <tr className={`pnl-tr${isLoss ? ' pnl-tr-loss' : ''}`}>
      <td className="pnl-td sku-col sticky-col">
        <span className="pnl-sku-name">{row.platform_sku_name}</span>
        <button className="pnl-sku-link" title="View in SKUs page" aria-label="View in SKUs page" onClick={onJumpToSku}>
          <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 3H3.5A1.5 1.5 0 0 0 2 4.5v8A1.5 1.5 0 0 0 3.5 14h8A1.5 1.5 0 0 0 13 12.5V10"/><path d="M10 2h4v4"/><path d="M14 2 7 9"/>
          </svg>
        </button>
      </td>

      {/* Sold */}
      <td className="pnl-td center muted">{fmtN(row.gross_units)}</td>
      <td className="pnl-td center"><span className="pnl-units-net">{fmtN(row.net_units)}</span></td>
      <td className="pnl-td center">
        {row.return_rate_pct == null ? '—' : (
          <C row={row} k="return_rate_pct">
            <span className={`pnl-ret-rate ${row.return_rate_pct > 40 ? 'high' : row.return_rate_pct > 20 ? 'mid' : 'low'}`}>{fmtPct(row.return_rate_pct)}</span>
          </C>
        )}
      </td>

      {/* Target */}
      <td className="pnl-td right mono muted">
        {row.casper_breakeven == null ? '—' : <C row={row} k="casper_breakeven">{fmt(row.casper_breakeven, 1)}</C>}
      </td>
      <td className="pnl-td right mono muted">{row.casper_target_pre_gst != null ? fmt(row.casper_target_pre_gst, 0) : '—'}</td>
      <td className="pnl-td right mono muted">{row.casper_target_post_gst != null ? fmt(row.casper_target_post_gst, 0) : '—'}</td>

      {/* Actual */}
      <td className="pnl-td right mono red">
        {row.fees_per_unit == null ? '—' : <C row={row} k="fees_per_unit">{fmt(row.fees_per_unit, 1)}</C>}
      </td>
      <td className="pnl-td right mono">
        {row.total_earned == null ? '—' : <C row={row} k="total_earned">{fmt(row.total_earned)}</C>}
      </td>
      <td className="pnl-td right mono">
        {row.fk_bs_per_unit == null ? '—' : <C row={row} k="fk_bs_per_unit">{fmt(row.fk_bs_per_unit, 1)}</C>}
      </td>

      {/* Variance / Bottom Line */}
      <td className={`pnl-td right mono pnl-td-primary variance ${noCls}`}>
        {profitNo == null ? '—' : <C row={row} k="profit_no_gst">{(profitNo >= 0 ? '+' : '') + fmt(profitNo, 1)}</C>}
      </td>
      <td className="pnl-td right mono muted">
        {row.expected_total == null ? '—' : <C row={row} k="expected_total">{fmt(row.expected_total)}</C>}
      </td>
      <td className={`pnl-td right mono pnl-td-primary variance ${totalCls}`}>
        {totalP == null ? '—' : <C row={row} k="total_true_profit">{(totalP >= 0 ? '+' : '') + fmt(totalP)}</C>}
      </td>
      <td className="pnl-td center pnl-td-primary">
        {row.real_margin_pct == null ? '—' : (
          <C row={row} k="real_margin_pct">
            <span className={`pnl-ret-rate ${marginCls(row.real_margin_pct)}`}>{marginTxt(row.real_margin_pct)}</span>
          </C>
        )}
      </td>
      <td className="pnl-td center pnl-td-primary">
        {row.margin_gst_pct == null ? '—' : (
          <C row={row} k="margin_gst_pct">
            <span className={`pnl-ret-rate ${marginCls(row.margin_gst_pct)}`}>{marginTxt(row.margin_gst_pct)}</span>
          </C>
        )}
      </td>
      <td className="pnl-td center pnl-td-primary">
        <span className={`pnl-status-tag ${isLoss ? 'loss' : 'ok'}`}>
          <span className="pnl-status-dot" />{isLoss ? 'Loss' : 'OK'}
        </span>
      </td>
    </tr>
  )
}
