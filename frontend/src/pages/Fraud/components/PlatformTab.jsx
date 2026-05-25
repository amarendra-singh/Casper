import AlertsPanel from './AlertsPanel'

const PLAT_CFG = {
  flipkart: { color: '#2874F0', short: 'F' },
  amazon:   { color: '#FF9900', short: 'A' },
  meesho:   { color: '#F43397', short: 'M' },
  snapdeal: { color: '#E40046', short: 'S' },
  shopdeck: { color: '#6F6B62', short: 'D' },
  default:  { color: '#6F6B62', short: '?' },
}
const cfg = n => PLAT_CFG[n?.toLowerCase()] ?? PLAT_CFG.default

const pct   = v => v != null ? `${(v * 100).toFixed(1)}%` : '—'
const money = v => v != null ? `₹${Math.round(v).toLocaleString('en-IN')}` : '—'

const TIER = {
  CRITICAL: { color: '#ef4444', bg: 'rgba(239,68,68,0.12)',  label: 'CRITICAL' },
  RED:      { color: '#f97316', bg: 'rgba(249,115,22,0.12)', label: 'HIGH' },
  AMBER:    { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', label: 'AMBER' },
  GREEN:    { color: '#22c55e', bg: 'rgba(34,197,94,0.12)',  label: 'SAFE' },
}

export default function PlatformTab({ data, onResolve }) {
  if (!data) return <div className="fd-empty">Loading platform data…</div>
  if (data.error) return <div className="fd-error">{data.error}</div>

  const c        = cfg(data.platform_name)
  const ts       = data.tier_summary || {}
  const totalSkus = Object.values(ts).reduce((a, b) => a + b, 0)

  return (
    <div className="fd-plat-view">
      {/* Platform header */}
      <div className="fd-plat-header">
        <div className="fd-plat-avatar" style={{ background: c.color }}>
          {c.short}
        </div>
        <div>
          <div className="fd-plat-name">{data.platform_name}</div>
          <div className="fd-plat-meta">
            {totalSkus} SKUs scored · {data.total_alerts} alert{data.total_alerts !== 1 ? 's' : ''} · {data.cod_abuse_count} COD abuse
          </div>
        </div>
        <div className="fd-plat-rev-risk">
          <div className="fd-prr-val">{money(data.total_revenue_at_risk)}</div>
          <div className="fd-prr-lbl">revenue at risk</div>
        </div>
      </div>

      {/* Tier mini-bar */}
      <div className="fd-tier-mini-bar">
        {['CRITICAL', 'RED', 'AMBER', 'GREEN'].map(t => {
          const count = ts[t] || 0
          const w = totalSkus > 0 ? (count / totalSkus * 100).toFixed(1) : 0
          return (
            <div key={t} title={`${t}: ${count}`}
              style={{ width: `${w}%`, background: TIER[t]?.color, height: 6, borderRadius: 3 }} />
          )
        })}
      </div>

      {/* Alerts for this platform */}
      {data.alerts?.length > 0 && (
        <>
          <div className="fd-section-head">
            <h3>Alerts</h3>
            <span className="ct">{data.alerts.length}</span>
          </div>
          <AlertsPanel
            alerts={data.alerts.map(a => ({ ...a, platform_name: data.platform_name }))}
            onResolve={onResolve}
          />
        </>
      )}

      {/* SKU risk table */}
      <div className="fd-section-head" style={{ marginTop: 18 }}>
        <h3>SKU Risk</h3>
        <span className="ct">{data.sku_risk_table?.length || 0}</span>
      </div>
      <div className="fd-table-scroll">
        <table className="fd-table">
          <thead>
            <tr>
              <th className="fd-th">Risk</th>
              <th className="fd-th">SKU</th>
              <th className="fd-th">Loss%</th>
              <th className="fd-th">Return%</th>
              <th className="fd-th">RTO%</th>
              <th className="fd-th">Orders</th>
              <th className="fd-th">COD</th>
              <th className="fd-th">Rev@Risk</th>
            </tr>
          </thead>
          <tbody>
            {(data.sku_risk_table || []).map((r, i) => {
              const t = TIER[r.risk_tier] || TIER.GREEN
              return (
                <tr key={i} className={`fd-row ${r.risk_tier.toLowerCase()}`}>
                  <td>
                    <span className="fd-tier-badge" style={{ color: t.color, background: t.bg }}>
                      {t.label}
                    </span>
                  </td>
                  <td className="fd-sku-cell">{r.sku_platform_name}</td>
                  <td className="fd-num fd-loss">{pct(r.combined_loss_rate)}</td>
                  <td className="fd-num">{pct(r.return_rate)}</td>
                  <td className="fd-num">{pct(r.rto_rate)}</td>
                  <td className="fd-num">{r.gross_orders}</td>
                  <td className="fd-center">
                    {r.cod_abuse_flag ? <span className="fd-abuse-flag">⚠ COD</span> : '—'}
                  </td>
                  <td className="fd-num fd-risk-rev">{money(r.revenue_at_risk)}</td>
                </tr>
              )
            })}
            {!data.sku_risk_table?.length && (
              <tr>
                <td colSpan={8} className="fd-empty-row">
                  No risk data — upload a report for this platform
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
