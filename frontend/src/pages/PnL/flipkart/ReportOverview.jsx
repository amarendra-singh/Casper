import { fmt, fmtN } from './utils'

/**
 * Report Overview tab — Revenue Flow, Unit Flow, SKU Summary.
 * Platform-aware: fee rows filter to non-null/non-zero only,
 * Settlement rows null-check FK-specific fields (ITC, amount_settled, amount_pending).
 */
export default function ReportOverview({ report, insightsData, onViewPnL, platform = 'flipkart' }) {
  const platformName = platform.charAt(0).toUpperCase() + platform.slice(1)

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

          {/* Fees panel — shows only rows with a non-zero value */}
          <div className="pnl-fk-panel">
            <div className="pnl-fk-panel-title">{platformName} Fees</div>
            <div className="pnl-fk-rows">
              {insightsData && [
                { label: 'Reverse Shipping',   value: insightsData.totalRevShipping, neg: true  },
                { label: 'Commission',         value: insightsData.totalCommission,  neg: true  },
                { label: 'Collection / Shipping', value: insightsData.totalCollection, neg: true },
                { label: 'GST on Fees',        value: insightsData.totalGST,         neg: true  },
                { label: 'TCS / TDS',          value: insightsData.totalTax,         neg: true  },
                { label: 'Ads / Marketing',    value: report.marketing_fee,          neg: true  },
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

          {/* Settlement panel — null-checks FK-only fields */}
          <div className="pnl-fk-panel">
            <div className="pnl-fk-panel-title">Settlement</div>
            <div className="pnl-fk-rows">
              <div className="pnl-fk-row base"><span>Net Earnings</span><span>{fmt(report.net_earnings)}</span></div>
              {report.input_tax_credits != null && (
                <div className="pnl-fk-row base"><span>Input Tax Credits</span><span>{fmt(report.input_tax_credits)}</span></div>
              )}
              <div className="pnl-fk-row result gold"><span>Bank Settlement</span><span>{fmt(report.bank_settlement)}</span></div>
              {report.amount_settled != null && (
                <div className="pnl-fk-row benefit"><span>Amount Settled</span><span>{fmt(report.amount_settled)}</span></div>
              )}
              {(report.amount_pending || 0) !== 0 && (
                <div className="pnl-fk-row cost"><span>Amount Pending</span><span>{fmt(report.amount_pending)}</span></div>
              )}
              <div className="pnl-fk-row result">
                <span>{platformName} Margin</span>
                <span>{report.net_margin_pct == null ? '—' : Number(report.net_margin_pct).toFixed(1) + '%'}</span>
              </div>
            </div>
          </div>

        </div>

        {/* Unit Flow */}
        <div className="pnl-fk-section-title" style={{ marginTop: 24 }}>Unit Flow</div>
        <div className="pnl-fk-units">
          {[
            { label: 'Gross Orders',  value: report.gross_units,                cls: 'base',   icon: '📦' },
            { label: 'RTO',           value: insightsData?.totalRTO || 0,       cls: 'cost',   icon: '↩' },
            { label: 'RVP',           value: insightsData?.totalRVP || 0,       cls: 'cost',   icon: '↩' },
            { label: 'Cancelled',     value: insightsData?.totalCancelled || 0, cls: 'cost',   icon: '✕' },
            { label: 'Net Delivered', value: report.net_units,                  cls: 'result', icon: '✓' },
          ].map((item, i) => (
            <div key={i} className={`pnl-fk-unit-card pnl-fk-unit-${item.cls}`}>
              <div className="pnl-fku-icon">{item.icon}</div>
              <div className="pnl-fku-num">{fmtN(item.value)}</div>
              <div className="pnl-fku-label">{item.label}</div>
              <div className="pnl-fku-pct">{((item.value / (report.gross_units || 1)) * 100).toFixed(1)}%</div>
            </div>
          ))}
        </div>

        {/* SKU Summary */}
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

      </div>
    </div>
  )
}
