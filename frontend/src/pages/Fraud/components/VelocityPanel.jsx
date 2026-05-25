// Shows return velocity intelligence for SKUs on a given platform.
// Includes honest data-unlock notice when velocity data is unavailable.

export default function VelocityPanel({ skus, platform }) {
  const withVelocity = (skus || []).filter(s => s.avg_return_velocity_days != null)

  if (!withVelocity.length) {
    const msg = platform?.toLowerCase().includes('flipkart')
      ? 'Flipkart P&L exports do not include delivery or return-pickup dates. Upload a Shipment Report to unlock velocity intelligence.'
      : platform?.toLowerCase().includes('meesho')
      ? 'Meesho dispatch/payment dates parsed but return-pickup date not available — cannot compute true delivery→return velocity.'
      : 'No delivery→return-pickup date pairs found in this report. Velocity intelligence requires Snapdeal CPR format with del_date + RPU_date columns.'

    return (
      <div className="vel-empty">
        <div className="vel-lock-icon">🔒</div>
        <div className="vel-lock-title">Velocity Data Unavailable</div>
        <div className="vel-lock-body">{msg}</div>
      </div>
    )
  }

  const fraudSkus = withVelocity
    .filter(s => s.velocity_fraud_count > 0)
    .sort((a, b) => b.velocity_fraud_count - a.velocity_fraud_count)

  return (
    <div className="vel-root">
      <div className="vel-summary">
        <span className="vel-stat-val">{fraudSkus.length}</span>
        <span className="vel-stat-lbl">SKUs with rapid returns (≤3 days)</span>
      </div>

      {fraudSkus.length === 0 && (
        <div className="vel-clean">
          ✅ No rapid-return patterns across {withVelocity.length} tracked SKUs
        </div>
      )}

      {fraudSkus.map((s, i) => (
        <div key={i} className="vel-row">
          <div className="vel-sku-name">{s.sku_platform_name}</div>
          <div className="vel-bars">
            <div className="vel-bar-row">
              <span className="vel-bar-label">Avg velocity</span>
              <span className={`vel-bar-val ${s.avg_return_velocity_days <= 3 ? 'warn' : ''}`}>
                {s.avg_return_velocity_days?.toFixed(1)}d
              </span>
            </div>
            <div className="vel-bar-row">
              <span className="vel-bar-label">Rapid returns</span>
              <span className="vel-bar-val warn">{s.velocity_fraud_count}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
