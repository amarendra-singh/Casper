import { useState } from 'react'
import { fmt, fmtN } from './utils'
import { Check, XMark } from './glyphs'
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
  const { totals, killList, returnLeakage, dataGap } = useOperatingPnlData(report)

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

      {/* Operating P&L is now a dashboard view — for per-SKU detail, see Profit & Loss tab */}
      <div className="pnl-ops-hint">
        Need per-SKU detail? See the <strong>Profit & Loss</strong> tab.
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
      <span className={`pnl-verdict-dot ${losing ? 'loss' : 'ok'}`} />
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
          <button className="pnl-btn-ghost" style={{ display: 'inline-flex', alignItems: 'center', padding: '3px 6px' }}
            onClick={save} disabled={saving} aria-label="Save target">{saving ? '…' : <Check s={13} />}</button>
          <button className="pnl-btn-ghost" style={{ display: 'inline-flex', alignItems: 'center', padding: '3px 6px' }}
            onClick={() => setEditing(false)} aria-label="Cancel">{<XMark s={13} />}</button>
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

