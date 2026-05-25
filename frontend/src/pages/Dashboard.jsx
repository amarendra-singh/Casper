import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts'
import { getSkus, getPlatforms, getMiscTotal, getSettings, getPnlDashboard } from '../api/client'
import { useAuth } from '../context/AuthContext'
import IndiaMapCard from '../components/IndiaMapCard'
import './Dashboard.css'

// ── Static display config (cosmetic only — revenue data comes from API) ──────
const TEAM = [
  { name: 'Ayesha Khan',  ini: 'AK', color: '#F59E0B', leads: 41, kpi: 0.84, w: 12, l: 29, rev: 24800, pct: 32.5 },
  { name: 'Rohan Mehta',  ini: 'RM', color: '#7A5BFF', leads: 54, kpi: 0.89, w: 21, l: 33, rev: 19200, pct: 25.1 },
  { name: 'Priya Sharma', ini: 'PS', color: '#EC2D6E', leads: 22, kpi: 0.79, w:  7, l: 15, rev:  8500, pct: 11.2 },
  { name: 'Vikram Singh', ini: 'VS', color: '#0E0E10', leads:  8, kpi: 0.62, w:  3, l:  5, rev:  5009, pct:  6.6 },
]

// Display config by platform name (lower-case key)
const PLAT_CONFIG = {
  flipkart: { short: 'F', color: '#2874F0', textColor: '#FFE500', italic: true  },
  snapdeal: { short: 'S', color: '#E40046', textColor: '#fff',    italic: false },
  meesho:   { short: 'm', color: '#F43397', textColor: '#fff',    italic: false },
  default:  { short: '?', color: '#0E0E10', textColor: '#fff',    italic: false },
}

const SALES_DYN = [
  { w: 'W3', a: 18, r: 14, p: 11 },
  { w: 'W4', a: 22, r: 16, p:  9 },
  { w: 'W5', a: 19, r: 18, p: 13 },
  { w: 'W6', a: 28, r: 20, p: 15 },
  { w: 'W7', a: 24, r: 17, p: 18 },
  { w: 'W8', a: 32, r: 22, p: 16 },
  { w: 'W9', a: 30, r: 25, p: 20 },
]

// ── Helpers ───────────────────────────────────────────────────────────────
function fmt(n)    { return n?.toLocaleString('en-IN') ?? '0' }
function fmtK(n)   { return `${Math.round(n / 1000)}k` }
function fmtRup(n) { return `₹${fmt(n)}` }
function hexToRgba(hex, a) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${a})`
}

function Av({ ini, color, size = 24 }) {
  return (
    <div style={{
      width: size, height: size, background: color, borderRadius: '50%',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: Math.floor(size * 0.36), fontWeight: 700, color: '#fff', flexShrink: 0,
      fontFamily: 'var(--font-ui)',
    }}>{ini}</div>
  )
}

function PlatAvatar({ plat, size = 26 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', background: plat.color,
      display: 'grid', placeItems: 'center', flexShrink: 0,
      color: plat.textColor, fontWeight: 700,
      fontSize: size * 0.5, fontStyle: plat.italic ? 'italic' : 'normal',
    }}>{plat.short}</div>
  )
}

function Delta({ pct, abs, dark }) {
  return (
    <>
      <span className={`dash-delta ${dark ? 'dash-delta-dark' : 'dash-delta-pink'}`}>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
          <path d="M5 2l4 6H1z"/>
        </svg>
        {pct}%
      </span>
      {abs && <span className="dash-delta dash-delta-dark">+₹{fmt(abs)}</span>}
    </>
  )
}

function ChartTip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: '#0E0E10', borderRadius: 10, padding: '8px 12px', fontSize: 11 }}>
      <div style={{ color: 'rgba(255,255,255,.4)', fontSize: 9, textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#fff', marginBottom: 2 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: p.color || p.stroke, display: 'inline-block' }} />
          <span style={{ fontWeight: 600, fontFamily: 'var(--font-mono)' }}>₹{fmt(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────
export default function Dashboard() {
  const { user }  = useAuth()
  const navigate  = useNavigate()
  const [api,       setApi]     = useState(null)
  const [dash,      setDash]    = useState(null)
  const [loading,   setLoading] = useState(true)
  const [selPlat,   setSelPlat] = useState(0)
  const [tab,       setTab]     = useState('Revenue')

  useEffect(() => {
    Promise.all([getSkus(), getPlatforms(), getMiscTotal(), getSettings(), getPnlDashboard()])
      .then(([skus, platforms, miscTotal, settings, dashboard]) => {
        setApi({ skus, platforms, miscTotal, settings })
        setDash(dashboard)
      })
      .finally(() => setLoading(false))
  }, [])

  if (loading) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'60vh' }}>
      <div className="loader" style={{ width:28, height:28 }} />
    </div>
  )

  const totalSkus  = api?.skus?.length ?? 0
  const activeSkus = api?.skus?.filter(s => s.is_active).length ?? 0

  // Build live PLATFORMS array from API data, merged with display config
  const PLATFORMS = (dash?.platforms ?? []).map(p => ({
    ...p,
    ...(PLAT_CONFIG[p.platform_name?.toLowerCase()] ?? PLAT_CONFIG.default),
    name: p.platform_name,
    rev:  p.bank_settlement,
  }))

  // Build live MONTHLY array for chart: group by month, one value per platform
  const MONTHLY = (() => {
    if (!dash?.monthly?.length) return []
    const months = [...new Set(dash.monthly.map(m => m.month))].sort()
    return months.map(month => {
      const row = { m: month.slice(5) } // "YYYY-MM" → "MM"
      dash.monthly.filter(m => m.month === month).forEach(m => {
        row[m.platform_name?.toLowerCase()] = m.bank_settlement
      })
      return row
    })
  })()

  const TOTAL_REV  = dash?.total_bank_settlement ?? 0
  const PREV_REV   = 0   // no prior-period data yet
  const REV_CHANGE = 0
  const REV_DIFF   = 0

  const sp = PLATFORMS[selPlat] ?? (PLAT_CONFIG.default)

  // KPI split
  const _rev  = Math.round(TOTAL_REV)
  const major = Math.floor(_rev / 1000)
  const minor = String(_rev % 1000).padStart(3, '0')

  return (
    <div className="dash">

      {/* ── SECTION 1: Collab header ── */}
      <div className="dash-collab-row">
        <div className="dash-collab-chips">
          <div className="dash-chip-circle">+</div>
          {TEAM.map((p, i) => (
            <div key={i} className="dash-collab-chip">
              <Av ini={p.ini} color={p.color} size={22} />
              {p.name.split(' ')[0]} {p.name.split(' ')[1][0]}.
            </div>
          ))}
          <div className="dash-chip-c">C</div>
        </div>
        <div className="dash-collab-actions">
          <button className="dash-ghost-btn" title="Adjust">
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M4 6h12M4 10h7M4 14h5"/><circle cx="15" cy="14" r="2"/></svg>
          </button>
          <button className="dash-ghost-btn" title="Download">
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M10 3v10M6 9l4 4 4-4M3 17h14"/></svg>
          </button>
          <button className="dash-ghost-btn" title="Share">
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><circle cx="15" cy="5" r="2"/><circle cx="5" cy="10" r="2"/><circle cx="15" cy="15" r="2"/><path d="M7 9l6-3M7 11l6 3"/></svg>
          </button>
        </div>
      </div>

      {/* ── SECTION 2: Timeframe ── */}
      <div className="dash-timeframe">
        <div className="dash-toggle-row">
          <div className="dash-switch" />
          <span className="dash-toggle-lbl">Timeframe</span>
        </div>
        <div className="dash-date-pill">
          Sep 1 – Nov 30, 2025
          <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M5 8l5 5 5-5"/></svg>
        </div>
      </div>

      {/* ── SECTION 3: Hero KPI + Stat cards ── */}
      <div className="dash-hero">
        {/* Left: KPI */}
        <div className="dash-kpi-col">
          <h1 className="dash-report-title">Shringar House</h1>
          <div className="dash-kpi-label">All Platforms Revenue</div>
          <div className="dash-kpi-amount">
            <span className="dash-kpi-num">
              ₹{major}<span className="dash-kpi-cents">,{minor}</span>
            </span>
            <Delta pct={REV_CHANGE} abs={REV_DIFF} />
          </div>
          <div className="dash-kpi-sub">
            vs prev. ₹{fmt(PREV_REV)}
            <span className="dash-kpi-dot" />
            Sep 1 – Nov 30, 2024
            <svg width="11" height="11" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M5 8l5 5 5-5"/></svg>
          </div>
        </div>

        {/* Right: Stat cards */}
        <div className="dash-stat-cards">
          {/* Top sales */}
          <div className="dash-stat">
            <div className="dash-stat-top">Top sales <span className="dash-stat-ic">
              <svg width="11" height="11" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M12 2l3.5 7 7 .5-5 5 1.5 7L12 18l-7 3.5 1.5-7-5-5 7-.5z"/></svg>
            </span></div>
            <div className="dash-stat-val">{TEAM[0].leads + TEAM[1].leads}</div>
            <div className="dash-stat-foot">
              <Av ini={TEAM[0].ini} color={TEAM[0].color} size={18} />
              {TEAM[0].name.split(' ')[0]}
              <span className="dash-stat-chev">›</span>
            </div>
          </div>

          {/* Best deal — dark */}
          <div className="dash-stat dash-stat-dark">
            <div className="dash-stat-top">Best deal <span className="dash-stat-ic">
              <svg width="11" height="11" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M12 2l3.5 7 7 .5-5 5 1.5 7L12 18l-7 3.5 1.5-7-5-5 7-.5z"/></svg>
            </span></div>
            <div className="dash-stat-val">₹12,400</div>
            <div className="dash-stat-foot">
              Flipkart
              <span className="dash-stat-chev">›</span>
            </div>
          </div>

          {/* SKUs */}
          <div className="dash-stat">
            <div className="dash-stat-top">SKUs</div>
            <div className="dash-stat-val" style={{ color:'#C9C6C2' }}>{totalSkus}</div>
            <div className="dash-stat-foot">
              <span className="dash-diamond" /> {activeSkus} active
            </div>
          </div>

          {/* Value — active (pink border) */}
          <div className="dash-stat dash-stat-active">
            <div className="dash-stat-top">Value</div>
            <div className="dash-stat-val" style={{ color:'var(--pink)' }}>₹{fmtK(TOTAL_REV)}</div>
            <div className="dash-stat-foot" style={{ color:'var(--pink)', fontWeight:600 }}>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="var(--pink)"><path d="M5 2l4 6H1z"/></svg>
              {REV_CHANGE}%
            </div>
          </div>

          {/* Win rate */}
          <div className="dash-stat">
            <div className="dash-stat-top">Win rate</div>
            <div className="dash-stat-val" style={{ color:'#C9C6C2' }}>
              {totalSkus > 0 ? Math.round((activeSkus / totalSkus) * 100) : 67}%
            </div>
            <div className="dash-stat-foot" style={{ color:'var(--green-deep)', fontWeight:600 }}>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="var(--green-deep)"><path d="M5 2l4 6H1z"/></svg>
              1.2%
            </div>
          </div>
        </div>
      </div>

      {/* ── SECTION 4: Data strip ── */}
      <div className="dash-strip">
        {PLATFORMS.map((p, i) => (
          <div key={i} className="dash-strip-cell">
            <PlatAvatar plat={p} size={26} />
            <span className="dash-strip-amt">₹{fmtK(p.rev)}</span>
            <span className="dash-strip-pct">{p.pct}%</span>
          </div>
        ))}
        <button className="dash-strip-cta" onClick={() => navigate('/pnl/flipkart')}>
          Details
        </button>
      </div>

      {/* ── SECTION 5: Mid-grid ── */}
      <div className="dash-mid">

        {/* Card A: Platform list */}
        <div className="dash-mid-card">
          <div className="dash-card-head">
            <button className="dash-sort-btn">
              <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M3 6h14M6 10h8M9 14h2"/></svg>
            </button>
            <button className="dash-filter-pill">
              Filters
              <svg width="10" height="10" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M5 8l5 5 5-5"/></svg>
            </button>
          </div>
          <div className="dash-ref-rows">
            {PLATFORMS.map((p, i) => (
              <div key={i} className="dash-ref-row">
                <div className="dash-ref-pill">
                  <PlatAvatar plat={p} size={32} />
                  <span className="dash-ref-name">{p.name}</span>
                  <span className="dash-ref-amt">₹{fmtK(p.rev)}</span>
                  <span className="dash-ref-pct">{p.pct}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Card B: Bar chart */}
        <div className="dash-mid-card dash-bar-card">
          <div className="dash-card-head">
            <button className="dash-sort-btn">
              <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M3 6h14M6 10h8M9 14h2"/></svg>
            </button>
            <button className="dash-filter-pill">
              Filters
              <svg width="10" height="10" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M5 8l5 5 5-5"/></svg>
            </button>
          </div>
          <div className="dash-brand-bars">
            {PLATFORMS.map((p, i) => {
              const maxRev = Math.max(...PLATFORMS.map(x => x.rev))
              const h = Math.round((p.rev / maxRev) * 100)
              const isActive = i === selPlat
              return (
                <div key={i} className="dash-bar-wrap" onClick={() => setSelPlat(i)} style={{ cursor: 'pointer' }}>
                  <div className="dash-bar" style={{
                    height: `${h}%`,
                    background: isActive
                      ? `linear-gradient(180deg, ${hexToRgba(p.color, 0.9)} 0%, ${hexToRgba(p.color, 0.65)} 100%)`
                      : hexToRgba(p.color, 0.13),
                    boxShadow: isActive ? `0 10px 24px -10px ${hexToRgba(p.color, 0.55)}` : 'none',
                    transform: isActive ? 'scaleY(1.03)' : 'none',
                    transformOrigin: 'bottom',
                    transition: 'all 0.2s ease',
                  }}>
                    <PlatAvatar plat={p} size={24} />
                  </div>
                </div>
              )
            })}
          </div>
          <div className="dash-bar-foot">
            <span className="dash-bar-lab">Revenue</span>
            <span className="dash-bar-val">
              by platform
              <svg width="11" height="11" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M5 8l5 5 5-5"/></svg>
            </span>
          </div>
        </div>

        {/* Card C: Dashboard card (spans 2 rows) */}
        <div className="dash-dc-card">

          {/* Top table */}
          <div className="dash-dc-table">
            <div className="dash-dc-thead">
              <div className="dct-c name">Platform</div>
              <div className="dct-c rev">Revenue</div>
              <div className="dct-c">SKUs</div>
              <div className="dct-c">Units</div>
              <div className="dct-c">Margin</div>
              <div className="dct-c">Win</div>
              <div className="dct-c"></div>
            </div>
            {TEAM.slice(0, 2).map((p, i) => (
              <div key={i} className="dash-dc-trow">
                <div className="dct-c name">
                  <Av ini={p.ini} color={p.color} size={22} />
                  {p.name.split(' ')[0]} {p.name.split(' ')[1][0]}.
                </div>
                <div className="dct-c rev">₹{fmtK(p.rev)}</div>
                <div className="dct-c"><span className="dash-dc-pill">{p.leads}</span></div>
                <div className="dct-c">{Math.round(p.rev / 800)}</div>
                <div className="dct-c">{(p.pct - 8).toFixed(1)}%</div>
                <div className="dct-c">{p.w}/{p.l}</div>
                <div className="dct-c">
                  {i === 1 && (
                    <span className="dash-dc-chev">
                      <svg width="9" height="9" viewBox="0 0 20 20" fill="currentColor"><path d="M6 4l8 6-8 6V4z"/></svg>
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Achievement tags */}
          <div className="dash-dc-tags">
            <span className="dash-dc-tag">Top platform</span>
            <span className="dash-dc-tag">Sales streak</span>
            <span className="dash-dc-tag">Top margin</span>
            <div className="dash-dc-growth">
              <span className="dash-dc-pillpk">
                <svg width="8" height="8" viewBox="0 0 10 10" fill="currentColor"><path d="M5 2l4 6H1z"/></svg>
                {REV_CHANGE}%
              </span>
              <span className="dash-dc-pillpk">₹{fmtK(TOTAL_REV)}</span>
            </div>
          </div>

          {/* Platform breakdown — fully dynamic, no hardcoded index */}
          <h4 className="dash-dc-sec">Work with platforms</h4>
          <div className="dash-dc-plat-grid">
            {PLATFORMS[0] && (
              <div className="dash-dc-plat dash-dc-plat-feat">
                <div className="dash-dc-stripes" />
                <div className="dash-dc-plat-head">
                  <PlatAvatar plat={PLATFORMS[0]} size={18} />
                  {PLATFORMS[0].name}
                </div>
                <div className="dash-dc-plat-pr">
                  <span className="dash-dc-plat-pct">{PLATFORMS[0].pct?.toFixed(1)}%</span>
                  <span className="dash-dc-plat-amt">₹{fmtK(PLATFORMS[0].rev)}</span>
                </div>
              </div>
            )}
            {PLATFORMS[1] && (
              <div className="dash-dc-plat">
                <div className="dash-dc-stripes" />
                <div className="dash-dc-plat-head">
                  <PlatAvatar plat={PLATFORMS[1]} size={14} />
                  {PLATFORMS[1].name}
                </div>
                <div className="dash-dc-plat-pr">
                  <span className="dash-dc-plat-pct">{PLATFORMS[1].pct?.toFixed(1)}%</span>
                  <span className="dash-dc-plat-amt">₹{fmtK(PLATFORMS[1].rev)}</span>
                </div>
              </div>
            )}
            {PLATFORMS.length > 2 && (
              <div className="dash-dc-plat dash-dc-plat-split">
                {PLATFORMS.slice(2).map((p, i) => (
                  <div key={p.platform_id}>
                    {i > 0 && <div className="dash-dc-split-div" />}
                    <div className="dash-dc-split-row">
                      <span className="dash-dc-plat-head">
                        <PlatAvatar plat={p} size={13} />
                        {p.name}
                      </span>
                      <span className="dash-dc-split-meta">
                        <span className="dash-dc-plat-pct" style={{ fontSize:12 }}>{p.pct?.toFixed(1)}%</span>
                        <span className="dash-dc-plat-amt">₹{fmtK(p.rev)}</span>
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Sales dynamic chart */}
          <div className="dash-dc-chart-wrap">
            <div className="dash-dc-chart-head">
              <h4>Sales dynamic</h4>
              <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M7 17l5-14M5 8l5 5 5-5"/></svg>
            </div>
            <ResponsiveContainer width="100%" height={90}>
              <LineChart data={SALES_DYN} margin={{ top:4, right:4, left:-30, bottom:0 }}>
                <XAxis dataKey="w" tick={{ fontSize:9, fill:'#C9C6C2', fontFamily:'var(--font-ui)' }} axisLine={false} tickLine={false} />
                <YAxis tick={false} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTip />} />
                <Line type="monotone" dataKey="a" stroke={TEAM[0].color} strokeWidth={1.5} dot={false} />
                <Line type="monotone" dataKey="r" stroke={TEAM[1].color} strokeWidth={1.5} dot={false} />
                <Line type="monotone" dataKey="p" stroke={TEAM[2].color} strokeWidth={1.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Bottom peek row */}
          <div className="dash-dc-peek">
            <div className="dash-dc-trow">
              <div className="dct-c name">
                <Av ini={TEAM[2].ini} color={TEAM[2].color} size={22} />
                {TEAM[2].name.split(' ')[0]} {TEAM[2].name.split(' ')[1][0]}.
              </div>
              <div className="dct-c rev">₹{fmtK(TEAM[2].rev)}</div>
              <div className="dct-c"><span className="dash-dc-pill">{TEAM[2].leads}</span></div>
              <div className="dct-c">{Math.round(TEAM[2].rev / 800)}</div>
              <div className="dct-c">{(TEAM[2].pct - 8).toFixed(1)}%</div>
              <div className="dct-c">{TEAM[2].w}/{TEAM[2].l}</div>
              <div className="dct-c" />
            </div>
          </div>
        </div>

        {/* Card D: Platform value card (spans cols 1-2, row 2) */}
        <div className="dash-pdv-card">

          {/* Left pink panel */}
          <div className="dash-pdv-left">
            <div className="dash-pdv-vlabel">Total revenue</div>
            <div className="dash-pdv-stat">
              <span className="dash-pdv-lbl">Revenue</span>
              <span className="dash-pdv-val">₹{sp?.rev ? fmtK(sp.rev) : '—'}</span>
            </div>
            <div className="dash-pdv-stat">
              <span className="dash-pdv-lbl">Reports</span>
              <span className="dash-pdv-val">{sp?.report_count ?? 0} <span className="dash-pdv-sub">uploaded</span></span>
            </div>
            <div className="dash-pdv-stat">
              <span className="dash-pdv-lbl">Share</span>
              <span className="dash-pdv-val">{sp?.pct?.toFixed(1) ?? '0'}% <span className="dash-pdv-sub">{(sp?.pct ?? 0) > 50 ? 'top' : 'avg'}</span></span>
            </div>
          </div>

          {/* Right chart panel */}
          <div className="dash-pdv-right">
            {/* Header — in normal flow (fixes the overlap bug) */}
            <div className="dash-pdv-head">
              <div className="dash-pdv-title">
                <PlatAvatar plat={sp} size={36} />
                <div>
                  <div className="dash-pdv-eyebrow">Monthly value by platform</div>
                  <div className="dash-pdv-name">
                    {sp.name}
                    <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M5 8l5 5 5-5"/></svg>
                  </div>
                </div>
              </div>
              <div className="dash-pdv-tabs">
                {['Revenue','Orders','Margin'].map(t => (
                  <button key={t} className={`dash-pdv-tab${tab === t ? ' active' : ''}`}
                    onClick={() => setTab(t)}>{t}</button>
                ))}
              </div>
            </div>

            {/* Platform selector */}
            <div className="dash-pdv-plat-sel">
              {PLATFORMS.map((p, i) => (
                <button key={i} className={`dash-pdv-plat-btn${i === selPlat ? ' active' : ''}`}
                  onClick={() => setSelPlat(i)}>
                  <PlatAvatar plat={p} size={14} />
                  {p.name}
                </button>
              ))}
            </div>

            {/* Bar chart — overflow:visible to fix tooltip clipping */}
            <div className="dash-pdv-plot">
              <div className="dash-pdv-bars">
                {MONTHLY.length === 0 ? (
                  <div style={{ width:'100%', textAlign:'center', color:'var(--text-muted)', fontSize:12, paddingTop:20 }}>
                    No monthly data yet — upload P&L reports first
                  </div>
                ) : MONTHLY.map((m, mi) => {
                  const platKeys = PLATFORMS.map(p => p.name?.toLowerCase())
                  const vals     = platKeys.map(k => m[k] ?? 0)
                  const maxV     = Math.max(...MONTHLY.flatMap(x => platKeys.map(k => x[k] ?? 0)), 1)
                  return (
                    <div key={mi} className="dash-pdv-group">
                      {vals.map((v, vi) => {
                        const h = Math.round((v / maxV) * 100)
                        const isActive = mi === 0 && vi === selPlat
                        const platColor = PLATFORMS[vi]?.color ?? '#888'
                        return (
                          <div key={vi} className={`dash-pdv-bar${isActive ? ' dash-pdv-bar-active' : ''}`}
                            style={{
                              height: `${h || 2}%`,
                              background: isActive
                                ? `linear-gradient(180deg, ${hexToRgba(platColor, 0.85)}, ${hexToRgba(platColor, 0.55)})`
                                : hexToRgba(platColor, 0.14),
                              boxShadow: isActive ? `0 6px 16px -8px ${hexToRgba(platColor, 0.5)}` : 'none',
                            }}>
                            {isActive && v > 0 && (
                              <div className="dash-pdv-tip">
                                ₹{fmtK(v)}
                                <div className="dash-pdv-tip-rich">
                                  <span>₹{fmtK(v)}</span>
                                  <span style={{ opacity:.75, fontSize:11 }}>{m.m}</span>
                                </div>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
              </div>

              {/* Axis */}
              <div className="dash-pdv-axis">
                {MONTHLY.map((m, i) => (
                  <div key={i} className="dash-pdv-axis-cell">
                    <div className="dash-pdv-avs">
                      {TEAM.slice(0, Math.min(3, PLATFORMS.length)).map((t, ti) => (
                        <Av key={ti} ini={t.ini} color={t.color} size={18} />
                      ))}
                    </div>
                    <span className="dash-pdv-month">{m.m}</span>
                  </div>
                ))}
              </div>

              {/* Y-axis labels — dynamic based on real data */}
              {(() => {
                const maxV = MONTHLY.length
                  ? Math.max(...MONTHLY.flatMap(x => PLATFORMS.map(p => x[p.name?.toLowerCase()] ?? 0)), 1)
                  : 12000
                return (
                  <div className="dash-pdv-yaxis">
                    <span>₹{fmtK(maxV)}</span>
                    <span>₹{fmtK(Math.round(maxV * 0.66))}</span>
                    <span>₹{fmtK(Math.round(maxV * 0.33))}</span>
                  </div>
                )
              })()}
            </div>
          </div>
        </div>

      </div>

      {/* ── SECTION 6: Geo Insights ── */}
      <div className="dash-geo">
        <IndiaMapCard />
      </div>

    </div>
  )
}
