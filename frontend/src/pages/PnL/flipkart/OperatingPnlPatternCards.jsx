import { fmt, fmtN, fmtPct } from './utils'
import { Ban, Warn, Search, TrendDown } from './glyphs'

/**
 * Four pattern-detection cards surfaced on the Operating P&L view:
 *   1. Kill List           — SKUs selling below cost
 *   2. Return Leakage      — SKUs with >30% return rate
 *   3. Data Gap            — FK SKUs not in Casper master (can't compute P&L)
 *   4. Volume Absorption   — fixed-cost recovery vs target
 */
export default function OperatingPnlPatternCards({ killList, returnLeakage, dataGap, totals }) {
  return (
    <div className="pnl-pattern-grid">

      {/* Kill List */}
      <Card
        icon={<Ban />}
        title="Kill List"
        subtitle="BS/unit < breakeven"
        count={killList.length}
        countClass="red"
        empty="All matched SKUs sell above cost — no hard losers."
        emptyGood
      >
        {killList.slice(0, 5).map(r => (
          <PatternRow key={r.id}
            name={r.platform_sku_name}
            meta={`${fmtN(r.net_units)}u · BS/u ${fmt(r.true_bs_per_u, 1)}`}
            right={<span className="pnl-pattern-val red">-{fmt(-r.true_profit_u, 1)}/u</span>}
          />
        ))}
        {killList.length > 5 && <div className="pnl-pattern-more">+ {killList.length - 5} more</div>}
      </Card>

      {/* Return Leakage */}
      <Card
        icon={<Warn />}
        title="Return Leakage"
        subtitle="Return rate > 30%"
        count={returnLeakage.length}
        countClass="amber"
        empty="No SKUs in high-return zone."
        emptyGood
      >
        {returnLeakage.slice(0, 5).map(r => (
          <PatternRow key={r.id}
            name={r.platform_sku_name}
            meta={`${fmtN(r.gross_units)} gross → ${fmtN(r.net_units)} net`}
            right={<span className="pnl-pattern-val amber">{fmtPct(r.true_return_pct)}</span>}
          />
        ))}
        {returnLeakage.length > 5 && <div className="pnl-pattern-more">+ {returnLeakage.length - 5} more</div>}
      </Card>

      {/* Data Gap */}
      <Card
        icon={<Search />}
        title="Data Gap"
        subtitle="Unmatched Flipkart SKUs"
        count={dataGap.length}
        countClass="amber"
        empty="All Flipkart SKUs matched to Casper master."
        emptyGood
      >
        {dataGap.slice(0, 5).map(r => (
          <PatternRow key={r.id}
            name={r.platform_sku_name}
            meta={`${fmtN(r.gross_units || 0)} gross · ${fmtN(r.net_units || 0)} net`}
            right={<span className="pnl-pattern-val muted">{fmt(r.bank_settlement_projected || 0)}</span>}
          />
        ))}
        {dataGap.length > 5 && <div className="pnl-pattern-more">+ {dataGap.length - 5} more</div>}
        {dataGap.length > 0 && (
          <div className="pnl-pattern-hint">Add these to SKUs → Pricing to include in Operating P&L.</div>
        )}
      </Card>

      {/* Volume Absorption */}
      <Card
        icon={<TrendDown />}
        title="Volume Absorption"
        subtitle="Fixed-cost recovery"
        badge={totals.target_units > 0 && totals.volume_pct != null ? `${totals.volume_pct.toFixed(0)}%` : null}
        badgeClass={totals.volume_pct != null && totals.volume_pct >= 100 ? 'green' : 'amber'}
      >
        <div className="pnl-absorp-stat">
          <span className="pnl-absorp-label">Target</span>
          <span className="pnl-absorp-val">{fmtN(totals.target_units)} units</span>
        </div>
        <div className="pnl-absorp-stat">
          <span className="pnl-absorp-label">Delivered</span>
          <span className="pnl-absorp-val">{fmtN(totals.net_units)} units</span>
        </div>
        <div className="pnl-absorp-stat">
          <span className="pnl-absorp-label">Misc / unit</span>
          <span className="pnl-absorp-val">{fmt(totals.misc_per_unit, 2)}</span>
        </div>
        <div className="pnl-absorp-stat">
          <span className="pnl-absorp-label">Overhead budget</span>
          <span className="pnl-absorp-val">{fmt(totals.target_absorp)}</span>
        </div>
        <div className="pnl-absorp-stat">
          <span className="pnl-absorp-label">Recovered</span>
          <span className="pnl-absorp-val green">{fmt(totals.actual_absorp)}</span>
        </div>
        <div className="pnl-absorp-stat strong">
          <span className="pnl-absorp-label">
            {totals.absorption_gap >= 0 ? 'Under-absorbed' : 'Over-absorbed'}
          </span>
          <span className={`pnl-absorp-val ${totals.absorption_gap > 0 ? 'red' : 'green'}`}>
            {totals.absorption_gap >= 0 ? '-' : '+'}{fmt(Math.abs(totals.absorption_gap))}
          </span>
        </div>
      </Card>

    </div>
  )
}

function Card({ icon, title, subtitle, count, countClass, badge, badgeClass, empty, emptyGood, children }) {
  const isEmpty = !children || (Array.isArray(children) && children.every(c => !c))
  const hasList = count != null
  return (
    <div className="pnl-pattern-card">
      <div className="pnl-pattern-head">
        <span className="pnl-pattern-icon">{icon}</span>
        <div className="pnl-pattern-titles">
          <div className="pnl-pattern-title">{title}</div>
          <div className="pnl-pattern-sub">{subtitle}</div>
        </div>
        {hasList && <span className={`pnl-pattern-count ${countClass || ''}`}>{count}</span>}
        {badge && <span className={`pnl-pattern-count ${badgeClass || ''}`}>{badge}</span>}
      </div>
      <div className="pnl-pattern-body">
        {hasList && count === 0
          ? <div className={`pnl-pattern-empty ${emptyGood ? 'good' : ''}`}>{empty}</div>
          : children}
      </div>
    </div>
  )
}

function PatternRow({ name, meta, right }) {
  return (
    <div className="pnl-pattern-row">
      <div className="pnl-pattern-row-left">
        <div className="pnl-pattern-row-name">{name}</div>
        <div className="pnl-pattern-row-meta">{meta}</div>
      </div>
      <div className="pnl-pattern-row-right">{right}</div>
    </div>
  )
}
