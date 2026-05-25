const SEV = {
  CRITICAL: { color: '#ef4444', bg: 'rgba(239,68,68,0.1)',   icon: '🔴' },
  HIGH:     { color: '#f97316', bg: 'rgba(249,115,22,0.1)',  icon: '🟠' },
  MEDIUM:   { color: '#f59e0b', bg: 'rgba(245,158,11,0.1)', icon: '🟡' },
  LOW:      { color: '#22c55e', bg: 'rgba(34,197,94,0.1)',   icon: '🟢' },
}
const TYPE_LABEL = {
  SETTLEMENT_GAP:      'Settlement Gap',
  COD_ABUSE:           'COD Abuse',
  RETURN_SPIKE:        'Return Spike',
  FEE_OVERCHARGE:      'Fee Overcharge',
  CROSS_PLATFORM_RISK: 'Cross-Platform',
}
const money = v => v != null ? `₹${Math.abs(Math.round(v)).toLocaleString('en-IN')}` : null

export default function AlertsPanel({ alerts, onResolve, compact = false }) {
  if (!alerts?.length) {
    return (
      <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--muted)', fontSize: 13 }}>
        ✅ No active alerts — all platforms clean
      </div>
    )
  }

  return (
    <div className="fd-alerts-list">
      {alerts.map(a => {
        const s = SEV[a.severity] || SEV.LOW
        return (
          <div key={a.id} className="fd-alert-card" style={{ borderLeftColor: s.color }}>
            <div className="fd-alert-head">
              <span className="fd-alert-type-chip" style={{ background: s.bg, color: s.color }}>
                {s.icon} {a.severity}
              </span>
              <span className="fd-alert-type-label">
                {TYPE_LABEL[a.alert_type] || a.alert_type}
              </span>
              {a.platform_name && (
                <span className="fd-alert-plat">{a.platform_name}</span>
              )}
              {a.amount && (
                <span className="fd-alert-amount" style={{ color: s.color }}>
                  {money(a.amount)} at risk
                </span>
              )}
              {onResolve && (
                <button className="fd-resolve-btn" onClick={() => onResolve(a.id)}>
                  Resolve
                </button>
              )}
            </div>
            <div className="fd-alert-title">{a.title}</div>
            {!compact && <div className="fd-alert-body">{a.body}</div>}
          </div>
        )
      })}
    </div>
  )
}
