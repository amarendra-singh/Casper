import { useState, useEffect, useCallback } from 'react'
import api from '../../api/client'
import OverviewTab   from './components/OverviewTab'
import SettlementTab from './components/SettlementTab'
import './FraudDashboard.css'

// ── Config ────────────────────────────────────────────────────────────────────
const TIER = {
  CRITICAL: { color: '#ef4444', bg: 'rgba(239,68,68,0.12)',  label: 'CRITICAL' },
  RED:      { color: '#f97316', bg: 'rgba(249,115,22,0.12)', label: 'HIGH'     },
  AMBER:    { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', label: 'AMBER'    },
  GREEN:    { color: '#22c55e', bg: 'rgba(34,197,94,0.12)',  label: 'SAFE'     },
}
const pct   = v => v != null ? `${(v * 100).toFixed(1)}%` : '—'
const money = v => v != null ? `₹${Math.round(v).toLocaleString('en-IN')}` : '—'

// ── SKU Risk Table (consolidated all-platform view) ────────────────────────────
function SkuRiskTable({ rows }) {
  const [sort,       setSort]       = useState('z_score')
  const [desc,       setDesc]       = useState(true)
  const [filter,     setFilter]     = useState('')
  const [tierFilter, setTierFilter] = useState('ALL')

  const toggle = key => {
    if (sort === key) setDesc(d => !d)
    else { setSort(key); setDesc(true) }
  }

  const visible = [...rows]
    .filter(r => tierFilter === 'ALL' || r.risk_tier === tierFilter)
    .filter(r =>
      !filter ||
      r.sku_platform_name?.toLowerCase().includes(filter.toLowerCase()) ||
      r.platform_name?.toLowerCase().includes(filter.toLowerCase())
    )
    .sort((a, b) => {
      const av = a[sort] ?? -999
      const bv = b[sort] ?? -999
      return desc ? bv - av : av - bv
    })

  const SortTh = ({ k, label }) => (
    <th className={`fd-th sortable ${sort === k ? 'active' : ''}`} onClick={() => toggle(k)}>
      {label}{sort === k ? (desc ? ' ↓' : ' ↑') : ''}
    </th>
  )

  return (
    <div className="fd-table-wrap">
      <div className="fd-table-toolbar">
        <input
          className="fd-search"
          placeholder="Search SKU or platform…"
          value={filter}
          onChange={e => setFilter(e.target.value)}
        />
        <div className="fd-tier-pills">
          {['ALL', 'CRITICAL', 'RED', 'AMBER', 'GREEN'].map(t => (
            <button
              key={t}
              className={`fd-tier-pill ${tierFilter === t ? 'active' : ''}`}
              style={
                tierFilter === t && TIER[t]
                  ? { background: TIER[t].bg, color: TIER[t].color, borderColor: TIER[t].color }
                  : {}
              }
              onClick={() => setTierFilter(t)}
            >{t}</button>
          ))}
        </div>
        <span className="fd-count">{visible.length} SKUs</span>
      </div>
      <div className="fd-table-scroll">
        <table className="fd-table">
          <thead>
            <tr>
              <th className="fd-th">Risk</th>
              <SortTh k="composite_fraud_score" label="Score" />
              <th className="fd-th">SKU</th>
              <th className="fd-th">Platform</th>
              <SortTh k="z_score"            label="Z-Score" />
              <SortTh k="combined_loss_rate"  label="Loss%" />
              <SortTh k="return_rate"         label="Return%" />
              <SortTh k="rto_rate"            label="RTO%" />
              <SortTh k="gross_orders"        label="Orders" />
              <th className="fd-th">Prepaid</th>
              <th className="fd-th">Postpaid</th>
              <th className="fd-th">COD Abuse</th>
              <SortTh k="revenue_at_risk"     label="Rev@Risk" />
            </tr>
          </thead>
          <tbody>
            {visible.map((r, i) => {
              const t = TIER[r.risk_tier] || TIER.GREEN
              return (
                <tr key={i} className={`fd-row ${r.risk_tier?.toLowerCase()}`}>
                  <td>
                    <span className="fd-tier-badge" style={{ color: t.color, background: t.bg }}>
                      {t.label}
                    </span>
                  </td>
                  <td className="fd-num">
                    {r.composite_fraud_score != null
                      ? <span style={{
                          color: r.composite_fraud_score >= 70 ? '#ef4444'
                               : r.composite_fraud_score >= 40 ? '#f97316'
                               : r.composite_fraud_score >= 20 ? '#f59e0b'
                               : '#22c55e',
                          fontWeight: 700,
                          fontSize: 12
                        }}>
                          {r.composite_fraud_score.toFixed(1)}
                        </span>
                      : '—'}
                  </td>
                  <td className="fd-sku-cell">{r.sku_platform_name}</td>
                  <td className="fd-plat-cell">{r.platform_name}</td>
                  <td className="fd-num">{r.z_score?.toFixed(2) ?? '—'}</td>
                  <td className="fd-num fd-loss">{pct(r.combined_loss_rate)}</td>
                  <td className="fd-num">{pct(r.return_rate)}</td>
                  <td className="fd-num">{pct(r.rto_rate)}</td>
                  <td className="fd-num">{r.gross_orders}</td>
                  <td className="fd-num">{pct(r.prepaid_return_rate)}</td>
                  <td className="fd-num">{pct(r.postpaid_return_rate)}</td>
                  <td className="fd-center">
                    {r.cod_abuse_flag ? <span className="fd-abuse-flag">⚠ COD</span> : '—'}
                  </td>
                  <td className="fd-num fd-risk-rev">{money(r.revenue_at_risk)}</td>
                </tr>
              )
            })}
            {!visible.length && (
              <tr><td colSpan={13} className="fd-empty-row">No SKUs match filter</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Cross-platform comparison ──────────────────────────────────────────────────
function CrossPlatform({ data }) {
  if (!data?.length) {
    return (
      <div className="fd-empty">
        Upload reports from 2+ platforms to see cross-platform SKU comparison
      </div>
    )
  }
  return (
    <div className="fd-cross-list">
      {data.slice(0, 20).map((row, i) => (
        <div key={i} className="fd-cross-row">
          {row.platforms.map((p, j) => {
            const t = TIER[p.risk_tier] || TIER.GREEN
            return (
              <div key={j} className="fd-cross-plat-item">
                <span className="fd-tier-badge" style={{ color: t.color, background: t.bg }}>
                  {p.risk_tier}
                </span>
                <span className="fd-cross-plat-name">{p.platform_name}</span>
                <span className="fd-cross-plat-sku">{p.sku_platform_name}</span>
                <span className="fd-cross-rate">{pct(p.combined_loss_rate)}</span>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function FraudDashboard() {
  const [tab,        setTab]        = useState('overview')
  const [overview,   setOverview]   = useState(null)
  const [dashboard,  setDashboard]  = useState(null)
  const [settlement, setSettlement] = useState(null)
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState(null)

  // Load overview + dashboard on mount
  useEffect(() => {
    Promise.all([
      api.get('/fraud/overview'),
      api.get('/fraud/dashboard'),
    ])
      .then(([ov, db]) => {
        setOverview(ov.data)
        setDashboard(db.data)
      })
      .catch(e => setError(e.message || 'Failed to load'))
      .finally(() => setLoading(false))
  }, [])

  // Load settlement lazily
  useEffect(() => {
    if (tab === 'settlement' && !settlement) {
      api.get('/fraud/settlement')
        .then(r => setSettlement(r.data))
        .catch(() => setSettlement({ reports: [], total_gap: 0, gap_count: 0, note: '' }))
    }
  }, [tab, settlement])

  const handleResolve = useCallback(async alertId => {
    await api.patch(`/fraud/resolve/${alertId}`)
    api.get('/fraud/overview').then(r => setOverview(r.data))
  }, [])

  if (error)   return <div className="fd-error fd-root">{error}</div>
  if (loading) return <div className="fd-loading fd-root"><div className="loader" /></div>

  const ts        = dashboard?.tier_summary || {}
  const totalSkus = Object.values(ts).reduce((a, b) => a + b, 0)

  const TABS = [
    { key: 'overview',   label: 'Overview' },
    { key: 'sku',        label: 'SKU Risk Table' },
    { key: 'settlement', label: 'Settlement' },
    { key: 'cross',      label: 'Cross-Platform' },
  ]

  return (
    <div className="fd-root">
      {/* Header */}
      <div className="fd-header">
        <div className="fd-title-block">
          <h1 className="fd-title">Fraud Detection</h1>
          <p className="fd-subtitle">
            Return risk · Settlement integrity · COD abuse · Cross-platform signals
          </p>
        </div>
        <div className="fd-header-right">
          <span className="fd-live-chip">● Live</span>
          <span className="fd-sku-count">{totalSkus} SKUs scored</span>
          {overview?.critical_count > 0 && (
            <span className="fd-crit-badge">🚨 {overview.critical_count} Critical</span>
          )}
        </div>
      </div>

      {/* Tab nav */}
      <div className="fd-tabs">
        {TABS.map(t => (
          <button
            key={t.key}
            className={`fd-tab ${tab === t.key ? 'active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            {t.key === 'overview' && overview?.total_alerts > 0 && (
              <span className="fd-tab-badge">{overview.total_alerts}</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="fd-tab-content">

        {tab === 'overview' && (
          <OverviewTab overview={overview} onResolve={handleResolve} />
        )}

        {tab === 'sku' && dashboard && (
          <>
            {/* Tier distribution bar */}
            <div className="fd-tier-bar-wrap">
              {['CRITICAL', 'RED', 'AMBER', 'GREEN'].map(t => {
                const count = ts[t] || 0
                const w = totalSkus > 0 ? (count / totalSkus * 100).toFixed(1) : 0
                return (
                  <div
                    key={t}
                    className="fd-tier-bar-seg"
                    style={{ width: `${w}%`, background: TIER[t].color, opacity: 0.85 }}
                    title={`${TIER[t].label}: ${count} SKUs (${w}%)`}
                  >
                    {w > 6 && <span className="fd-tier-bar-lbl">{count}</span>}
                  </div>
                )
              })}
            </div>
            <SkuRiskTable rows={dashboard.sku_risk_table || []} />
          </>
        )}

        {tab === 'settlement' && <SettlementTab data={settlement} />}

        {tab === 'cross' && dashboard && (
          <CrossPlatform data={dashboard.cross_platform} />
        )}

      </div>
    </div>
  )
}
