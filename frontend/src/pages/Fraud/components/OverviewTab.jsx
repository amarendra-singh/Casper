import { Link } from 'react-router-dom'
import AlertsPanel from './AlertsPanel'

const VERDICT = {
  CLEAN:    { color: '#22c55e', bg: 'rgba(34,197,94,0.08)',  icon: '✅', label: 'All Clear' },
  MEDIUM:   { color: '#f59e0b', bg: 'rgba(245,158,11,0.08)', icon: '⚠️', label: 'Review Recommended' },
  HIGH:     { color: '#f97316', bg: 'rgba(249,115,22,0.08)', icon: '🔶', label: 'Action Required' },
  CRITICAL: { color: '#ef4444', bg: 'rgba(239,68,68,0.08)',  icon: '🚨', label: 'Immediate Attention' },
}

export default function OverviewTab({ overview, onResolve }) {
  if (!overview) return null
  const v = VERDICT[overview.verdict] || VERDICT.CLEAN

  return (
    <div className="fd-overview">
      {/* Verdict card */}
      <div className="fd-verdict-card" style={{ background: v.bg, borderColor: v.color }}>
        <div className="fd-verdict-icon">{v.icon}</div>
        <div>
          <div className="fd-verdict-label" style={{ color: v.color }}>{v.label}</div>
          <div className="fd-verdict-msg">{overview.verdict_msg}</div>
        </div>
        <div className="fd-verdict-counts">
          {overview.critical_count > 0 && (
            <span className="fd-vc-chip" style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444' }}>
              {overview.critical_count} Critical
            </span>
          )}
          {overview.high_count > 0 && (
            <span className="fd-vc-chip" style={{ background: 'rgba(249,115,22,0.15)', color: '#f97316' }}>
              {overview.high_count} High
            </span>
          )}
        </div>
      </div>

      {/* Platform health grid */}
      {overview.platform_health?.length > 0 && (
        <div className="fd-plat-health-grid">
          {overview.platform_health.map(p => {
            const score = p.health_score
            const scoreColor = score >= 80 ? '#22c55e' : score >= 60 ? '#f59e0b' : '#ef4444'
            return (
              <div key={p.platform_id} className="fd-plat-health-card">
                <div className="fd-plat-health-name">{p.platform_name}</div>
                <div className="fd-plat-health-score" style={{ color: scoreColor }}>
                  {score}<span style={{ fontSize: 11, color: 'var(--muted)' }}>/100</span>
                </div>
                <div className="fd-plat-health-sub">
                  {p.total_skus} SKUs · {p.alert_count} alert{p.alert_count !== 1 ? 's' : ''}
                  {p.critical_alerts > 0 && (
                    <span style={{ color: '#ef4444', marginLeft: 6 }}>
                      ⚠ {p.critical_alerts} critical
                    </span>
                  )}
                </div>
                <div className="fd-health-bar-track">
                  <div className="fd-health-bar-fill"
                    style={{ width: `${score}%`, background: scoreColor }} />
                </div>
                <Link to={`/fraud/platform/${p.platform_id}`} className="fd-plat-detail-link">
                  View Details →
                </Link>
              </div>
            )
          })}
        </div>
      )}

      {/* Top alerts */}
      <div className="fd-section-head">
        <h3>Active Alerts</h3>
        <span className="ct">{overview.total_alerts}</span>
      </div>
      <AlertsPanel alerts={overview.alerts} onResolve={onResolve} />

      {/* Data limitations notice */}
      <div className="fd-limitation-notice">
        <span className="fd-lim-icon">ℹ</span>
        <span>
          <strong>What this module detects:</strong> Settlement gaps, COD abuse patterns, abnormal return rates, cross-platform SKU risk.
          {' '}<strong>Coming when order data available:</strong> Customer-level fraud profiles, address blacklisting, serial returner detection.
        </span>
      </div>
    </div>
  )
}
