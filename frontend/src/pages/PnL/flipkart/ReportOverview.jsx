import { fmt, fmtN } from './utils'
import { Box, Undo, XMark, Check, Cash, Card } from './glyphs'

/**
 * Report Overview tab — Revenue Flow, Unit Flow, SKU Summary.
 * Platform-aware: Snapdeal uses report-level totals (no sku_rows),
 * FK-specific fields null-checked throughout.
 */
export default function ReportOverview({ report, insightsData, onViewPnL, platform = 'flipkart' }) {
  const platformName = platform.charAt(0).toUpperCase() + platform.slice(1)
  const isSnapdeal   = platform.toLowerCase() === 'snapdeal'

  // For Snapdeal: fee totals come from report-level fields; for others: from sku_rows via insightsData
  const commissionAmt   = isSnapdeal
    ? Math.abs(report.commission_total || 0)
    : (insightsData?.totalCommission || 0)
  const taxAmt          = isSnapdeal
    ? Math.abs((report.tcs_amount || 0) + (report.tds_amount || 0))
    : (insightsData?.totalTax || 0)
  const courierAmt      = isSnapdeal ? Math.abs(report.courier_fee || 0) : 0
  const payCollAmt      = isSnapdeal ? Math.abs(report.payment_collection_fee || 0) : 0

  // Unit flow — Snapdeal uses order counts; others use unit counts from sku_rows
  const grossUnits   = isSnapdeal ? (report.gross_orders  || 0) : (report.gross_units  || 0)
  const netUnits     = isSnapdeal ? (report.net_orders    || 0) : (report.net_units    || 0)
  const rtoUnits     = isSnapdeal ? 0                           : (insightsData?.totalRTO      || 0)
  const rvpUnits     = isSnapdeal ? (report.return_orders || 0) : (insightsData?.totalRVP      || 0)
  const cancelledUnits = isSnapdeal ? 0                         : (insightsData?.totalCancelled || 0)
  const unitLabel    = isSnapdeal ? 'Orders' : 'Units'

  return (
    <div className="pnl-body pnl-animate-in">
      <div className="pnl-fk-report">

        <div className="pnl-fk-section-title">Revenue Flow</div>
        <div className="pnl-fk-panels">

          {/* Sales panel */}
          <div className="pnl-fk-panel">
            <div className="pnl-fk-panel-title">Sales</div>
            <div className="pnl-fk-rows">
              <div className="pnl-fk-row base"><span>Gross Sales</span><span>{fmt(report.gross_sales)}</span></div>
              <div className="pnl-fk-row cost"><span>Returns Deducted</span><span>−{fmt(Math.abs(report.returns_amount || 0))}</span></div>
              <div className="pnl-fk-row result"><span>Net Sales</span><span>{fmt(report.net_sales)}</span></div>
            </div>
          </div>

          {/* Fees panel — uses insightsData for FK/Meesho, report-level for Snapdeal */}
          <div className="pnl-fk-panel">
            <div className="pnl-fk-panel-title">{platformName} Fees</div>
            <div className="pnl-fk-rows">
              {[
                { label: 'Reverse Shipping',      value: insightsData?.totalRevShipping, neg: true  },
                { label: 'Commission',             value: commissionAmt,                  neg: true  },
                { label: 'Courier Fee',            value: courierAmt,                     neg: true  },
                { label: 'Payment Collection',     value: payCollAmt,                     neg: true  },
                { label: 'Collection / Shipping',  value: isSnapdeal ? null : insightsData?.totalCollection, neg: true },
                { label: 'GST on Fees',            value: isSnapdeal ? null : insightsData?.totalGST, neg: true },
                { label: 'TCS / TDS',              value: taxAmt,                         neg: true  },
                { label: 'Ads / Marketing',        value: isSnapdeal ? null : report.marketing_fee, neg: true },
                { label: 'Rewards / Benefits',     value: isSnapdeal ? null : insightsData?.totalRewards, neg: false },
                { label: 'Total Expenses',         value: report.total_expenses, neg: true, bold: true },
              ].filter(x => x.value != null && x.value !== 0).map((item, i) => (
                <div key={i} className={`pnl-fk-row ${item.bold ? 'result' : item.neg ? 'cost' : 'benefit'}`}>
                  <span>{item.label}</span>
                  <span>{item.neg ? '−' : '+'}{fmt(Math.abs(item.value))}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Settlement panel */}
          <div className="pnl-fk-panel">
            <div className="pnl-fk-panel-title">Settlement</div>
            <div className="pnl-fk-rows">
              <div className="pnl-fk-row base"><span>Net Earnings</span><span>{fmt(report.net_earnings)}</span></div>
              {report.input_tax_credits != null && (
                <div className="pnl-fk-row base"><span>Input Tax Credits</span><span>{fmt(report.input_tax_credits)}</span></div>
              )}
              <div className="pnl-fk-row result gold"><span>Bank Settlement</span><span>{fmt(report.bank_settlement)}</span></div>
              {isSnapdeal && report.opening_balance != null && (
                <div className="pnl-fk-row base"><span>Opening Balance</span><span>{fmt(report.opening_balance)}</span></div>
              )}
              {isSnapdeal && report.closing_balance != null && (
                <div className="pnl-fk-row cost"><span>Closing Balance</span><span>{fmt(report.closing_balance)}</span></div>
              )}
              {!isSnapdeal && report.amount_settled != null && (
                <div className="pnl-fk-row benefit"><span>Amount Settled</span><span>{fmt(report.amount_settled)}</span></div>
              )}
              {!isSnapdeal && (report.amount_pending || 0) !== 0 && (
                <div className="pnl-fk-row cost"><span>Amount Pending</span><span>{fmt(report.amount_pending)}</span></div>
              )}
              <div className="pnl-fk-row result">
                <span>{platformName} Margin</span>
                <span>{report.net_margin_pct == null ? '—' : Number(report.net_margin_pct).toFixed(1) + '%'}</span>
              </div>
            </div>
          </div>

        </div>

        {/* Order/Unit Flow */}
        <div className="pnl-fk-section-title" style={{ marginTop: 24 }}>{unitLabel} Flow</div>
        <div className="pnl-fk-units">
          {[
            { label: `Gross ${unitLabel}`,  value: grossUnits,    cls: 'base',   icon: <Box /> },
            !isSnapdeal && { label: 'RTO',  value: rtoUnits,      cls: 'cost',   icon: <Undo /> },
            { label: isSnapdeal ? 'Returns' : 'RVP', value: rvpUnits, cls: 'cost', icon: <Undo /> },
            !isSnapdeal && { label: 'Cancelled', value: cancelledUnits, cls: 'cost', icon: <XMark /> },
            isSnapdeal && report.cod_orders != null && { label: 'COD Orders',  value: report.cod_orders,  cls: 'base', icon: <Cash /> },
            isSnapdeal && report.ncod_orders != null && { label: 'NCOD Orders', value: report.ncod_orders, cls: 'base', icon: <Card /> },
            { label: `Net ${unitLabel}`,   value: netUnits,       cls: 'result', icon: <Check /> },
          ].filter(Boolean).map((item, i) => (
            <div key={i} className={`pnl-fk-unit-card pnl-fk-unit-${item.cls}`}>
              <div className="pnl-fku-icon">{item.icon}</div>
              <div className="pnl-fku-num">{fmtN(item.value)}</div>
              <div className="pnl-fku-label">{item.label}</div>
              <div className="pnl-fku-pct">{((item.value / (grossUnits || 1)) * 100).toFixed(1)}%</div>
            </div>
          ))}
        </div>

        {/* SKU Summary — hidden for Snapdeal (no per-SKU data) */}
        {!isSnapdeal && (
          <>
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
              <button className="pnl-fk-switch-btn" onClick={onViewPnL}>
                View Real P&amp;L → SKU Breakdown
              </button>
            </div>
          </>
        )}

        {/* Snapdeal notice — no per-SKU data */}
        {isSnapdeal && (
          <div className="pnl-fk-section-title" style={{ marginTop: 24, color: 'var(--text-muted)', fontSize: 13, fontStyle: 'italic' }}>
            Per-SKU breakdown not available in Snapdeal Payment Settlement Report
          </div>
        )}

      </div>
    </div>
  )
}
