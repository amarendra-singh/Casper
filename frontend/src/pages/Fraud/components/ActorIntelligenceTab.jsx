import { useState, useEffect } from 'react'
import api from '../../../api/client'

const TIER_STYLE = {
  CRITICAL: { color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
  RED:      { color: '#f97316', bg: 'rgba(249,115,22,0.12)' },
  AMBER:    { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  GREEN:    { color: '#22c55e', bg: 'rgba(34,197,94,0.12)'  },
}

const SIGNAL_LABEL = {
  FRAUD_SIGNAL: { label: 'Fraud Signal', color: '#ef4444' },
  QUALITY:      { label: 'Quality',      color: '#f59e0b' },
  PREFERENCE:   { label: 'Preference',   color: '#3b82f6' },
  LOGISTICS:    { label: 'Logistics',    color: '#8b5cf6' },
  UNKNOWN:      { label: 'Unknown',      color: '#6b7280' },
}

export default function ActorIntelligenceTab() {
  const [overview, setOverview] = useState(null)
  const [actors,   setActors]   = useState([])
  const [loading,  setLoading]  = useState(true)
  const [sort,     setSort]     = useState('actor_fraud_score')
  const [desc,     setDesc]     = useState(true)
  const [filter,   setFilter]   = useState('')

  useEffect(() => {
    Promise.all([
      api.get('/fraud/actor-overview'),
      api.get('/fraud/actors'),
    ]).then(([ov, ac]) => {
      setOverview(ov.data)
      setActors(ac.data.actors || [])
    }).catch(console.error).finally(() => setLoading(false))
  }, [])

  const toggle = key => {
    if (sort === key) setDesc(d => !d)
    else { setSort(key); setDesc(true) }
  }

  const visible = [...actors]
    .filter(a => !filter ||
      (a.state_name || '').toLowerCase().includes(filter.toLowerCase()) ||
      (a.dominant_reason || '').toLowerCase().includes(filter.toLowerCase())
    )
    .sort((a, b) => {
      const av = a[sort] ?? -999
      const bv = b[sort] ?? -999
      return desc ? bv - av : av - bv
    })

  if (loading) return <div className="fd-loading">Loading actor intelligence…</div>

  return (
    <div className="actor-tab">
      {overview && (
        <div className="actor-kpis">
          <div className="actor-kpi">
            <span className="actor-kpi-val">{overview.total_actor_patterns ?? '—'}</span>
            <span className="actor-kpi-label">Actor Patterns</span>
          </div>
          <div className="actor-kpi actor-kpi--danger">
            <span className="actor-kpi-val">{overview.high_risk_actor_count ?? '—'}</span>
            <span className="actor-kpi-label">High Risk</span>
          </div>
          <div className="actor-kpi">
            <span className="actor-kpi-val">{overview.top_fraud_state ?? '—'}</span>
            <span className="actor-kpi-label">Top Fraud State</span>
          </div>
          <div className="actor-kpi">
            <span className="actor-kpi-val" style={{ fontSize: '0.85rem' }}>
              {overview.dominant_fraud_reason
                ? overview.dominant_fraud_reason.replace(/_/g, ' ')
                : '—'}
            </span>
            <span className="actor-kpi-label">Top Fraud Reason</span>
          </div>
        </div>
      )}

      <div className="fd-section-title">Actor Risk Profiles</div>
      <p className="actor-subtitle">
        Each row = a behavioural actor fingerprint (state × return reason). Fraud is committed by actors, not SKUs.
      </p>

      <input
        className="fd-search"
        placeholder="Search state or reason…"
        value={filter}
        onChange={e => setFilter(e.target.value)}
        style={{ marginBottom: '12px', width: '280px' }}
      />

      <div className="fd-table-wrap">
        <table className="fd-table">
          <thead>
            <tr>
              {[
                ['state_name',        'State'],
                [null,                'Return Reason'],
                [null,                'Signal Type'],
                ['total_orders',      'Orders'],
                ['return_count',      'Returns'],
                ['fraud_reason_count','Fraud Cnt'],
                ['avg_velocity_days', 'Avg Vel (days)'],
                ['actor_fraud_score', 'Fraud Score'],
                [null,                'Tier'],
              ].map(([key, label]) => (
                <th
                  key={label}
                  className={`fd-th ${key ? 'sortable' : ''} ${sort === key ? 'active' : ''}`}
                  onClick={() => key && toggle(key)}
                >
                  {label}{sort === key ? (desc ? ' ↓' : ' ↑') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={9} style={{ textAlign: 'center', padding: '32px', color: '#6b7280' }}>
                  No actor data yet. Upload a Flipkart Orders file via Settings → Upload to populate actor intelligence.
                </td>
              </tr>
            )}
            {visible.map(a => {
              const tier = TIER_STYLE[a.risk_tier] || TIER_STYLE.GREEN
              const sig  = SIGNAL_LABEL[a.fraud_signal_type] || SIGNAL_LABEL.UNKNOWN
              const returnRate = a.total_orders > 0
                ? ((a.return_count / a.total_orders) * 100).toFixed(0) + '%'
                : '—'
              return (
                <tr key={a.actor_key} className="fd-tr">
                  <td className="fd-td">{a.state_name || '—'}</td>
                  <td className="fd-td" style={{ maxWidth: '180px', fontSize: '0.78rem' }}>
                    {(a.dominant_reason || '—').replace(/_/g, ' ')}
                  </td>
                  <td className="fd-td">
                    <span className="fd-badge" style={{ color: sig.color, background: sig.color + '20', fontWeight: 600 }}>
                      {sig.label}
                    </span>
                  </td>
                  <td className="fd-td fd-num">{a.total_orders}</td>
                  <td className="fd-td fd-num">
                    {a.return_count}{' '}
                    <span style={{ color: '#9ca3af', fontSize: '0.75rem' }}>({returnRate})</span>
                  </td>
                  <td className="fd-td fd-num">{a.fraud_reason_count}</td>
                  <td className="fd-td fd-num">
                    {a.avg_velocity_days != null ? a.avg_velocity_days.toFixed(1) : '—'}
                  </td>
                  <td className="fd-td fd-num" style={{ fontWeight: 700 }}>
                    <span style={{
                      color: a.actor_fraud_score >= 50 ? '#ef4444'
                           : a.actor_fraud_score >= 30 ? '#f59e0b'
                           : '#22c55e'
                    }}>
                      {a.actor_fraud_score != null ? a.actor_fraud_score.toFixed(0) : '—'}
                    </span>
                  </td>
                  <td className="fd-td">
                    <span className="fd-badge" style={{ color: tier.color, background: tier.bg }}>
                      {a.risk_tier}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
