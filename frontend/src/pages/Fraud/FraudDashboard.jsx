import { useState, useEffect } from 'react'
import api from '../../api/client'
import './FraudDashboard.css'

// ── Tier config ───────────────────────────────────────────────────────────────
const TIER = {
  CRITICAL: { color: '#ef4444', bg: 'rgba(239,68,68,0.12)', label: 'CRITICAL' },
  RED:      { color: '#f97316', bg: 'rgba(249,115,22,0.12)', label: 'HIGH' },
  AMBER:    { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', label: 'AMBER' },
  GREEN:    { color: '#22c55e', bg: 'rgba(34,197,94,0.12)',  label: 'SAFE' },
}

const pct = v => v != null ? `${(v * 100).toFixed(1)}%` : '—'
const rs  = v => v != null ? v.toFixed(2) : '—'
const money = v => v != null ? `₹${Math.round(v).toLocaleString('en-IN')}` : '—'

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, accent }) {
  return (
    <div className="fd-stat-card" style={{ borderTopColor: accent }}>
      <div className="fd-stat-val" style={{ color: accent }}>{value}</div>
      <div className="fd-stat-lbl">{label}</div>
      {sub && <div className="fd-stat-sub">{sub}</div>}
    </div>
  )
}

// ── Tier badge ────────────────────────────────────────────────────────────────
function TierBadge({ tier }) {
  const t = TIER[tier] || TIER.GREEN
  return (
    <span className="fd-tier-badge" style={{ color: t.color, background: t.bg }}>
      {t.label}
    </span>
  )
}

// ── Weekly trend mini-chart ───────────────────────────────────────────────────
function WeeklyChart({ data }) {
  if (!data || data.length === 0) return <div className="fd-empty">No temporal data yet</div>

  const maxRate = Math.max(...data.map(d => d.loss_rate), 0.01)
  const avgRate = data.reduce((s, d) => s + d.loss_rate, 0) / data.length

  return (
    <div className="fd-weekly-chart">
      <div className="fd-weekly-bars">
        {data.map((d, i) => {
          const h = Math.round((d.loss_rate / maxRate) * 100)
          const isAnomaly = d.loss_rate > avgRate * 1.5
          return (
            <div key={i} className="fd-bar-col" title={`${d.week}\nLoss rate: ${(d.loss_rate*100).toFixed(1)}%\nShipped: ${d.shipped} | Losses: ${d.losses}`}>
              <div className="fd-bar-fill"
                style={{ height: `${h}%`, background: isAnomaly ? '#ef4444' : 'var(--gold)' }} />
              <div className="fd-bar-lbl">{d.week?.slice(-3)}</div>
            </div>
          )
        })}
      </div>
      <div className="fd-weekly-legend">
        <span className="fd-legend-dot" style={{ background:'var(--gold)' }} /> Normal
        <span className="fd-legend-dot" style={{ background:'#ef4444', marginLeft:12 }} /> Anomaly (&gt;1.5× avg)
        <span className="fd-weekly-avg">Platform avg: {(avgRate*100).toFixed(1)}%</span>
      </div>
    </div>
  )
}

// ── Cross-platform panel ──────────────────────────────────────────────────────
function CrossPlatform({ data }) {
  if (!data || data.length === 0) return <div className="fd-empty">Upload reports from 2+ platforms to see cross-platform comparison</div>
  return (
    <div className="fd-cross-list">
      {data.slice(0, 10).map((row, i) => (
        <div key={i} className="fd-cross-row">
          <div className="fd-cross-plats">
            {row.platforms.map((p, j) => (
              <div key={j} className="fd-cross-plat-item">
                <TierBadge tier={p.risk_tier} />
                <span className="fd-cross-plat-name">{p.platform_name}</span>
                <span className="fd-cross-plat-sku">{p.sku_platform_name}</span>
                <span className="fd-cross-rate">{pct(p.combined_loss_rate)}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── SKU Risk Table ────────────────────────────────────────────────────────────
const SORT_KEYS = ['z_score','combined_loss_rate','return_rate','rto_rate','gross_orders','revenue_at_risk']

function SkuRiskTable({ rows }) {
  const [sort, setSort]     = useState('z_score')
  const [desc, setDesc]     = useState(true)
  const [filter, setFilter] = useState('')
  const [tierFilter, setTierFilter] = useState('ALL')

  const toggle = key => {
    if (sort === key) setDesc(d => !d)
    else { setSort(key); setDesc(true) }
  }

  const visible = [...rows]
    .filter(r => tierFilter === 'ALL' || r.risk_tier === tierFilter)
    .filter(r => !filter || r.sku_platform_name.toLowerCase().includes(filter.toLowerCase()) || r.platform_name.toLowerCase().includes(filter.toLowerCase()))
    .sort((a, b) => {
      const av = a[sort] ?? -999, bv = b[sort] ?? -999
      return desc ? bv - av : av - bv
    })

  const SortTh = ({ k, label }) => (
    <th className={`fd-th sortable ${sort===k?'active':''}`} onClick={() => toggle(k)}>
      {label} {sort===k ? (desc?'↓':'↑') : ''}
    </th>
  )

  return (
    <div className="fd-table-wrap">
      <div className="fd-table-toolbar">
        <input className="fd-search" placeholder="Search SKU or platform…"
          value={filter} onChange={e => setFilter(e.target.value)} />
        <div className="fd-tier-pills">
          {['ALL','CRITICAL','RED','AMBER','GREEN'].map(t => (
            <button key={t} className={`fd-tier-pill ${tierFilter===t?'active':''}`}
              style={tierFilter===t && TIER[t] ? { background: TIER[t].bg, color: TIER[t].color, borderColor: TIER[t].color } : {}}
              onClick={() => setTierFilter(t)}>{t}</button>
          ))}
        </div>
        <span className="fd-count">{visible.length} SKUs</span>
      </div>

      <div className="fd-table-scroll">
        <table className="fd-table">
          <thead>
            <tr>
              <th className="fd-th">Risk</th>
              <th className="fd-th">SKU</th>
              <th className="fd-th">Platform</th>
              <SortTh k="z_score"           label="Z-Score" />
              <SortTh k="combined_loss_rate" label="Loss%" />
              <SortTh k="return_rate"        label="Return%" />
              <SortTh k="rto_rate"           label="RTO%" />
              <SortTh k="gross_orders"       label="Orders" />
              <th className="fd-th">Prepaid</th>
              <th className="fd-th">Postpaid</th>
              <th className="fd-th">COD Abuse</th>
              <SortTh k="revenue_at_risk"    label="Rev @ Risk" />
              <th className="fd-th">Pending</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r, i) => (
              <tr key={i} className={`fd-row ${r.risk_tier.toLowerCase()}`}>
                <td><TierBadge tier={r.risk_tier} /></td>
                <td className="fd-sku-cell" title={r.sku_platform_name}>{r.sku_platform_name}</td>
                <td className="fd-plat-cell">{r.platform_name}</td>
                <td className="fd-num">{rs(r.z_score)}</td>
                <td className="fd-num fd-loss">{pct(r.combined_loss_rate)}</td>
                <td className="fd-num">{pct(r.return_rate)}</td>
                <td className="fd-num">{pct(r.rto_rate)}</td>
                <td className="fd-num">{r.gross_orders}</td>
                <td className="fd-num">{pct(r.prepaid_return_rate)}</td>
                <td className="fd-num">{pct(r.postpaid_return_rate)}</td>
                <td className="fd-center">{r.cod_abuse_flag ? <span className="fd-abuse-flag">⚠ COD</span> : '—'}</td>
                <td className="fd-num fd-risk-rev">{money(r.revenue_at_risk)}</td>
                <td className="fd-num">{r.pending_return_orders || 0}</td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr><td colSpan={13} className="fd-empty-row">No SKUs match filter</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Main dashboard ────────────────────────────────────────────────────────────
export default function FraudDashboard() {
  const [data, setData]   = useState(null)
  const [error, setError] = useState(null)
  const [tab, setTab]     = useState('sku')

  useEffect(() => {
    api.get('/fraud/dashboard')
      .then(r => setData(r.data))
      .catch(e => setError(e.message || 'Failed to load'))
  }, [])

  if (error) return <div className="fd-error">{error}</div>
  if (!data)  return <div className="fd-loading"><div className="loader" /></div>

  const ts = data.tier_summary
  const totalRisky = (ts.CRITICAL || 0) + (ts.RED || 0)
  const totalSkus  = Object.values(ts).reduce((a,b)=>a+b,0)

  return (
    <div className="fd-root">
      <div className="fd-header">
        <div className="fd-title-block">
          <h1 className="fd-title">Fraud Detection</h1>
          <p className="fd-subtitle">Return risk & anomaly analysis across all platforms</p>
        </div>
        <div className="fd-last-updated">Live · {totalSkus} SKUs scored</div>
      </div>

      {/* KPI strip */}
      <div className="fd-stats-row">
        <StatCard
          label="Critical + High Risk SKUs"
          value={totalRisky}
          sub={`of ${totalSkus} total`}
          accent="#ef4444"
        />
        <StatCard
          label="Revenue at Risk"
          value={money(data.total_revenue_at_risk)}
          sub="from pending returns"
          accent="#f97316"
        />
        <StatCard
          label="Pending Returns"
          value={data.total_pending_returns}
          sub="orders not yet back"
          accent="#f59e0b"
        />
        <StatCard
          label="COD Abuse SKUs"
          value={data.cod_abuse_skus}
          sub="postpaid RR > prepaid by 20%+"
          accent="#a855f7"
        />
        <StatCard
          label="Platform Avg Loss"
          value={data.sku_risk_table.length > 0
            ? pct(data.sku_risk_table.reduce((s,r)=>s+(r.platform_avg_return_rate||0),0)/data.sku_risk_table.length)
            : '—'}
          sub="combined return + RTO rate"
          accent="var(--gold)"
        />
      </div>

      {/* Tier distribution bar */}
      <div className="fd-tier-bar-wrap">
        {['CRITICAL','RED','AMBER','GREEN'].map(t => {
          const count = ts[t] || 0
          const pctW  = totalSkus > 0 ? (count / totalSkus * 100).toFixed(1) : 0
          const cfg   = TIER[t]
          return (
            <div key={t} className="fd-tier-bar-seg"
              style={{ width: `${pctW}%`, background: cfg.color, opacity: 0.85 }}
              title={`${cfg.label}: ${count} SKUs (${pctW}%)`}>
              {pctW > 6 && <span className="fd-tier-bar-lbl">{count}</span>}
            </div>
          )
        })}
      </div>
      <div className="fd-tier-legend">
        {['CRITICAL','RED','AMBER','GREEN'].map(t => (
          <span key={t} className="fd-tier-leg-item">
            <span className="fd-legend-dot" style={{ background: TIER[t].color }} />
            {TIER[t].label} ({ts[t]||0})
          </span>
        ))}
      </div>

      {/* Tab nav */}
      <div className="fd-tabs">
        {[
          { key:'sku',     label:'SKU Risk Table' },
          { key:'temporal',label:'Weekly Trend' },
          { key:'cross',   label:'Cross-Platform' },
        ].map(t => (
          <button key={t.key} className={`fd-tab ${tab===t.key?'active':''}`}
            onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
      </div>

      {/* Tab content */}
      <div className="fd-tab-content">
        {tab === 'sku'      && <SkuRiskTable rows={data.sku_risk_table} />}
        {tab === 'temporal' && <WeeklyChart  data={data.weekly_loss_trend} />}
        {tab === 'cross'    && <CrossPlatform data={data.cross_platform} />}
      </div>
    </div>
  )
}
