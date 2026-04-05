import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell,
} from 'recharts'
import { getSkus, getPlatforms, getMiscTotal, getSettings } from '../api/client'
import { useAuth } from '../context/AuthContext'
import ReportHeader from '../components/dashboard/ReportHeader'

// ── DUMMY DATA (PLUG-IN comments show where real data connects) ──────────────

const TEAM = [
  { name: 'Ayesha Khan',  ini: 'AK', color: '#7C5CFC', rev: 209633, leads: 41, kpi: 0.84, w: 12, l: 29, pct: 39.63 },
  { name: 'Rohan Mehta',  ini: 'RM', color: '#E8365D', rev: 156841, leads: 54, kpi: 0.89, w: 21, l: 33, pct: 29.65 },
  { name: 'Priya Sharma', ini: 'PS', color: '#F97316', rev: 117115, leads: 22, kpi: 0.79, w:  7, l: 15, pct: 22.14 },
  { name: 'Vikram Singh', ini: 'VS', color: '#0EA5E9', rev:  45386, leads:  8, kpi: 0.62, w:  3, l:  5, pct:  8.56 },
]

// PLUG-IN: real platform revenue from /api/v1/entries grouped by platform_id
const PLAT_REV = [
  { name: 'Meesho',   s: 'Me', color: '#F97316', rev: 227459, pct: 43 },
  { name: 'Flipkart', s: 'Fk', color: '#3B82F6', rev: 142823, pct: 27 },
  { name: 'Amazon',   s: 'Az', color: '#EAB308', rev:  89935, pct: 17 },
  { name: 'Myntra',   s: 'My', color: '#E8365D', rev:  68286, pct: 13 },
]

// PLUG-IN: monthly revenue per platform from /api/v1/entries grouped by month
const MONTHLY = [
  { m: 'Sep', v: 11035 },
  { m: 'Oct', v:  8901 },
  { m: 'Nov', v:  9288 },
  { m: 'Dec', v:  6901 },
]

// PLUG-IN: weekly per-person sales from /api/v1/entries grouped by week
const SALES_DYN = [
  { w: 'W3', a: 18, r: 14, p: 11 },
  { w: 'W4', a: 22, r: 16, p:  9 },
  { w: 'W5', a: 19, r: 18, p: 13 },
  { w: 'W6', a: 28, r: 20, p: 15 },
  { w: 'W7', a: 24, r: 17, p: 18 },
  { w: 'W8', a: 32, r: 22, p: 16 },
  { w: 'W9', a: 30, r: 25, p: 20 },
]

// PLUG-IN: all from /api/v1/entries aggregated
const TOTAL_REV  = 528976
const PREV_REV   = 501641
const REV_CHANGE = 7.9
const REV_DIFF   = 27335

// ── CHART TOOLTIP ─────────────────────────────────────────────────────────────

function ChartTip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: '#111110', borderRadius: 8, padding: '7px 10px', fontSize: 11 }}>
      <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 9, textTransform: 'uppercase', marginBottom: 3 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#fff' }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: p.color || p.stroke, display: 'inline-block' }} />
          <span style={{ fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
            {p.value < 100 ? `₹${(p.value * 1000).toLocaleString('en-IN')}` : `₹${p.value?.toLocaleString('en-IN')}`}
          </span>
        </div>
      ))}
    </div>
  )
}

// Inline avatar for the rest of the dashboard body
function Av({ ini, color, size = 24 }) {
  return (
    <div style={{
      width: size, height: size, background: color, borderRadius: '50%',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: Math.floor(size * 0.36), fontWeight: 700, color: '#fff', flexShrink: 0,
    }}>{ini}</div>
  )
}

// ── MAIN DASHBOARD ────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { user }   = useAuth()
  const navigate   = useNavigate()
  const [api,      setApi]     = useState(null)
  const [loading,  setLoading] = useState(true)
  const [selPlat,  setSelPlat] = useState(0)
  const [tab,      setTab]     = useState('Revenue')

  useEffect(() => {
    Promise.all([getSkus(), getPlatforms(), getMiscTotal(), getSettings()])
      .then(([skus, platforms, miscTotal, settings]) =>
        setApi({ skus, platforms, miscTotal, settings }))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="loader" style={{ width: 28, height: 28 }} />
    </div>
  )
  if (!api) return (
    <div className="flex items-center justify-center h-64">
      <p className="text-red-500 text-sm">⚠️ Backend not reachable on port 8000</p>
    </div>
  )

  // Real values from API
  const totalSkus  = api.skus.length
  const activeSkus = api.skus.filter(s => s.is_active).length
  const platforms  = api.platforms.filter(p => p.is_active)
  const sp         = PLAT_REV[selPlat]

  return (
    <div className="max-w-[1200px] pb-10" style={{ fontFamily: 'var(--font-ui)' }}>

      {/* ── ReportHeader: the white top card (avatars, title, revenue, stat cards) ── */}
      <ReportHeader
        team={TEAM}
        totalRev={TOTAL_REV}
        prevRev={PREV_REV}
        revChange={REV_CHANGE}
        revDiff={REV_DIFF}
        totalSkus={totalSkus}
        activeSkus={activeSkus}
        dateRange="Sep 1 – Nov 30, 2025"
      />

      {/* ── 2-column grid ── */}
      <div className="grid gap-4" style={{ gridTemplateColumns: '1.65fr 1fr' }}>

        {/* ═══════════ LEFT COLUMN ═══════════ */}
        <div className="flex flex-col gap-4 min-w-0">

          {/* Revenue hero */}
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#A8A59F] mb-1.5">Revenue</div>
            <div className="flex items-baseline gap-2.5 flex-wrap mb-1">
              {/* PLUG-IN: sum(bank_settlement) from /api/v1/entries */}
              <span className="text-[42px] font-extrabold tracking-[-0.04em] text-[#111110] leading-none">
                ₹{Math.floor(TOTAL_REV / 1000)}
                <span className="text-[26px] text-[#6B6866]">,{(TOTAL_REV % 1000).toString().padStart(3,'0')}</span>
              </span>
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-[#DCFCE7] text-[#166534]">
                ↑ {REV_CHANGE}%
              </span>
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-[#FEE2E2] text-[#991B1B]">
                +₹{REV_DIFF.toLocaleString('en-IN')}
              </span>
            </div>
            <div className="text-[11px] text-[#A8A59F]">
              vs prev. ₹{PREV_REV.toLocaleString('en-IN')} &nbsp;·&nbsp; Sep 1 – Nov 30, 2024 ↓
            </div>
          </div>

          {/* Revenue share bar */}
          {/* PLUG-IN: real revenue split per person from /api/v1/entries */}
          <div>
            {/* Stacked bar */}
            <div className="flex h-2 rounded-full overflow-hidden gap-[2px] mb-2.5">
              {TEAM.map((p, i) => (
                <div key={i} className="rounded-full transition-all cursor-pointer hover:opacity-80"
                  style={{ width: `${p.pct}%`, background: p.color }}
                  title={`${p.name}: ₹${p.rev.toLocaleString('en-IN')}`}
                />
              ))}
            </div>
            {/* People row */}
            <div className="flex items-center gap-3 flex-wrap">
              {TEAM.map((p, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <Av ini={p.ini} color={p.color} size={22} />
                  <div>
                    <div className="text-[11px] font-bold text-[#111110]">₹{(p.rev / 1000).toFixed(0)}k</div>
                    <div className="text-[10px] text-[#A8A59F]">{p.pct}%</div>
                  </div>
                </div>
              ))}
              <button
                onClick={() => navigate('/pricing')}
                className="ml-auto text-[11px] font-semibold text-[#6B6866] bg-white border border-[#E0DDD6] rounded-lg px-2.5 py-1 hover:bg-[#F7F6F3] hover:text-[#111110] transition-colors cursor-pointer"
              >
                Details →
              </button>
            </div>
          </div>

          {/* Charts row: Platform list card + Donut card */}
          <div className="grid grid-cols-2 gap-3">

            {/* Platform list */}
            {/* PLUG-IN: real revenue per platform from /api/v1/entries */}
            <div className="bg-white rounded-xl border border-[#EBEBEB] p-4 shadow-[0_1px_4px_rgba(0,0,0,0.04)]">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[12px] font-bold text-[#111110]">Platforms</span>
                <button className="text-[10px] font-semibold text-[#6B6866] bg-[#F7F6F3] border border-[#EBEBEB] rounded-md px-2 py-1 hover:bg-[#F0EEEA] cursor-pointer">
                  Filters ▾
                </button>
              </div>
              <div className="flex flex-col gap-0.5">
                {PLAT_REV.map((p, i) => (
                  <div key={i}
                    onClick={() => setSelPlat(i)}
                    className={`flex items-center gap-2 px-2 py-2 rounded-lg cursor-pointer transition-colors ${i === selPlat ? 'bg-[#F7F6F3]' : 'hover:bg-[#F7F6F3]'}`}
                  >
                    <div className="w-7 h-7 rounded-md flex items-center justify-center text-[10px] font-black flex-shrink-0"
                      style={{ background: p.color + '18', color: p.color }}>
                      {p.s}
                    </div>
                    <span className="flex-1 text-[12px] font-medium text-[#111110]">{p.name}</span>
                    <span className="text-[11px] font-bold text-[#111110] font-mono">₹{(p.rev / 1000).toFixed(0)}k</span>
                    <span className="text-[10px] text-[#A8A59F] w-7 text-right">{p.pct}%</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Donut chart */}
            {/* PLUG-IN: deals count per platform from /api/v1/entries */}
            <div className="bg-white rounded-xl border border-[#EBEBEB] p-4 shadow-[0_1px_4px_rgba(0,0,0,0.04)]">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[12px] font-bold text-[#111110]">Deals by Platform</span>
                <button className="text-[10px] font-semibold text-[#6B6866] bg-[#F7F6F3] border border-[#EBEBEB] rounded-md px-2 py-1 hover:bg-[#F0EEEA] cursor-pointer">
                  Filters ▾
                </button>
              </div>
              <div className="flex items-center gap-2">
                <PieChart width={120} height={120}>
                  <Pie data={PLAT_REV} cx={55} cy={55} innerRadius={34} outerRadius={52}
                    dataKey="pct" strokeWidth={0}>
                    {PLAT_REV.map((e, i) => <Cell key={i} fill={e.color} />)}
                  </Pie>
                  <Tooltip formatter={(v) => `${v}%`} />
                </PieChart>
                <div className="flex flex-col gap-1.5 flex-1">
                  {PLAT_REV.map((p, i) => (
                    <div key={i} className="flex items-center gap-1.5 text-[11px]">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: p.color }} />
                      <span className="flex-1 text-[#6B6866]">{p.name}</span>
                      <span className="font-bold text-[#111110] font-mono text-[10px]">{p.pct}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Platform detail card */}
          {/* PLUG-IN: filter /api/v1/entries by platform_id, group by month */}
          <div className="bg-white rounded-xl border border-[#EBEBEB] p-4 shadow-[0_1px_4px_rgba(0,0,0,0.04)]">
            {/* Header */}
            <div className="flex items-center justify-between mb-2">
              <span className="text-[12px] font-bold text-[#111110]">Platform Value</span>
              <div className="flex gap-1">
                {PLAT_REV.map((p, i) => (
                  <button key={i}
                    onClick={() => setSelPlat(i)}
                    className="text-[10px] font-semibold px-2.5 py-1 rounded-full border transition-all cursor-pointer"
                    style={i === selPlat
                      ? { background: p.color, color: '#fff', borderColor: p.color }
                      : { background: '#F7F6F3', color: '#6B6866', borderColor: '#EBEBEB' }
                    }>
                    {p.name}
                  </button>
                ))}
              </div>
            </div>
            {/* Tab bar */}
            <div className="flex gap-1.5 mb-3">
              {['Revenue', 'Leads', 'W/L'].map(t => (
                <button key={t}
                  onClick={() => setTab(t)}
                  className="text-[11px] font-semibold px-3 py-1 rounded-lg border transition-all cursor-pointer"
                  style={tab === t
                    ? { background: '#111110', color: '#fff', borderColor: '#111110' }
                    : { background: 'transparent', color: '#6B6866', borderColor: '#EBEBEB' }
                  }>
                  {t}
                </button>
              ))}
            </div>
            {/* Body: left stats + right bar chart */}
            <div className="flex gap-4 items-start">
              {/* Left stats */}
              <div className="w-[110px] flex-shrink-0 border-r border-[#EBEBEB] pr-3">
                <div className="text-[9px] font-bold uppercase tracking-[0.08em] text-[#A8A59F] mb-2">Avg monthly</div>
                <div className="flex justify-between text-[11px] mb-1.5">
                  <span className="text-[#A8A59F]">Revenue</span>
                  <span className="font-bold" style={{ color: sp.color }}>₹{Math.floor(sp.rev / 4000)}k</span>
                </div>
                <div className="flex justify-between text-[11px] mb-1.5">
                  <span className="text-[#A8A59F]">Leads</span>
                  <span className="font-bold text-[#111110]">{Math.floor(sp.pct * 3.5)}</span>
                </div>
                <div className="flex justify-between text-[11px] mb-3">
                  <span className="text-[#A8A59F]">Win%</span>
                  <span className="font-bold text-[#16A34A]">{sp.pct - 8}%</span>
                </div>
                <div className="flex">
                  {TEAM.slice(0, 3).map((p, i) => (
                    <div key={i} className="rounded-full ring-2 ring-white" style={{ marginLeft: i ? -5 : 0, zIndex: 3 - i }}>
                      <Av ini={p.ini} color={p.color} size={20} />
                    </div>
                  ))}
                </div>
              </div>
              {/* Bar chart */}
              <div className="flex-1 min-w-0">
                <ResponsiveContainer width="100%" height={100}>
                  <BarChart data={MONTHLY} barSize={18} margin={{ top: 4, right: 4, left: -28, bottom: 0 }}>
                    <XAxis dataKey="m" tick={{ fontSize: 10, fill: '#A8A59F', fontFamily: 'var(--font-ui)' }} axisLine={false} tickLine={false} />
                    <YAxis tick={false} axisLine={false} tickLine={false} />
                    <Tooltip formatter={(v) => `₹${v.toLocaleString('en-IN')}`} />
                    <Bar dataKey="v" name="Revenue" fill={sp.color} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>

        {/* ═══════════ RIGHT COLUMN ═══════════ */}
        <div className="flex flex-col gap-3 min-w-0">

          {/* Stats Row 1: Top sales + Best deal */}
          <div className="grid grid-cols-2 gap-2.5">

            {/* Top sales */}
            {/* PLUG-IN: person with most deals from /api/v1/entries */}
            <div className="bg-white rounded-xl border border-[#EBEBEB] p-3.5 shadow-[0_1px_4px_rgba(0,0,0,0.04)]">
              <div className="text-[10px] font-bold uppercase tracking-[0.07em] text-[#A8A59F] mb-1">Top sales</div>
              <div className="text-[22px] font-extrabold tracking-[-0.03em] text-[#111110] leading-none mb-1.5">
                {TEAM[0].leads + TEAM[1].leads}
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-[#6B6866] font-medium">
                <Av ini={TEAM[1].ini} color={TEAM[1].color} size={18} />
                {TEAM[1].name.split(' ')[0]}
              </div>
            </div>

            {/* Best deal — dark card */}
            {/* PLUG-IN: max price entry from /api/v1/entries */}
            <div className="bg-[#111110] rounded-xl p-3.5 shadow-[0_1px_4px_rgba(0,0,0,0.12)]">
              <div className="text-[10px] font-bold uppercase tracking-[0.07em] text-white/30 mb-1">Best deal ★</div>
              <div className="text-[22px] font-extrabold tracking-[-0.03em] text-white leading-none mb-1.5">
                ₹12,400
              </div>
              <div className="flex items-center justify-between text-[11px] text-white/50 mb-0.5">
                <span>Flipkart</span>
                <span className="text-base text-white/30">→</span>
              </div>
              <div className="text-[10px] text-yellow-400 tracking-wider">★★★★★</div>
            </div>
          </div>

          {/* Stats Row 2: Deals + Value + Win rate */}
          <div className="grid grid-cols-3 gap-2.5">

            {/* Deals */}
            {/* PLUG-IN: count from /api/v1/entries */}
            <div className="bg-white rounded-xl border border-[#EBEBEB] p-3.5 shadow-[0_1px_4px_rgba(0,0,0,0.04)]">
              <div className="text-[10px] font-bold uppercase tracking-[0.07em] text-[#A8A59F] mb-1">Deals</div>
              <div className="text-[20px] font-extrabold tracking-[-0.03em] text-[#111110] leading-none mb-1">
                {totalSkus}
              </div>
              <div className="text-[11px] font-semibold text-[#16A34A]">↑ 7.9%</div>
            </div>

            {/* Value — highlighted with accent border */}
            {/* PLUG-IN: total revenue from /api/v1/entries */}
            <div className="bg-white rounded-xl border-2 border-[#E8365D] p-3.5 shadow-[0_1px_4px_rgba(232,54,93,0.1)]"
              style={{ background: 'linear-gradient(135deg, #fff, rgba(232,54,93,0.04))' }}>
              <div className="text-[10px] font-bold uppercase tracking-[0.07em] text-[#A8A59F] mb-1">Value</div>
              <div className="text-[20px] font-extrabold tracking-[-0.03em] text-[#111110] leading-none mb-1">
                ₹{Math.floor(TOTAL_REV / 1000)}k
              </div>
              <div className="text-[11px] font-semibold text-[#16A34A]">↑ 7.9%</div>
            </div>

            {/* Win rate */}
            {/* PLUG-IN: % profitable SKUs from /api/v1/entries */}
            <div className="bg-white rounded-xl border border-[#EBEBEB] p-3.5 shadow-[0_1px_4px_rgba(0,0,0,0.04)]">
              <div className="text-[10px] font-bold uppercase tracking-[0.07em] text-[#A8A59F] mb-1">Win rate</div>
              <div className="text-[20px] font-extrabold tracking-[-0.03em] text-[#111110] leading-none mb-1">
                {totalSkus > 0 ? Math.round((activeSkus / totalSkus) * 100) : 67}%
              </div>
              <div className="text-[11px] font-semibold text-[#16A34A]">↑ 1.2%</div>
            </div>
          </div>

          {/* Sales table */}
          {/* PLUG-IN: real data from /api/v1/users + /api/v1/entries */}
          <div className="bg-white rounded-xl border border-[#EBEBEB] p-4 shadow-[0_1px_4px_rgba(0,0,0,0.04)]">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[12px] font-bold text-[#111110]">Sales</span>
              <span className="text-[10px] text-[#A8A59F]">Revenue · Leads · KPI · W/L</span>
            </div>
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {['Name', 'Revenue', 'Leads', 'KPI', 'W/L'].map(h => (
                    <th key={h} className="pb-2 text-left text-[9px] font-bold uppercase tracking-[0.07em] text-[#A8A59F] border-b border-[#EBEBEB]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {TEAM.slice(0, 2).map((p, i) => (
                  <tr key={i} className="hover:bg-[#F7F6F3] transition-colors">
                    <td className="py-2.5 pr-2 border-b border-[#EBEBEB]">
                      <div className="flex items-center gap-2">
                        <Av ini={p.ini} color={p.color} size={24} />
                        <span className="text-[11px] font-semibold text-[#111110]">
                          {p.name.split(' ')[0]} {p.name.split(' ')[1][0]}.
                        </span>
                      </div>
                    </td>
                    <td className="py-2.5 border-b border-[#EBEBEB] text-[11px] font-bold text-[#111110] font-mono">
                      ₹{(p.rev / 1000).toFixed(0)}k
                    </td>
                    <td className="py-2.5 border-b border-[#EBEBEB] text-[11px] text-[#6B6866]">{p.leads}</td>
                    <td className="py-2.5 border-b border-[#EBEBEB] text-[11px] text-[#6B6866]">{p.kpi.toFixed(2)}</td>
                    <td className="py-2.5 border-b border-[#EBEBEB]">
                      <span className="flex items-center gap-1 text-[11px] font-mono">
                        <b className="text-[#16A34A]">{p.w}</b>
                        <span className="text-[#A8A59F]">/</span>
                        <b className="text-[#DC2626]">{p.l}</b>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {/* Achievement badges */}
            <div className="flex flex-wrap gap-1.5 mt-3">
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-full bg-amber-50 text-amber-800 border border-amber-200">Top sales 🔥</span>
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-full bg-red-50 text-red-600 border border-red-100">Sales streak 🔥</span>
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-100">Top review 👍</span>
            </div>
          </div>

          {/* Work with platforms */}
          {/* PLUG-IN: real platforms from /api/v1/platforms + revenue split */}
          <div className="bg-white rounded-xl border border-[#EBEBEB] p-4 shadow-[0_1px_4px_rgba(0,0,0,0.04)]">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[12px] font-bold text-[#111110]">Work with platforms</span>
              <div className="flex gap-1.5">
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#F7F6F3] text-[#6B6866] border border-[#EBEBEB]">
                  {platforms.length}
                </span>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-50 text-red-600 border border-red-100">
                  ₹{(PLAT_REV[0].rev / 1000).toFixed(0)}k
                </span>
              </div>
            </div>
            {/* 3 platform items */}
            <div className="grid grid-cols-3 gap-2 mb-3">
              {PLAT_REV.slice(0, 3).map((p, i) => (
                <div key={i} className="flex flex-col items-center gap-1.5 p-2.5 rounded-xl border border-[#EBEBEB] bg-[#F7F6F3] hover:border-[#E0DDD6] transition-colors cursor-pointer">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center text-[10px] font-black"
                    style={{ background: p.color + '18', color: p.color }}>
                    {p.s}
                  </div>
                  <div className="text-[10px] font-semibold text-[#6B6866]">{p.name}</div>
                  <div className="text-[14px] font-extrabold tracking-[-0.02em]" style={{ color: p.color }}>{p.pct}%</div>
                  <div className="text-[10px] text-[#A8A59F] font-mono">₹{(p.rev / 1000).toFixed(0)}k</div>
                </div>
              ))}
            </div>
            {/* Big highlight */}
            <div className="flex items-end justify-between px-3 py-2.5 rounded-xl border border-[#FECDD3] bg-gradient-to-br from-white to-red-50">
              <div>
                <div className="text-[26px] font-extrabold tracking-[-0.04em] text-[#111110] leading-none">
                  {(PLAT_REV[0].pct + 2.3).toFixed(1)}%
                </div>
                <div className="text-[11px] font-semibold text-[#6B6866] mt-0.5">
                  ₹{((PLAT_REV[0].rev + PLAT_REV[1].rev) / 1000).toFixed(0)}k combined
                </div>
              </div>
              <div className="flex flex-col items-end gap-1">
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[#F7F6F3] text-[#6B6866] border border-[#EBEBEB]">Other</span>
                <span className="text-[10px] text-[#A8A59F] font-mono">7.1% · ₹{(PLAT_REV[3].rev / 1000).toFixed(0)}k</span>
              </div>
            </div>
          </div>

          {/* Sales dynamic */}
          {/* PLUG-IN: weekly revenue trend from /api/v1/entries grouped by week */}
          <div className="bg-white rounded-xl border border-[#EBEBEB] p-4 shadow-[0_1px_4px_rgba(0,0,0,0.04)]">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[12px] font-bold text-[#111110]">Sales dynamic</span>
              <span className="text-[11px] font-semibold text-[#16A34A]">↗ growing</span>
            </div>
            <ResponsiveContainer width="100%" height={90}>
              <LineChart data={SALES_DYN} margin={{ top: 4, right: 4, left: -30, bottom: 0 }}>
                <XAxis dataKey="w" tick={{ fontSize: 9, fill: '#A8A59F', fontFamily: 'var(--font-ui)' }} axisLine={false} tickLine={false} />
                <YAxis tick={false} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTip />} />
                <Line type="monotone" dataKey="a" stroke={TEAM[0].color} strokeWidth={1.5} dot={false} />
                <Line type="monotone" dataKey="r" stroke={TEAM[1].color} strokeWidth={1.5} dot={false} />
                <Line type="monotone" dataKey="p" stroke={TEAM[2].color} strokeWidth={1.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Bottom person row */}
          {/* PLUG-IN: 3rd person from real sales rankings */}
          <div className="bg-white rounded-xl border border-[#EBEBEB] px-4 py-3 shadow-[0_1px_4px_rgba(0,0,0,0.04)]">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 flex-1">
                <Av ini={TEAM[2].ini} color={TEAM[2].color} size={26} />
                <span className="text-[12px] font-semibold text-[#111110]">
                  {TEAM[2].name.split(' ')[0]} {TEAM[2].name.split(' ')[1][0]}.
                </span>
              </div>
              <span className="text-[11px] font-bold text-[#111110] font-mono">₹{(TEAM[2].rev / 1000).toFixed(0)}k</span>
              <span className="text-[11px] text-[#A8A59F]">{TEAM[2].leads}</span>
              <span className="text-[11px] text-[#A8A59F]">{TEAM[2].kpi.toFixed(2)}</span>
              <span className="flex items-center gap-1 text-[11px] font-mono">
                <b className="text-[#16A34A]">{TEAM[2].w}</b>
                <span className="text-[#A8A59F]">/</span>
                <b className="text-[#DC2626]">{TEAM[2].l}</b>
              </span>
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
