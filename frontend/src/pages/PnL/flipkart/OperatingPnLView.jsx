import { useState } from 'react'
import { fmt, fmtN, fmtPct } from './utils'
import { useOperatingPnlData }    from './useOperatingPnlData'
import OperatingPnlPatternCards   from './OperatingPnlPatternCards'
import { updatePlatform }    from '../../../api/client'

/**
 * Operating P&L tab — full-business profitability including overhead absorption.
 *
 * Answers: "Did the business actually make money this month, after ALL costs?"
 *
 *   Total Payout  = Flipkart Bank Settlement (cash received)
 *   Total Cost    = breakeven × units (incl. misc/rent/elec allocation)
 *   Net Profit    = Total Payout − Total Cost − Overhead Drag (un-recovered fixed cost)
 *   Net Margin %  = Net Profit / Total Cost × 100  (return on cost — same as Unit Economics)
 *
 * Overhead Drag = (target_units − delivered_units) × misc_per_unit  (only if positive)
 *   Surfaces the hidden loss from under-selling vs target volume.
 */
export default function OperatingPnLView({ report, onRefresh }) {
  const { rows, totals, killList, returnLeakage, dataGap } = useOperatingPnlData(report)

  const [skuFilter, setSkuFilter] = useState('all')
  const [skuSearch, setSkuSearch] = useState('')
  const [sortCol,   setSortCol]   = useState('true_profit')
  const [sortDir,   setSortDir]   = useState('asc')

  const profitCount = rows.filter(r => r.true_status === 'profit').length
  const lossCount   = rows.filter(r => r.true_status === 'loss').length

  const filteredRows = rows
    .filter(r => {
      if (skuFilter === 'profit') return r.true_status === 'profit'
      if (skuFilter === 'loss')   return r.true_status === 'loss'
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

  return (
    <div className="pnl-body pnl-body-full pnl-animate-in">

      {/* ── Verdict banner (red if losing, green if profiting) ─────────────── */}
      <VerdictBanner totals={totals} />

      {/* ── KPI strip ──────────────────────────────────────────────────────── */}
      <div className="pnl-summary-bar">
        <SumItem label="Total Payout" value={fmt(totals.payout)} valClass="gold" />
        <SumItem label="Total Cost"   value={fmt(totals.total_cost)} valClass="red" />
        <SumItem label="Total Cost (after GST)" value={fmt(totals.total_cost_gst)} valClass="muted" />
        <div className="pnl-sum-item">
          <div className="pnl-sum-label">Net Profit</div>
          <div className={`pnl-sum-val ${totals.net_profit >= 0 ? 'green' : 'red'}`}>
            {totals.net_profit >= 0 ? '+' : ''}{fmt(totals.net_profit)}
          </div>
        </div>
        <div className="pnl-sum-item">
          <div className="pnl-sum-label">Net Margin</div>
          <div className={`pnl-sum-val ${(totals.net_margin ?? 0) >= 0 ? 'green' : 'red'}`}>
            {totals.net_margin == null ? '—' : (totals.net_margin >= 0 ? '+' : '') + totals.net_margin.toFixed(1) + '%'}
          </div>
        </div>
        <div className="pnl-sum-item">
          <div className="pnl-sum-label">Net Margin (after GST)</div>
          <div className={`pnl-sum-val ${(totals.net_margin_gst ?? 0) >= 0 ? 'green' : 'red'}`}>
            {totals.net_margin_gst == null ? '—' : (totals.net_margin_gst >= 0 ? '+' : '') + totals.net_margin_gst.toFixed(1) + '%'}
          </div>
        </div>
        <div className="pnl-sum-divider"/>
        <div className="pnl-sum-item">
          <div className="pnl-sum-label">Overhead Drag</div>
          <div className="pnl-sum-val red">
            {totals.overhead_drag > 0 ? '-' + fmt(totals.overhead_drag) : fmt(0)}
          </div>
        </div>
        <div className="pnl-sum-item">
          <div className="pnl-sum-label">Final Profit</div>
          <div className={`pnl-sum-val ${totals.final_profit >= 0 ? 'green' : 'red'}`}>
            {totals.final_profit >= 0 ? '+' : ''}{fmt(totals.final_profit)}
          </div>
        </div>
        <div className="pnl-sum-item">
          <div className="pnl-sum-label">Final Margin</div>
          <div className={`pnl-sum-val ${(totals.final_margin ?? 0) >= 0 ? 'green' : 'red'}`}>
            {totals.final_margin == null ? '—' : (totals.final_margin >= 0 ? '+' : '') + totals.final_margin.toFixed(1) + '%'}
          </div>
        </div>
        <div className="pnl-sum-divider"/>
        <SumItem label="Total Units" value={fmtN(totals.total_units)} />
        <TargetUnitsEditor
          platformId={report.platform_id}
          initial={totals.target_units}
          volumePct={totals.volume_pct}
          onSaved={onRefresh}
        />
        <div className="pnl-sum-divider"/>
        <SumItem label="Kill List" value={totals.kill_count} valClass={totals.kill_count > 0 ? 'red' : ''} />
        <SumItem label="Data Gap" value={totals.gap_count} valClass={totals.gap_count > 0 ? 'amber' : ''} />
      </div>

      {/* ── Pattern cards ──────────────────────────────────────────────────── */}
      <OperatingPnlPatternCards
        killList={killList}
        returnLeakage={returnLeakage}
        dataGap={dataGap}
        totals={totals}
      />

      {/* ── Table controls ─────────────────────────────────────────────────── */}
      <div className="pnl-tbl-controls">
        <input className="pnl-search" placeholder="Search SKU…" value={skuSearch}
          onChange={e => setSkuSearch(e.target.value)} />
        <div className="pnl-filter-pills">
          {[
            { key: 'all',    label: `All (${rows.length})` },
            { key: 'profit', label: `Profitable (${profitCount})` },
            { key: 'loss',   label: `Loss-making (${lossCount})` },
          ].map(f => (
            <button key={f.key}
              className={`pnl-fpill${skuFilter === f.key ? ' active' : ''}`}
              onClick={() => setSkuFilter(f.key)}>{f.label}</button>
          ))}
        </div>
        <span className="pnl-row-count">{filteredRows.length} SKUs</span>
      </div>

      {/* ── Per-SKU Operating P&L table ───────────────────────────────────── */}
      <div className="pnl-tbl-wrap">
        <table className="pnl-tbl">
          <thead>
            <tr>
              <th className="pnl-th sticky-col">SKU</th>
              <SortTh col="net_units"            label="Units Sold"           sub="after returns" sortCol={sortCol} sortDir={sortDir} onClick={toggleSort}/>
              <SortTh col="gross_units"          label="Gross Units"          sortCol={sortCol} sortDir={sortDir} onClick={toggleSort}/>
              <SortTh col="true_return_pct"      label="Return Rate"          sortCol={sortCol} sortDir={sortDir} onClick={toggleSort}/>
              <SortTh col="true_payout"          label="Net Payout"           sub="cash from Flipkart" sortCol={sortCol} sortDir={sortDir} onClick={toggleSort}/>
              <SortTh col="true_bs_per_u"        label="Net Payout / unit"    sortCol={sortCol} sortDir={sortDir} onClick={toggleSort}/>
              <SortTh col="casper_breakeven"     label="Breakeven"            sub="per unit · cost recovery" sortCol={sortCol} sortDir={sortDir} onClick={toggleSort}/>
              <SortTh col="casper_breakeven_gst" label="Breakeven (GST)"      sub="per unit · cost + GST" sortCol={sortCol} sortDir={sortDir} onClick={toggleSort}/>
              <SortTh col="true_profit_u"        label="Profit / unit"        sub="Payout − Breakeven" primary sortCol={sortCol} sortDir={sortDir} onClick={toggleSort}/>
              <SortTh col="true_total_cost"      label="Total Cost"           sub="Breakeven × Units" sortCol={sortCol} sortDir={sortDir} onClick={toggleSort}/>
              <SortTh col="true_profit"          label="Net Profit"           sub="Payout − Total Cost" primary sortCol={sortCol} sortDir={sortDir} onClick={toggleSort}/>
              <SortTh col="true_margin_pct"      label="Net Margin"           sub="Profit ÷ Total Cost" primary sortCol={sortCol} sortDir={sortDir} onClick={toggleSort}/>
              <th className="pnl-th center">Status</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map(row => <TrueRow key={row.id} row={row} />)}
            {filteredRows.length === 0 && (
              <tr><td colSpan={13} className="pnl-td center" style={{ padding: '32px', color: 'var(--text-3)' }}>
                No SKUs match your filter
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

    </div>
  )
}

// ── Sub-components ──────────────────────────────────────────────────────────

function VerdictBanner({ totals }) {
  if (totals.final_profit == null || totals.payout === 0) return null
  const losing = totals.final_profit < 0
  return (
    <div className={`pnl-verdict-banner ${losing ? 'losing' : 'winning'}`}>
      <span className="pnl-verdict-icon">{losing ? '🔴' : '🟢'}</span>
      <span>
        You received <strong>{fmt(totals.payout)}</strong> from Flipkart but spent{' '}
        <strong>{fmt(totals.total_cost)}</strong> on these products
        {totals.overhead_drag > 0 && <> and under-absorbed <strong>{fmt(totals.overhead_drag)}</strong> of fixed costs</>}.
        {' '}
        Final {losing ? 'loss' : 'profit'}:{' '}
        <strong>{losing ? '' : '+'}{fmt(totals.final_profit)}</strong>
        {totals.final_margin != null && <> ({totals.final_margin >= 0 ? '+' : ''}{totals.final_margin.toFixed(1)}%)</>}
      </span>
    </div>
  )
}

function TargetUnitsEditor({ platformId, initial, volumePct, onSaved }) {
  const [editing, setEditing] = useState(false)
  const [value,   setValue]   = useState(initial || 700)
  const [saving,  setSaving]  = useState(false)

  async function save() {
    setSaving(true)
    try {
      await updatePlatform(platformId, { target_monthly_units: Number(value) })
      setEditing(false)
      onSaved?.()
    } catch (e) { console.error(e) }
    setSaving(false)
  }

  return (
    <div className="pnl-sum-item" title="Click to edit your monthly volume target">
      <div className="pnl-sum-label">Target / Actual</div>
      {editing ? (
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <input type="number" value={value} onChange={e => setValue(e.target.value)}
            style={{ width: 60, fontSize: 12, padding: '2px 4px' }} />
          <button className="pnl-btn-ghost" style={{ fontSize: 10, padding: '2px 6px' }}
            onClick={save} disabled={saving}>{saving ? '…' : '✓'}</button>
          <button className="pnl-btn-ghost" style={{ fontSize: 10, padding: '2px 6px' }}
            onClick={() => setEditing(false)}>✕</button>
        </div>
      ) : (
        <div className="pnl-sum-val" style={{ cursor: 'pointer' }} onClick={() => setEditing(true)}>
          {initial || '—'}
          {volumePct != null && <span className={`pnl-sum-pct ${volumePct >= 100 ? 'green' : 'amber'}`}> ({volumePct.toFixed(0)}%)</span>}
        </div>
      )}
    </div>
  )
}

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

function TrueRow({ row }) {
  const isLoss = row.true_status === 'loss'
  const pU     = row.true_profit_u
  const p      = row.true_profit
  const m      = row.true_margin_pct

  return (
    <tr className={`pnl-tr${isLoss ? ' pnl-tr-loss' : ''}`}>
      <td className="pnl-td sku-col sticky-col">
        <span className="pnl-sku-name">{row.platform_sku_name}</span>
      </td>
      <td className="pnl-td center"><span className="pnl-units-net">{fmtN(row.net_units)}</span></td>
      <td className="pnl-td center muted">{fmtN(row.gross_units)}</td>
      <td className="pnl-td center">
        <span className={`pnl-ret-rate ${row.true_return_pct > 40 ? 'high' : row.true_return_pct > 20 ? 'mid' : 'low'}`}>
          {fmtPct(row.true_return_pct)}
        </span>
      </td>
      <td className="pnl-td right mono">{fmt(row.true_payout)}</td>
      <td className="pnl-td right mono">{fmt(row.true_bs_per_u, 1)}</td>
      <td className="pnl-td right mono muted">{fmt(row.casper_breakeven, 1)}</td>
      <td className="pnl-td right mono muted">{row.casper_breakeven_gst != null ? fmt(row.casper_breakeven_gst, 1) : '—'}</td>
      <td className={`pnl-td right mono pnl-td-primary variance ${pU >= 0 ? 'positive' : 'negative'}`}>
        {(pU >= 0 ? '+' : '') + fmt(pU, 1)}
      </td>
      <td className="pnl-td right mono red">{fmt(row.true_total_cost)}</td>
      <td className={`pnl-td right mono pnl-td-primary variance ${p >= 0 ? 'positive' : 'negative'}`}>
        {(p >= 0 ? '+' : '') + fmt(p)}
      </td>
      <td className="pnl-td center pnl-td-primary">
        {m == null ? '—' : (
          <span className={`pnl-ret-rate ${m > 0 ? 'low' : m > -10 ? 'mid' : 'high'}`}>
            {m >= 0 ? '+' : ''}{m.toFixed(1)}%
          </span>
        )}
      </td>
      <td className="pnl-td center">
        <span className={`pnl-status-badge status-${row.true_status}`}>
          {row.true_status === 'profit' ? '🟢' : '🔴'}
        </span>
      </td>
    </tr>
  )
}
