import { useState, useEffect } from 'react'
import api from '../../../api/client'

const TIER_STYLE = {
  CRITICAL: { color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
  RED:      { color: '#f97316', bg: 'rgba(249,115,22,0.12)' },
  AMBER:    { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  GREEN:    { color: '#22c55e', bg: 'rgba(34,197,94,0.12)'  },
}

export default function StateRiskTab() {
  const [states,  setStates]  = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get('/fraud/states')
      .then(r => setStates(r.data.states || []))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="fd-loading">Loading state risk intelligence…</div>

  const maxRate = Math.max(...states.map(s => s.fraud_rate || 0), 0.01)

  return (
    <div className="state-tab">
      <div className="fd-section-title">Geographic Fraud Intelligence</div>
      <p className="actor-subtitle">
        State-level fraud heatmap from Snapdeal Customer State data.
        Z-score shows deviation from national fraud rate average.
      </p>

      {states.length === 0 && (
        <div className="fd-empty" style={{ padding: '48px', textAlign: 'center', color: '#6b7280' }}>
          No state data yet. Upload a Snapdeal report to populate geographic intelligence.
        </div>
      )}

      {states.length > 0 && (
        <>
          <div className="state-heat-grid">
            {states.map(s => {
              const tier = TIER_STYLE[s.risk_tier] || TIER_STYLE.GREEN
              const pct  = (s.fraud_rate || 0) / maxRate
              return (
                <div key={s.state_code} className="state-heat-row">
                  <div className="state-heat-name">{s.state_name}</div>
                  <div className="state-heat-bar-wrap">
                    <div
                      className="state-heat-bar"
                      style={{ width: `${pct * 200}px`, background: tier.color }}
                    />
                  </div>
                  <div className="state-heat-meta">
                    <span style={{ color: tier.color, fontWeight: 700 }}>
                      {s.fraud_rate != null ? (s.fraud_rate * 100).toFixed(1) + '%' : '—'}
                    </span>
                    <span style={{ color: '#6b7280', fontSize: '0.74rem', marginLeft: '8px' }}>
                      z={s.z_score != null ? s.z_score.toFixed(2) : '—'}
                    </span>
                    <span className="fd-badge" style={{ color: tier.color, background: tier.bg, marginLeft: '8px' }}>
                      {s.risk_tier}
                    </span>
                  </div>
                  <div className="state-heat-orders" style={{ color: '#9ca3af', fontSize: '0.76rem' }}>
                    {s.fraud_orders}/{s.total_orders}
                  </div>
                </div>
              )
            })}
          </div>

          <div className="fd-table-wrap" style={{ marginTop: '24px' }}>
            <table className="fd-table">
              <thead>
                <tr>
                  <th className="fd-th">State</th>
                  <th className="fd-th fd-num">Total</th>
                  <th className="fd-th fd-num">Fraud</th>
                  <th className="fd-th fd-num">Fraud Rate</th>
                  <th className="fd-th fd-num">Avg Vel (days)</th>
                  <th className="fd-th fd-num">Z-Score</th>
                  <th className="fd-th">Tier</th>
                </tr>
              </thead>
              <tbody>
                {states.map(s => {
                  const tier = TIER_STYLE[s.risk_tier] || TIER_STYLE.GREEN
                  return (
                    <tr key={s.state_code} className="fd-tr">
                      <td className="fd-td">{s.state_name}</td>
                      <td className="fd-td fd-num">{s.total_orders}</td>
                      <td className="fd-td fd-num">{s.fraud_orders}</td>
                      <td className="fd-td fd-num" style={{ fontWeight: 700 }}>
                        {s.fraud_rate != null ? (s.fraud_rate * 100).toFixed(1) + '%' : '—'}
                      </td>
                      <td className="fd-td fd-num">
                        {s.avg_velocity != null ? s.avg_velocity.toFixed(1) : '—'}
                      </td>
                      <td className="fd-td fd-num">{s.z_score != null ? s.z_score.toFixed(2) : '—'}</td>
                      <td className="fd-td">
                        <span className="fd-badge" style={{ color: tier.color, background: tier.bg }}>
                          {s.risk_tier}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
