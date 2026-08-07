import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { fmt, fmtN, fmtPct } from './utils'
import { getPnlRows, getUnmatchedSkus, addHiddenSkuPricing, getVendors, getCategories } from '../../../api/client'

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

/**
 * Hidden-SKU panel — the SKUs in this report that have no cost in the master, so
 * they are excluded from profit. Entering a price creates the pricing, registers
 * the upload's name as the platform alias, and re-matches this report in one call,
 * so the numbers move immediately instead of needing a re-upload.
 */
const BLANK_COSTS = {
  price: '', package: '', logistics: '', addons: '', misc_total: '',
  cr_percentage: '', cr_cost: '', damage_percentage: '', damage_cost: '',
  vendor_id: '', category_id: '',
}

// Same cost stack as the SKUs grid. Blank = fall back to the company default,
// which the backend resolves — so only Price is truly required.
const COST_FIELDS = [
  { key: 'package',           label: 'Package' },
  { key: 'logistics',         label: 'Inbound Logistics' },
  { key: 'addons',            label: 'Addons' },
  { key: 'misc_total',        label: 'Misc', hint: 'default' },
  { key: 'cr_percentage',     label: 'Return %', pairs: 'cr_cost' },
  { key: 'cr_cost',           label: 'Return ₹', pairs: 'cr_percentage' },
  { key: 'damage_percentage', label: 'Dmg %',    pairs: 'damage_cost' },
  { key: 'damage_cost',       label: 'Dmg ₹',    pairs: 'damage_percentage' },
]

function HiddenSkuPanel({ reportId, onClose, onMatched }) {
  const [items, setItems]   = useState(null)
  const [openSku, setOpen]  = useState(null)
  const [form, setForm]     = useState(BLANK_COSTS)
  const [vendors, setVendors] = useState([])
  const [categories, setCategories] = useState([])
  const [busy, setBusy]     = useState(false)
  const [err, setErr]       = useState('')

  useEffect(() => {
    getUnmatchedSkus(reportId).then(setItems).catch(() => setItems([]))
    getVendors().then(setVendors).catch(() => setVendors([]))
    // Asked for here so SKUs added this way arrive categorised — adding them
    // without a category is what left 71 of 72 SKUs uncategorised.
    getCategories().then(setCategories).catch(() => setCategories([]))
  }, [reportId])

  // % and ₹ are two ways to say the same thing — entering one clears its partner
  // so the backend never receives a contradictory pair.
  const setField = (key, value, pairs) =>
    setForm(f => ({ ...f, [key]: value, ...(pairs ? { [pairs]: '' } : {}) }))

  // Live preview of what this SKU will cost you per unit.
  const previewBreakeven = (() => {
    const n = k => parseFloat(form[k]) || 0
    const base = n('price') + n('package') + n('logistics') + n('addons') + n('misc_total')
    return base > 0 ? base + n('cr_cost') + n('damage_cost') : null
  })()

  const submit = async (name) => {
    if (!form.price || Number(form.price) <= 0) { setErr('Enter a price greater than 0'); return }
    setBusy(true); setErr('')
    try {
      const payload = { platform_sku_name: name, report_id: reportId }
      Object.entries(form).forEach(([k, v]) => { if (v !== '') payload[k] = v })
      const r = await addHiddenSkuPricing(payload)
      setItems(p => p.filter(x => x.platform_sku_name !== name))
      setOpen(null); setForm(BLANK_COSTS)
      onMatched(r)
    } catch (e) {
      setErr(e.response?.data?.detail || 'Could not add SKU')
    } finally { setBusy(false) }
  }

  return (
    <div className="hs-overlay" onClick={onClose}>
      <aside className="hs-panel" onClick={e => e.stopPropagation()}>
        <header className="hs-head">
          <div>
            <div className="hs-title">SKUs with no cost data</div>
            <div className="hs-sub">
              Their sales are excluded from profit until you add a cost. Biggest first.
            </div>
          </div>
          <button className="hs-close" onClick={onClose} aria-label="Close">×</button>
        </header>

        {items === null && <div className="hs-empty">Loading…</div>}
        {items?.length === 0 && <div className="hs-empty">Nothing hidden — every SKU has a cost.</div>}

        <div className="hs-list">
          {items?.map(u => (
            <div key={u.platform_sku_name} className="hs-item">
              <div className="hs-item-row">
                <span className="hs-name">{u.platform_sku_name}</span>
                <span className="hs-meta">{u.units} units · {fmt(u.payout)}</span>
                <button className="btn btn-ghost btn-sm"
                  onClick={() => { setOpen(openSku === u.platform_sku_name ? null : u.platform_sku_name); setForm(BLANK_COSTS); setErr('') }}>
                  {openSku === u.platform_sku_name ? 'Cancel' : 'Add cost'}
                </button>
              </div>
              {openSku === u.platform_sku_name && (
                <div className="hs-form">
                  <div className="hs-grid">
                    <label className="hs-f">Vendor
                      <select value={form.vendor_id} onChange={e => setField('vendor_id', e.target.value)}>
                        <option value="">— none —</option>
                        {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                      </select>
                    </label>
                    <label className="hs-f">Category
                      <select value={form.category_id} onChange={e => setField('category_id', e.target.value)}>
                        <option value="">— none —</option>
                        {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </label>
                    <label className="hs-f hs-f-req">Price ₹
                      <input type="number" min="0" step="0.01" autoFocus value={form.price}
                        placeholder="required"
                        onChange={e => setField('price', e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && submit(u.platform_sku_name)} />
                    </label>
                    {COST_FIELDS.map(f => (
                      <label key={f.key} className="hs-f">{f.label}
                        <input type="number" min="0" step="0.01" value={form[f.key]}
                          placeholder={f.hint || 'auto'}
                          onChange={e => setField(f.key, e.target.value, f.pairs)}
                          onKeyDown={e => e.key === 'Enter' && submit(u.platform_sku_name)} />
                      </label>
                    ))}
                  </div>

                  <div className="hs-actions">
                    <span className="hs-preview">
                      {previewBreakeven
                        ? <>Breakeven <strong>{fmt(previewBreakeven)}</strong> / unit</>
                        : 'Enter a price to see breakeven'}
                    </span>
                    <button className="btn btn-accent btn-sm" disabled={busy}
                      onClick={() => submit(u.platform_sku_name)}>
                      {busy ? 'Saving…' : 'Save & match'}
                    </button>
                  </div>
                  <p className="hs-hint">
                    Blank fields use your company defaults. Return and Damage each accept a %
                    <em>or</em> a ₹ amount — filling one clears the other.
                  </p>
                  {err && <p className="hs-err">{err}</p>}
                </div>
              )}
            </div>
          ))}
        </div>
      </aside>
    </div>
  )
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
  const [showHidden, setShowHidden] = useState(false)
  const [hiddenCount, setHiddenCount] = useState(report.unmatched_skus || 0)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let alive = true
    setLoading(true); setErr(null)
    getPnlRows(report.id)
      .then(d => { if (alive) { setData(d); setLoading(false) } })
      .catch(() => { if (alive) { setErr('Could not load P&L rows'); setLoading(false) } })
    return () => { alive = false }
  }, [report.id, reloadKey])

  // A SKU was costed and the report re-matched — pull the new numbers in.
  const onMatched = (r) => {
    setHiddenCount(r.remaining_hidden)
    setReloadKey(k => k + 1)
  }

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
        {hiddenCount > 0 && (
          <button className="pnl-sum-item pnl-sum-action" onClick={() => setShowHidden(true)}
            title="Add costs for these SKUs so they count towards profit">
            <div className="pnl-sum-label">No Pricing Data</div>
            <div className="pnl-sum-val amber">{hiddenCount} SKUs hidden <span className="pnl-sum-cta">Fix</span></div>
          </button>
        )}
      </div>

      {showHidden && (
        <HiddenSkuPanel reportId={report.id} onClose={() => setShowHidden(false)} onMatched={onMatched} />
      )}

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
