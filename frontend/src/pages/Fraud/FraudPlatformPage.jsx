import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import api from '../../api/client'
import CompositeScoreMeter from './components/CompositeScoreMeter'
import VelocityPanel       from './components/VelocityPanel'
import AlertsPanel         from './components/AlertsPanel'
import './FraudPlatformPage.css'

const TIER = {
  CRITICAL: { color: '#ef4444', bg: 'rgba(239,68,68,0.12)',  label: 'CRITICAL' },
  RED:      { color: '#f97316', bg: 'rgba(249,115,22,0.12)', label: 'HIGH'     },
  AMBER:    { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', label: 'AMBER'    },
  GREEN:    { color: '#22c55e', bg: 'rgba(34,197,94,0.12)',  label: 'SAFE'     },
}
const pct   = v => v != null ? `${(v * 100).toFixed(1)}%` : '—'
const money = v => v != null ? `₹${Math.round(v).toLocaleString('en-IN')}` : '—'

export default function FraudPlatformPage() {
  const { platformId } = useParams()
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  useEffect(() => {
    setLoading(true)
    api.get(`/fraud/platform/${platformId}`)
      .then(r => setData(r.data))
      .catch(e => setError(e.message || 'Failed to load'))
      .finally(() => setLoading(false))
  }, [platformId])

  if (loading) return <div className="fpp-loading"><div className="loader" /></div>
  if (error)   return <div className="fpp-error">{error}</div>
  if (!data)   return null

  const ts        = data.tier_summary || {}
  const totalSkus = Object.values(ts).reduce((a, b) => a + b, 0)

  return (
    <div className="fpp-root">
      <Link to="/fraud" className="fpp-back">← Back to Fraud Overview</Link>

      <div className="fpp-header">
        <div className="fpp-platform-avatar">
          {(data.platform_name || '?')[0].toUpperCase()}
        </div>
        <div className="fpp-header-info">
          <h1 className="fpp-title">{data.platform_name} — Fraud Intelligence</h1>
          <p className="fpp-subtitle">
            {totalSkus} SKUs scored · {data.alerts?.length || 0} active alerts
          </p>
        </div>
        <div className="fpp-tier-bar">
          {['CRITICAL','RED','AMBER','GREEN'].map(t => {
            const count = ts[t] || 0
            const w = totalSkus > 0 ? (count / totalSkus * 100).toFixed(1) : 0
            return (
              <div key={t} className="fpp-tier-seg"
                style={{ width: `${w}%`, background: TIER[t].color }}
                title={`${TIER[t].label}: ${count} (${w}%)`}
              >{w > 8 && <span>{count}</span>}</div>
            )
          })}
        </div>
      </div>

      <div className="fpp-body">
        <div className="fpp-col-alerts">
          <h2 className="fpp-section-title">Active Alerts</h2>
          <AlertsPanel alerts={data.alerts || []} compact />
        </div>

        <div className="fpp-col-skus">
          <h2 className="fpp-section-title">SKU Intelligence</h2>
          <div className="fpp-sku-scroll">
            <table className="fpp-table">
              <thead>
                <tr>
                  <th>Risk</th>
                  <th>SKU</th>
                  <th>Score</th>
                  <th>Loss%</th>
                  <th>Return%</th>
                  <th>RTO%</th>
                  <th>Vel.</th>
                  <th>Rev@Risk</th>
                </tr>
              </thead>
              <tbody>
                {(data.sku_risk_table || []).map((r, i) => {
                  const t = TIER[r.risk_tier] || TIER.GREEN
                  return (
                    <tr key={i} className={`fpp-row ${r.risk_tier?.toLowerCase()}`}>
                      <td>
                        <span className="fpp-badge" style={{ color: t.color, background: t.bg }}>
                          {t.label}
                        </span>
                      </td>
                      <td className="fpp-sku">{r.sku_platform_name}</td>
                      <td className="fpp-score">
                        <CompositeScoreMeter score={r.composite_fraud_score} compact />
                      </td>
                      <td className="fpp-num fpp-loss">{pct(r.combined_loss_rate)}</td>
                      <td className="fpp-num">{pct(r.return_rate)}</td>
                      <td className="fpp-num">{pct(r.rto_rate)}</td>
                      <td className="fpp-num">
                        {r.avg_return_velocity_days != null
                          ? <span className={r.avg_return_velocity_days <= 3 ? 'fpp-vel-warn' : ''}>
                              {r.avg_return_velocity_days}d
                            </span>
                          : '—'}
                      </td>
                      <td className="fpp-num">{money(r.revenue_at_risk)}</td>
                    </tr>
                  )
                })}
                {!data.sku_risk_table?.length && (
                  <tr><td colSpan={8} className="fpp-empty">No SKU data yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="fpp-col-velocity">
          <h2 className="fpp-section-title">Return Velocity</h2>
          <VelocityPanel skus={data.sku_risk_table || []} platform={data.platform_name} />
        </div>
      </div>
    </div>
  )
}
