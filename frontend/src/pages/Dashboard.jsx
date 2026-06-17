import { useState, useEffect } from 'react'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { getSkus, getPnlDashboard } from '../api/client'
import api from '../api/client'
import IndiaMapCard from '../components/IndiaMapCard'
import './Dashboard.css'

// ── Platform display config ────────────────────────────────────────────────
const PLAT_CFG = {
  flipkart: { short: 'F',  color: '#2874F0', textColor: '#FFE500', italic: true  },
  amazon:   { short: 'a',  color: '#FF9900', textColor: '#0B0B0E', italic: false },
  meesho:   { short: 'm',  color: '#F43397', textColor: '#fff',    italic: false },
  snapdeal: { short: 'S',  color: '#E40046', textColor: '#fff',    italic: false },
  shopdeck: { short: 'Sd', color: '#7A5BFF', textColor: '#fff',    italic: false },
  default:  { short: '?',  color: '#6F6B62', textColor: '#fff',    italic: false },
}
const cfg = n => PLAT_CFG[n?.toLowerCase()] ?? PLAT_CFG.default
// Ordered platform list (F/a/m/S/Sd — matches design)
const PLAT_KEYS = ['flipkart', 'amazon', 'meesho', 'snapdeal', 'shopdeck']

// ── Helpers ───────────────────────────────────────────────────────────────
const fmt    = n => (n ?? 0).toLocaleString('en-IN')
const fmtL   = n => `₹${((n ?? 0) / 100000).toFixed(1)}L`
// Returns [number_string, 'L'] for styled rendering
const fmtLParts = n => [`₹${((n ?? 0) / 100000).toFixed(1)}`, 'L']
const fmtK   = n => (n ?? 0) >= 100000 ? fmtL(n) : `₹${Math.round((n ?? 0) / 1000)}k`
const pct    = (a, b) => b > 0 ? ((a / b) * 100).toFixed(1) + '%' : '—'

// ── Settlement reconciliation — real data from /dashboard/reconciliation ─────
function SettlementRecon({ recon }) {
  if (!recon?.summary || (recon.summary.bank_settlement <= 0 && recon.summary.underpaid_skus <= 0)) return null
  const sm = recon.summary
  return (
    <section className="recon">
      <div className="sec-head">
        <div>
          <h2>Settlement reconciliation <span className="ct">cash &amp; leakage</span></h2>
          <div className="sub">What&apos;s settled, what&apos;s pending, and where the platform under-paid vs your expected settlement.</div>
        </div>
      </div>
      <div className="rc-top st-gap">
        <div className="rc-kpi">
          <span className="k">Settled</span>
          <span className="v">{fmtL(sm.settled)}</span>
          <span className="s">{sm.settled_pct != null ? `${sm.settled_pct}% of ${fmtL(sm.bank_settlement)}` : '—'}</span>
        </div>
        <div className="rc-kpi">
          <span className="k">Pending</span>
          <span className="v amber">{fmtL(Math.max(sm.pending, 0))}</span>
          <span className="s">awaiting platform payout</span>
        </div>
        <div className="rc-kpi">
          <span className="k">Fee load</span>
          <span className="v">{sm.fee_load_pct != null ? `${sm.fee_load_pct}%` : '—'}</span>
          <span className="s">{fmtL(sm.total_fees)} of gross</span>
        </div>
        <div className="rc-kpi flag">
          <span className="k">Recoverable</span>
          <span className="v neg">{fmtL(sm.recoverable)}</span>
          <span className="s">{sm.underpaid_skus} SKUs under-settled</span>
        </div>
      </div>
      <div className="rc-grid">
        <div className="rc-platforms">
          {(recon.platforms ?? []).map(p => (
            <div key={p.platform} className="rc-prow">
              <span className="rc-pname">
                <PlatMk name={p.platform} size={22} /> {p.platform}
                {p.fee_flag && <span className="rc-feeflag">⚠ {p.fee_load_pct}% fees</span>}
              </span>
              <div className="rc-bar"><i style={{ width: `${p.settled_pct ?? 0}%` }} /></div>
              <span className="rc-pval">{p.settled_pct != null ? `${p.settled_pct}%` : '—'}</span>
            </div>
          ))}
        </div>
        <div className="rc-watch">
          <div className="rc-whd">Top under-settled SKUs <span>vs expected</span></div>
          {(recon.underpaid ?? []).length === 0 && <div className="si-empty">No under-settled SKUs — platforms paid in full. ✓</div>}
          {(recon.underpaid ?? []).map(u => (
            <div key={u.sku + u.platform} className="rc-wrow">
              <span className="rc-wsku" title={`${u.sku} · ${u.platform}`}>{u.sku}</span>
              <span className="rc-wpu">{u.actual_per_unit} / {u.expected_per_unit}</span>
              <span className="rc-wgap">−₹{fmt(Math.abs(Math.round(u.gap_total)))}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ── Fraud action pipeline — real data from /dashboard/action-pipeline ────────
function FraudPipeline({ pipeline }) {
  if (!pipeline?.summary?.total_actors) return null
  const sm = pipeline.summary
  const actCls = a => a === 'BLOCK' ? 'block' : a === 'DISPUTE' ? 'dispute' : 'watch'

  const exportBlocklist = () => {
    const head = 'actor_key,state,reason,score,orders\n'
    const body = (pipeline.blocklist ?? []).map(b =>
      `${b.actor_key},${b.state ?? ''},${b.reason},${b.score},${b.orders}`).join('\n')
    const blob = new Blob([head + body], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url; link.download = `blocklist_${new Date().toISOString().slice(0, 10)}.csv`
    link.click(); URL.revokeObjectURL(url)
  }

  return (
    <section className="pipe">
      <div className="sec-head">
        <div>
          <h2>Fraud action pipeline <span className="ct">{sm.total_actors} actors</span></h2>
          <div className="sub">Prioritised by recoverable impact. Block repeat refusers, dispute fraud-signal returns.</div>
        </div>
        {sm.block > 0 && (
          <button className="pipe-export" onClick={exportBlocklist}>
            ↓ Export blocklist ({sm.block})
          </button>
        )}
      </div>

      <div className="pipe-stats st-gap">
        <div className="pp-stat block"><span className="n">{sm.block}</span><span className="k">Block</span></div>
        <div className="pp-stat dispute"><span className="n">{sm.dispute}</span><span className="k">Dispute</span></div>
        <div className="pp-stat watch"><span className="n">{sm.watch}</span><span className="k">Watch</span></div>
        <div className="pp-stat"><span className="n">{sm.repeat_offenders}</span><span className="k">Repeat refusers</span></div>
        <div className="pp-stat recover"><span className="n">{fmtL(sm.est_recovery)}</span><span className="k">Est. recoverable</span></div>
      </div>

      <div className="pipe-queue st-gap-sm">
        <div className="pq-row pq-hd">
          <span>Action</span><span>Actor</span><span>Pattern</span><span>Orders · returns</span><span>Score</span><span>Recommended claim</span>
        </div>
        {(pipeline.queue ?? []).slice(0, 8).map(q => (
          <div key={q.actor_key} className="pq-row">
            <span className={`pq-act ${actCls(q.action)}`}>{q.action}</span>
            <span className="pq-actor">
              {q.actor_key?.slice(0, 10)}…
              {q.repeat_offender && <i className="pq-repeat" title="Repeat refuser">↻</i>}
            </span>
            <span className="pq-pat">{q.reason}{q.state ? ` · ${q.state}` : ''}</span>
            <span className="pq-num">{fmt(q.orders)} · {fmt(q.returns)}{q.return_pct != null ? ` (${q.return_pct}%)` : ''}</span>
            <span className={`pq-score s${q.score >= 85 ? '3' : q.score >= 50 ? '2' : '1'}`}>{q.score}</span>
            <span className="pq-claim" title={q.template}>{q.template}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

// Static AI insights
// titleChip: { text, cls } renders an inline delta-chip INSIDE the title (matches design)
const INSIGHTS = [
  {
    hero: true,
    tag: 'Priority insight · auto-detected',
    title1: 'Meesho returns spiked ', titleEm: '34%', title2: ' on Kurta-XL — driven by sizing complaints in Tier-2 cities.',
    body: 'SKU KTR-024-XL shows 41% return rate last 14d (vs 18% baseline). Pattern correlates with new size-chart push on Aug 4. Tagging 3 similar SKUs as at-risk.',
    chips: [
      { dot:'#F43397', text:'Meesho' }, { dot:'#EC2D6E', text:'Apparel · Kurta' },
      { dot:'#C77F2B', text:'Sizing complaints 62%' }, { dot:null, text:'est. impact', bold:'−₹84,200' },
    ],
    time: 'Detected 36 min ago · model v2.4', cta: 'Investigate',
  },
  { tag:'Pricing · Amazon', tagCls:'amber',
    title:'FBA referral fee on Beauty up', titleChip:{ text:'+1.5pp', cls:'amber' },
    body:'New rate 17.5% from Aug 15 affects 184 SKUs. Margin erosion est. −₹62K/mo at current volumes.',
    time:'4h ago', cta:'Re-price' },
  { tag:'Opportunity', tagCls:'emerald',
    title:'Flipkart RTO trending down — buffer freed', titleChip:{ text:'−1.8pp', cls:'up' },
    body:'COD-block tags cut wasted dispatches. You can raise ad spend ceiling by ~₹40K/wk without breaking unit econ.',
    time:'9h ago', cta:'Open scenario' },
  { tag:'Stock risk', tagCls:'danger',
    title:'12 SKUs will stock-out within 7 days at current velocity',
    body:'Top risk: DNM-Slim-32 across all channels. Reorder lead-time exceeds runway by 3.4 days.',
    time:'1d ago', cta:'Reorder' },
]

// Static KPI sparkline paths (decorative — same as design)
const SPARKS = [
  'M2 18 L10 14 L18 16 L26 11 L34 13 L42 8 L50 10 L62 4',
  'M2 14 L10 16 L18 12 L26 14 L34 10 L42 12 L50 8 L62 6',
  'M2 16 L10 13 L18 15 L26 10 L34 12 L42 7 L50 9 L62 3',
  null, // orders uses bars
  'M2 6 L10 10 L18 8 L26 12 L34 11 L42 14 L50 16 L62 18',
  'M2 14 L10 12 L18 13 L26 10 L34 11 L42 8 L50 7 L62 5',
]

// ── Components ─────────────────────────────────────────────────────────────
function PlatMk({ name, size = 34 }) {
  const c = cfg(name)
  return (
    <div className={`pf-mk ${name?.toLowerCase()}`} style={{
      width: size, height: size, borderRadius: 9,
      background: c.color, color: c.textColor,
      fontStyle: c.italic ? 'italic' : 'normal',
      fontSize: size * 0.41, flexShrink: 0,
    }}>{c.short}</div>
  )
}

function DeltaChip({ val, invert }) {
  if (val == null) return null
  const up = val >= 0
  const good = invert ? !up : up
  return <span className={`delta-chip ${good ? 'up' : 'down'}`}>{up ? '▲' : '▼'} {Math.abs(val).toFixed(1)}%</span>
}

// ── Chart tooltip ─────────────────────────────────────────────────────────
const WEEK_MON = { W1:'Mar',W2:'Mar',W3:'Apr',W4:'Apr',W5:'May',W6:'May',W7:'Jun',W8:'Jun',W9:'Jul',W10:'Jul',W11:'Aug',W12:'Aug' }
function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const total = payload.reduce((s, p) => s + (p.value || 0), 0)
  return (
    <div style={{
      background:'#0E0E10', color:'#fff', borderRadius:10, padding:'9px 14px',
      fontFamily:'Geist,sans-serif', boxShadow:'0 8px 24px rgba(0,0,0,.3)',
      minWidth:130, pointerEvents:'none',
    }}>
      <div style={{ color:'rgba(255,255,255,.45)', fontSize:11, marginBottom:4 }}>
        {label} · {WEEK_MON[label] ?? ''}
      </div>
      <div style={{ fontSize:20, fontWeight:700, letterSpacing:'-0.03em', lineHeight:1 }}>
        {fmtL(total)}
        <span style={{ fontSize:12, fontWeight:500, color:'rgba(255,255,255,.5)', marginLeft:4 }}>total</span>
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────
export default function Dashboard() {
  const [dash,      setDash]      = useState(null)
  const [skus,      setSkus]      = useState([])
  const [actors,    setActors]    = useState([])
  const [insights,  setInsights]  = useState([])
  const [metrics,   setMetrics]   = useState([])
  const [skuIntel,  setSkuIntel]  = useState(null)
  const [recon,     setRecon]     = useState(null)
  const [pipeline,  setPipeline]  = useState(null)
  const [loading,   setLoading]   = useState(true)
  const [selChan,   setSelChan]   = useState('all')
  const [activeKpi, setActiveKpi] = useState(2)  // margin active by default
  const [viewMode,  setViewMode]  = useState('consolidated') // consolidated | per-company
  const [perfMetric,setPerfMetric]= useState('Revenue')

  useEffect(() => {
    Promise.all([
      getPnlDashboard(),
      getSkus(),
      api.get('/fraud/actors').then(r => r.data?.actors ?? []).catch(() => []),
      api.get('/dashboard/insights').then(r => r.data?.insights ?? []).catch(() => []),
      api.get('/dashboard/metrics').then(r => r.data?.metrics ?? []).catch(() => []),
      api.get('/dashboard/sku-intelligence').then(r => r.data ?? null).catch(() => null),
      api.get('/dashboard/reconciliation').then(r => r.data ?? null).catch(() => null),
      api.get('/dashboard/action-pipeline').then(r => r.data ?? null).catch(() => null),
    ])
      .then(([d, s, a, ins, met, intel, rec, pipe]) => {
        setDash(d); setSkus(s ?? []); setActors(a); setInsights(ins); setMetrics(met); setSkuIntel(intel)
        setRecon(rec); setPipeline(pipe)
      })
      .finally(() => setLoading(false))
  }, [])

  if (loading) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'60vh' }}>
      <div className="loader" style={{ width:28, height:28 }} />
    </div>
  )

  // ── Derived ───────────────────────────────────────────────────────────────
  const platforms = (dash?.platforms ?? []).map(p => ({
    ...p, ...cfg(p.platform_name), name: p.platform_name, rev: p.bank_settlement,
  }))
  const totalRev   = dash?.total_bank_settlement ?? 0
  const totalGross = dash?.total_gross_sales      ?? 0
  const totalEarn  = dash?.total_net_earnings     ?? 0
  const totalUnits = platforms.reduce((s, p) => s + (p.gross_units ?? 0), 0)
  const netUnits   = platforms.reduce((s, p) => s + (p.net_units   ?? 0), 0)
  const marginPct  = totalGross > 0 ? (totalEarn / totalGross) * 100 : 0
  const skuCount   = skus.length

  // ── SKU Intelligence rows (real data from /dashboard/sku-intelligence) ──────
  const SKU_STATUS = {
    profit:  { label: 'Performing',  cls: 'badge-green' },
    thin:    { label: 'Thin margin', cls: 'badge-amber' },
    loss:    { label: 'Below cost',  cls: 'badge-red'   },
    no_cost: { label: 'No data',     cls: 'badge-muted' },
  }
  const SKU_CHIPS = ['sku-chip-teal','sku-chip-blue','sku-chip-purple','sku-chip-orange','sku-chip-clay','sku-chip-ink']
  const fmtRev = (n) => n >= 100000 ? `₹${(n/100000).toFixed(1)}L`
                     : n >= 1000   ? `₹${(n/1000).toFixed(1)}K`
                     : `₹${Math.round(n || 0)}`
  const skuRows = (skuIntel?.all_skus ?? []).slice(0, 7).map(r => {
    const stat = SKU_STATUS[r.status] || SKU_STATUS.no_cost
    const segs = String(r.sku || '').split('-').filter(Boolean)
    const code = (segs[segs.length - 1] || r.sku || '').slice(0, 3).toUpperCase()
    const idx = (code.charCodeAt(0) + code.charCodeAt(code.length - 1)) % SKU_CHIPS.length
    const ret = Math.round((r.return_rate ?? 0) * 10) / 10
    return {
      code, codeCls: SKU_CHIPS[idx],
      name: r.sku, sub: `${r.sku} · Jewellery`,
      co: 'Shringar', coCls: 'co-nova',
      plats: (r.platforms || []).map(p => String(p).toLowerCase()),
      price: '—', priceOn: '',
      units: r.net_units,
      rev: fmtRev(r.payout),
      rto: ret, rtoBar: Math.min(100, ret * 2),
      ret, margin: r.margin_pct ?? 0,
      marginCls: (r.margin_pct ?? 0) > 0 ? 'mg-green' : '',
      status: stat.label, statusCls: stat.cls,
    }
  })

  // monthly → chart rows
  const months   = dash?.monthly ? [...new Set(dash.monthly.map(m => m.month))].sort() : []

  // spark values per platform (for co-card micro SVG)
  const sparkFor = pname => months.map(mo => {
    const m = (dash?.monthly ?? []).find(x => x.month === mo && x.platform_name?.toLowerCase() === pname?.toLowerCase())
    return m ? m.bank_settlement : 0
  })

  // Smooth catmull-rom → cubic bezier sparkline path
  const smoothPath = (vals, W = 82, H = 28) => {
    if (!vals || vals.length < 2) return { d: '', area: '' }
    const min = Math.min(...vals), max = Math.max(...vals), r = max - min || 1
    const pts = vals.map((v, i) => [
      (i / (vals.length - 1)) * W,
      H - 3 - ((v - min) / r) * (H - 7)
    ])
    let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)]
      const p1 = pts[i], p2 = pts[i + 1]
      const p3 = pts[Math.min(pts.length - 1, i + 2)]
      const cp1x = p1[0] + (p2[0] - p0[0]) / 6
      const cp1y = p1[1] + (p2[1] - p0[1]) / 6
      const cp2x = p2[0] - (p3[0] - p1[0]) / 6
      const cp2y = p2[1] - (p3[1] - p1[1]) / 6
      d += ` C${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`
    }
    return { d, area: `${d} L${W},${H} L0,${H} Z` }
  }

  // Demo sparks per platform (used when real data < 4 months)
  const SPARK_DEMO = {
    flipkart: [62, 68, 65, 76, 70, 84, 79, 91, 86, 95],
    meesho:   [38, 44, 41, 52, 56, 50, 62, 59, 68, 72],
    snapdeal: [28, 33, 30, 40, 37, 44, 42, 50, 46, 54],
    amazon:   [55, 60, 67, 63, 72, 68, 76, 82, 79, 88],
    shopdeck: [22, 30, 27, 36, 32, 41, 38, 46, 43, 50],
  }

  // Channel filter
  const visible = selChan === 'all' ? platforms : platforms.filter(p => p.name?.toLowerCase() === selChan)

  // Return rate from fraud actors (real data) — must be before KPI_DEFS
  const totalActorOrders  = actors.reduce((s, a) => s + (a.total_orders ?? 0), 0)
  const totalActorReturns = actors.reduce((s, a) => s + (a.return_count ?? 0), 0)
  const returnRatePct     = totalActorOrders > 0 ? ((totalActorReturns / totalActorOrders) * 100).toFixed(1) : null
  const criticalActors    = actors.filter(a => a.risk_tier === 'CRITICAL').length

  const hasRevData = totalRev > 0
  // chip: { text, cls } — only show when we have real data
  const KPI_DEFS = [
    { label: 'Net revenue',         val: fmtL(totalRev),            sub: null,  chip: hasRevData ? { text:'▲ 12.4%', cls:'up'  } : null, hint: hasRevData ? 'vs prev. 30d'            : 'no reports yet' },
    { label: 'GMV',                 val: fmtL(totalGross),          sub: null,  chip: hasRevData ? { text:'▲ 8.7%',  cls:'up'  } : null, hint: hasRevData ? `${fmt(totalUnits)} ords`  : 'upload P&L'      },
    { label: 'Contribution margin', val: hasRevData ? `${marginPct.toFixed(1)}` : '—', sub: hasRevData ? '%' : null, chip: hasRevData ? { text:'▲ 0.9pp', cls:'up' } : null, hint: hasRevData ? `${fmtK(totalEarn)} net` : 'no data yet' },
    { label: 'Orders',              val: hasRevData ? fmt(netUnits) : '—',      sub: null,  chip: hasRevData ? { text:'▲ 4.1%', cls:'up' } : null, hint: hasRevData ? `AOV ₹${totalUnits > 0 ? Math.round(totalRev/totalUnits) : 0}` : 'no orders yet' },
    { label: 'RTO rate',            val: '—',                       sub: null,  chip: null, hint: 'no logistics data' },
    { label: 'Return rate',         val: returnRatePct ? `${returnRatePct}` : '—', sub: returnRatePct ? '%' : null, chip: criticalActors > 0 ? { text:`${criticalActors} critical`, cls:'down' } : null, hint: returnRatePct ? `${totalActorOrders} orders tracked` : 'upload FK orders' },
  ]

  const maxRev = Math.max(...platforms.map(p => p.rev), 1)

  // Only real platforms — no fake channels
  const allChannels = platforms
  const maxRevAll   = Math.max(...allChannels.map(p => p.rev), 1)

  // Channel chart: use real monthly data if available, else static fallback
  const hasMonthlyData = (dash?.monthly ?? []).length > 0
  const WEEKLY_CHART = (() => {
    if (hasMonthlyData) {
      // Real monthly data — group by month, each platform is a key
      const byMonth = {}
      ;(dash.monthly ?? []).forEach(m => {
        const label = m.month?.slice(0, 7) ?? m.month // YYYY-MM
        if (!byMonth[label]) byMonth[label] = { week: label }
        byMonth[label][m.platform_name] = (m.bank_settlement ?? 0)
      })
      return Object.values(byMonth).sort((a, b) => a.week > b.week ? 1 : -1)
    }
    // Static fallback (demo data, only for platforms we actually have)
    const wks = Array.from({length:12}, (_,i) => `W${i+1}`)
    const STATIC = {
      Flipkart: [200,222,208,230,218,242,228,250,238,258,248,265],
      Meesho:   [ 80, 90, 84, 94, 88, 98, 92,102, 96,105,100,108],
      Snapdeal: [ 45, 50, 47, 52, 49, 55, 51, 57, 53, 59, 56, 62],
    }
    return wks.map((w, i) => {
      const row = { week: w }
      Object.entries(STATIC).forEach(([name, vals]) => { row[name] = vals[i] * 1000 })
      return row
    })
  })()

  return (
    <div className="pulse">

      {/* ── Subnav — Overview/Catalog/Orders/Returns/Finance/Insights ─── */}
      <nav className="pulse-subnav">
        {[
          { label:'Overview',      count:null,   active:true  },
          { label:'Catalog',       count:skuCount             },
          { label:'Orders',        count:fmt(netUnits)        },
          { label:'Returns & RTO', count:null                 },
          { label:'Finance',       count:null                 },
          { label:'Insights',      count:INSIGHTS.length      },
        ].map(tab => (
          <button key={tab.label} className={`sn-tab${tab.active?' active':''}`}>
            {tab.label === 'Overview' && (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight:4 }}>
                <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
                <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
              </svg>
            )}
            {tab.label}
            {tab.count != null && <span className="ct">{tab.count}</span>}
          </button>
        ))}
        <div className="sn-right">
          <button className="sn-customize">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93l-1.41 1.41M4.93 4.93l1.41 1.41M4.93 19.07l1.41-1.41M19.07 19.07l-1.41-1.41M12 2v2M12 20v2M2 12h2M20 12h2"/></svg>
            Customize
          </button>
        </div>
      </nav>

      {/* ── Page head ────────────────────────────────────────────────── */}
      <section className="page-head">
        <div className="title-block">
          <h1 className="pulse-h1">Multichannel <em>pulse</em></h1>
          <div className="pulse-meta">
            <span className="pulse-sync-dot" />
            {platforms.length} platform{platforms.length !== 1 ? 's' : ''} · {skuCount} SKUs tracked · {actors.length} actor profiles
            <span className="pulse-sep">·</span>
            Last sync 2m ago
          </div>
        </div>
        <div className="head-actions">
          {/* Consolidated / Per company toggle — matches design */}
          <div className="view-toggle">
            <button className={`vt-btn${viewMode==='consolidated'?' active':''}`} onClick={() => setViewMode('consolidated')}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
                <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
              </svg>
              Consolidated
            </button>
            <button className={`vt-btn${viewMode==='per-company'?' active':''}`} onClick={() => setViewMode('per-company')}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
              Per company
            </button>
          </div>
          <button className="p-pill">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            Last 30 days
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
          <button className="p-pill dark">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4v12M7 11l5 5 5-5M5 20h14"/></svg>
            Export
          </button>
        </div>
      </section>

      {/* ── Channel filter chips ──────────────────────────────────────── */}
      <div className="filter-row">
        <div className="channels">
          <span className={`ch-chip${selChan==='all'?' active':''}`} onClick={() => setSelChan('all')}>
            All channels <span className="ct">{allChannels.length}</span>
          </span>
          {allChannels.map(p => (
            <span key={p.name} className={`ch-chip${selChan===p.name?.toLowerCase()?' active':''}`}
              onClick={() => setSelChan(selChan===p.name?.toLowerCase()?'all':p.name?.toLowerCase())}>
              <span className="ch-dot" style={{ background: p.color }} />
              {p.name}
            </span>
          ))}
        </div>
        <span className="hint mono">view = consolidated · {platforms.length} cos · {selChan === 'all' ? 'all channels' : selChan} · 30d</span>
      </div>

      {/* ── AI Insights ───────────────────────────────────────────────── */}
      <section className="insights">
        {insights.length === 0 ? (
          /* Loading skeleton — same layout, muted content */
          <>
            <article className="insight hero" style={{ opacity: 0.45 }}>
              <div className="ins-head"><span className="tag"><span className="d" />Analyzing data…</span></div>
              <h3 className="ins-title">Loading real-time insights</h3>
              <p className="ins-body">Scanning fraud actors, return patterns and platform health…</p>
              <div className="ins-foot"><span>—</span><span className="go">—</span></div>
            </article>
          </>
        ) : (
          <>
            {/* Hero insight — first in list (always fraud spike or highest priority) */}
            {(() => {
              const ins = insights[0]
              return (
                <article className="insight hero">
                  <span className="ai-mk" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
                      <path d="M12 3l1.8 5.4L19 10l-5.2 1.6L12 17l-1.8-5.4L5 10l5.2-1.6z"/>
                      <path d="M19 17l.6 1.8L21 19l-1.4.6L19 21l-.6-1.4L17 19l1.4-.6z"/>
                    </svg>
                  </span>
                  <div className="ins-head">
                    <span className={`tag${ins.tag_cls ? ' ' + ins.tag_cls : ''}`}>
                      <span className="d" />{ins.tag}
                    </span>
                  </div>
                  {/* Hero supports split title: title1 + em + title2, or plain title */}
                  <h3 className="ins-title">
                    {ins.title1
                      ? <>{ins.title1}<em>{ins.title_em}</em>{ins.title2}</>
                      : ins.title
                    }
                  </h3>
                  <p className="ins-body">{ins.body}</p>
                  {ins.chips?.length > 0 && (
                    <div className="reason-chips">
                      {ins.chips.map((c, i) => (
                        <span key={i} className="rc">
                          {c.dot && <span className="d" style={{ background: c.dot }} />}
                          {c.text}{c.bold && <b style={{ color:'#fff', marginLeft:4 }}>{c.bold}</b>}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="ins-foot">
                    <span>{ins.time}</span>
                    <span className="go">{ins.cta} →</span>
                  </div>
                </article>
              )
            })()}

            {/* Supporting insights */}
            {insights.slice(1).map((ins, i) => (
              <article key={i} className="insight">
                <div className="ins-head">
                  <span className={`tag${ins.tag_cls ? ' ' + ins.tag_cls : ''}`}>
                    <span className="d" />{ins.tag}
                  </span>
                </div>
                <h3 className="ins-title">
                  {ins.title}
                  {ins.title_chip && (
                    <> <span className={`delta-chip ${ins.title_chip.cls}`}>{ins.title_chip.text}</span></>
                  )}
                </h3>
                <p className="ins-body">{ins.body}</p>
                <div className="ins-foot">
                  <span>{ins.time}</span>
                  <span className="go">{ins.cta} →</span>
                </div>
              </article>
            ))}
          </>
        )}
      </section>

      {/* ── Companies / Platform cards ─────────────────────────────────── */}
      <section>
        <div className="sec-head" style={{ marginBottom:12 }}>
          <div>
            <h2>Companies <span className="ct">{platforms.length} active</span></h2>
            <div className="sub">Standalone P&amp;L per legal entity · consolidated above</div>
          </div>
        </div>

        <div className="companies">

          {/* Aggregate dark card */}
          <article className="co-card aggregate">
            <div className="top">
              <span className="av" style={{ background:'linear-gradient(135deg,#FFD27A,#EC2D6E 50%,#7A5BFF)' }}>SH</span>
              <div>
                <div className="nm">Shringar House · Consolidated</div>
                <div className="sub">3 companies · 5 channels</div>
              </div>
            </div>
            <div className="big">
              {fmtLParts(totalRev)[0]}<span style={{ fontSize:18, color:'rgba(255,255,255,.55)', fontWeight:500 }}>{fmtLParts(totalRev)[1]}</span>
              <span className="delta-chip up">▲ {pct(totalEarn, totalGross)}</span>
            </div>
            <div className="mini-row">
              <div className="mn"><span className="l">Margin</span><span className="v">{pct(totalEarn, totalGross)}</span></div>
              <div className="mn"><span className="l">Orders</span><span className="v">{fmt(netUnits)}</span></div>
              <div className="mn"><span className="l">RTO</span><span className="v">—</span></div>
            </div>
          </article>

          {/* Per-platform cards — Margin / Orders / RTO labels matching design */}
          {(selChan === 'all' ? platforms : platforms.filter(p => p.name?.toLowerCase() === selChan)).map((p, i) => {
            const c      = cfg(p.name)
            const key    = p.name?.toLowerCase()
            const real   = sparkFor(p.name).filter(v => v > 0)
            const vals   = real.length >= 4 ? real : (SPARK_DEMO[key] || [])
            const { d, area } = smoothPath(vals)
            const margin = p.gross_sales > 0 ? ((p.net_earnings ?? 0) / p.gross_sales * 100).toFixed(1) + '%' : '—'
            return (
              <article key={i} className="co-card">
                {/* Rainbow ribbon */}
                <div className="ribbon" style={{ background:'linear-gradient(90deg,#2874F0,#FF9900,#F43397,#E40046,#7A5BFF)' }} />

                {/* Sparkline + platform dots — right column matching design */}
                {d && (
                  <div className="co-spark-col">
                    <svg className="co-micro" viewBox="0 0 82 28" preserveAspectRatio="none">
                      <defs>
                        <linearGradient id={`csg${i}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={c.color} stopOpacity="0.25"/>
                          <stop offset="100%" stopColor={c.color} stopOpacity="0"/>
                        </linearGradient>
                      </defs>
                      <path d={area} fill={`url(#csg${i})`}/>
                      <path d={d} fill="none" stroke={c.color} strokeWidth="1.6"
                            strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    <span className="chan">
                      {PLAT_KEYS.map(k => {
                        const pc = PLAT_CFG[k]
                        const active = k === key
                        return (
                          <span key={k} className={`pd${active ? '' : ' off'}`}
                            style={active ? { background: pc.color, color: pc.textColor, fontStyle: pc.italic ? 'italic' : 'normal' } : {}}
                          >{pc.short}</span>
                        )
                      })}
                    </span>
                  </div>
                )}

                <div className="top">
                  <span className="av" style={{ background: c.color, color: c.textColor, fontStyle: c.italic ? 'italic' : 'normal' }}>
                    {c.short}
                  </span>
                  <div>
                    <div className="nm">{p.name}</div>
                    <div className="sub">{p.report_count} report{p.report_count !== 1 ? 's' : ''} · {fmt(p.gross_units ?? 0)} units</div>
                  </div>
                </div>
                <div className="big">
                  {fmtLParts(p.rev)[0]}<span style={{ fontSize:16, color:'var(--muted-2)', fontWeight:500 }}>{fmtLParts(p.rev)[1]}</span>
                  <span style={{ fontSize:11, fontFamily:"'Geist Mono',monospace", color:'var(--muted-2)', fontWeight:600, alignSelf:'center' }}>{p.pct}%</span>
                </div>
                <div className="mini-row">
                  <div className="mn"><span className="l">Margin</span><span className="v">{margin}</span></div>
                  <div className="mn"><span className="l">Orders</span><span className="v">{fmt(p.net_units ?? 0)}</span></div>
                  <div className="mn"><span className="l">RTO</span><span className="v">—</span></div>
                </div>
              </article>
            )
          })}

        </div>
      </section>

      {/* ── KPI Strip ────────────────────────────────────────────────────── */}
      <section className="kpi-strip">
        {KPI_DEFS.map((k, i) => (
          <div key={i} className={`kpi${activeKpi === i ? ' active' : ''}`}
            data-idx={`0${i+1}/06`} onClick={() => setActiveKpi(i)}>
            <span className="k-lab">{k.label}</span>
            <span className="k-val">
              {k.val}
              {k.sub && <span className="sub">{k.sub}</span>}
            </span>
            <div className="k-row">
              {k.chip && <span className={`delta-chip ${k.chip.cls}`}>{k.chip.text}</span>}
              <span className="k-vs">{k.hint}</span>
            </div>
            {/* Inline SVG sparklines exactly like design */}
            {i === 3 ? (
              <svg className="k-spark" viewBox="0 0 64 22" preserveAspectRatio="none">
                <g fill="var(--muted-3)">
                  <rect x="2"  y="14" width="4" height="8"  rx="1"/>
                  <rect x="10" y="10" width="4" height="12" rx="1"/>
                  <rect x="18" y="12" width="4" height="10" rx="1"/>
                  <rect x="26" y="8"  width="4" height="14" rx="1"/>
                  <rect x="34" y="10" width="4" height="12" rx="1"/>
                  <rect x="42" y="6"  width="4" height="16" rx="1"/>
                  <rect x="50" y="4"  width="4" height="18" rx="1" fill="var(--ink)"/>
                  <rect x="58" y="3"  width="4" height="19" rx="1" fill="var(--ink)"/>
                </g>
              </svg>
            ) : SPARKS[i] ? (
              <svg className="k-spark" viewBox="0 0 64 22" preserveAspectRatio="none">
                {i === 2 && (
                  <defs>
                    <linearGradient id="kpiFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0" stopColor="#EC2D6E" stopOpacity=".4"/>
                      <stop offset="1" stopColor="#EC2D6E" stopOpacity="0"/>
                    </linearGradient>
                  </defs>
                )}
                {i === 2 && <path d="M2 16 L10 13 L18 15 L26 10 L34 12 L42 7 L50 9 L62 3 L62 22 L2 22 Z" fill="url(#kpiFill)"/>}
                <path d={SPARKS[i]} fill="none"
                  stroke={i===0 ? 'var(--emerald)' : i===2 ? 'var(--pink)' : i===4 ? 'var(--emerald)' : i===5 ? 'var(--danger)' : 'var(--ink-3)'}
                  strokeWidth={i===2 ? '1.6' : '1.4'} strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            ) : null}
          </div>
        ))}
      </section>

      {/* ── Metrics ribbon (dark) — real data ───────────────────────── */}
      <section className="metrics-ribbon">
        {metrics.map(cell => (
          <div key={cell.idx} className="mr-cell" data-idx={cell.idx}>
            <span className="l">
              {cell.dot && <span className="pd" style={{ background: cell.dot }} />}
              {cell.label}
            </span>
            <span className="v">
              {cell.val}<span className="u">{cell.unit}</span>
            </span>
            <span className={`d ${cell.trend_cls}`}>{cell.delta}</span>
            {cell.meter > 0 && (
              <div className="meter">
                <i className={cell.meter_cls || ''} style={{ width: `${cell.meter}%` }} />
              </div>
            )}
          </div>
        ))}
      </section>

      {/* ── Channel performance ──────────────────────────────────────── */}
      <section>
        <div className="sec-head">
          <div>
            <h2>Channel performance <span className="ct">last 12 weeks</span></h2>
            <div className="sub">Net revenue by channel · stacked. Tap a channel to drill in.</div>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
            <div className="perf-toggle">
              {['Revenue','Orders','Margin','RTO%'].map(t => (
                <button key={t} className={`pt-btn${perfMetric===t?' active':''}`} onClick={() => setPerfMetric(t)}>{t}</button>
              ))}
            </div>
            <label className="weekly-toggle">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              Weekly
            </label>
          </div>
        </div>

        <div className="perf-grid" style={{ marginTop:14 }}>

          {/* Left: stacked area chart — 5 channels, W1-W12 weekly */}
          <div className="card perf-chart-card">
            <div className="chart-wrap">
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={WEEKLY_CHART} margin={{ top:8, right:8, left:2, bottom:0 }}>
                  <defs>
                    {PLAT_KEYS.map(k => {
                      const p = allChannels.find(ch => ch.name?.toLowerCase() === k)
                      if (!p) return null
                      return (
                        <linearGradient key={p.name} id={`rc${p.name}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%"  stopColor={p.color} stopOpacity={0.9}/>
                          <stop offset="95%" stopColor={p.color} stopOpacity={0.65}/>
                        </linearGradient>
                      )
                    })}
                  </defs>
                  <CartesianGrid stroke="#ECE6DA" vertical={false}/>
                  <XAxis dataKey="week" tick={{ fontSize:10, fill:'#A8A39A', fontFamily:'Geist Mono,monospace' }} axisLine={false} tickLine={false}/>
                  <YAxis tick={{ fontSize:10, fill:'#A8A39A', fontFamily:'Geist Mono,monospace' }} axisLine={false} tickLine={false}
                    tickFormatter={v => v === 0 ? '₹0' : fmtL(v)} width={46}/>
                  <Tooltip
                    content={<ChartTooltip />}
                    cursor={{ stroke:'#0E0E10', strokeWidth:1, strokeDasharray:'4 3' }}
                  />
                  {PLAT_KEYS.map(k => {
                    const p = allChannels.find(ch => ch.name?.toLowerCase() === k)
                    if (!p) return null
                    return (
                      <Area key={p.name} type="monotone" dataKey={p.name} stackId="1"
                        stroke={p.color} strokeWidth={1.5} fill={`url(#rc${p.name})`}/>
                    )
                  })}
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="legend">
              {PLAT_KEYS.map(k => {
                const p = allChannels.find(ch => ch.name?.toLowerCase() === k)
                if (!p) return null
                return (
                  <span key={p.name} className="lg">
                    <span className="sw" style={{ background: p.color, borderRadius:'50%' }} />
                    <span className="nm">{p.name}</span> · {fmtL(p.rev)}
                  </span>
                )
              })}
            </div>
          </div>

          {/* Right: By channel panel — matches design exactly */}
          <div className="card by-channel">
            <div className="by-ch-head">
              <div>
                <span className="label">By channel</span>
                <span className="sub-label">Net of returns &amp; fees</span>
              </div>
              <span className="ct" style={{ fontSize:11, padding:'2px 8px' }}>30d</span>
            </div>
            <div className="breakdown">
              {[...allChannels].sort((a,b) => b.rev - a.rev).map(p => {
                const barW = Math.round((p.rev / maxRevAll) * 100)
                const rto  = p.rtoStatic != null ? p.rtoStatic.toFixed(1)
                           : (p.gross_units > 0 ? (((p.gross_units - (p.net_units ?? 0)) / p.gross_units) * 100).toFixed(1) : '—')
                return (
                  <div key={p.name} className="pf-row">
                    <PlatMk name={p.name} size={32} />
                    <div className="meta" style={{ flex:1 }}>
                      <div className="nm">{p.name === 'ShopDeck' ? 'ShopDeck (D2C)' : p.name}</div>
                      <div className="ndr">{fmt(p.net_units ?? 0)} ords <span className="sep">·</span> RTO {rto !== '—' ? rto + '%' : '—'}</div>
                    </div>
                    <div style={{ textAlign:'right', minWidth:62 }}>
                      <div className="rev">{fmtL(p.rev)}</div>
                      <div className="pct-label" style={{ color: barW > 50 ? 'var(--emerald)' : 'var(--muted)' }}>
                        {p.pct}%
                      </div>
                    </div>
                    <div className="bar"><i style={{ width:`${barW}%`, background: p.color }} /></div>
                  </div>
                )
              })}
            </div>
          </div>

        </div>
      </section>

      {/* ── Geographic intelligence ──────────────────────────────────── */}
      <section>
        <div className="sec-head" style={{ marginBottom:14 }}>
          <div>
            <h2>Geographic intelligence <span className="ct">India · live</span></h2>
            <div className="sub">State &amp; pincode heatmap across all channels. Switch the layer to reframe by metric.</div>
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <button className="p-pill">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
              India
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            <button className="p-pill" style={{ color:'var(--emerald)', borderColor:'rgba(31,169,104,.3)' }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3l1.8 5.4L19 10l-5.2 1.6L12 17l-1.8-5.4L5 10l5.2-1.6z"/>
                <path d="M19 17l.6 1.8L21 19l-1.4.6L19 21l-.6-1.4L17 19l1.4-.6z"/>
              </svg>
              Anomalies on
            </button>
          </div>
        </div>
        <IndiaMapCard />
      </section>

      {/* ── Pincode risk table ───────────────────────────────────────── */}
      <section>
        <div className="pc-table-wrap">
          <table className="pc-table">
            <thead>
              <tr>
                <th className="pc-th pc-th-rank">#</th>
                <th className="pc-th">PINCODE</th>
                <th className="pc-th">CITY · STATE</th>
                <th className="pc-th pc-th-num">ORDERS</th>
                <th className="pc-th pc-th-num">RTO%</th>
                <th className="pc-th pc-th-num">RETURNS</th>
                <th className="pc-th pc-th-num">FRAUD RISK</th>
              </tr>
            </thead>
            <tbody>
              {[
                { rank:1, pin:'700091', city:'Kolkata · Salt Lake',     state:'West Bengal',  orders:412,  rto:28.4, ret:7.1,  fraud:1.2,  risk:'Critical' },
                { rank:2, pin:'221005', city:'Varanasi · BHU',           state:'Uttar Pradesh',orders:218,  rto:24.8, ret:5.4,  fraud:0.9,  risk:'High'     },
                { rank:3, pin:'800001', city:'Patna · Central',          state:'Bihar',        orders:184,  rto:21.2, ret:4.8,  fraud:0.4,  risk:'High'     },
                { rank:4, pin:'110092', city:'Delhi · East Vinod Nagar', state:'Delhi NCT',    orders:562,  rto:14.6, ret:3.8,  fraud:0.3,  risk:'Watch'    },
                { rank:5, pin:'400070', city:'Mumbai · Kurla West',      state:'Maharashtra',  orders:684,  rto:8.2,  ret:3.1,  fraud:0.1,  risk:'Healthy'  },
                { rank:6, pin:'560037', city:'Bangalore · Marathahalli', state:'Karnataka',    orders:724,  rto:5.4,  ret:2.8,  fraud:0.04, risk:'Healthy'  },
                { rank:7, pin:'500032', city:'Hyderabad · Gachibowli',   state:'Telangana',    orders:488,  rto:6.1,  ret:3.4,  fraud:0.08, risk:'Healthy'  },
              ].map(r => {
                const riskCls = { Critical:'risk-critical', High:'risk-high', Watch:'risk-watch', Healthy:'risk-healthy' }[r.risk]
                const rtoCls  = r.rto > 20 ? 'rto-crit' : r.rto > 14 ? 'rto-high' : r.rto > 8 ? 'rto-warn' : 'rto-ok'
                return (
                  <tr key={r.pin} className="pc-row">
                    <td className="pc-td pc-td-rank">{String(r.rank).padStart(2,'0')}</td>
                    <td className="pc-td pc-td-pin">{r.pin}</td>
                    <td className="pc-td">
                      <div className="pc-city">{r.city}</div>
                      <div className="pc-state">{r.state}</div>
                    </td>
                    <td className="pc-td pc-td-num">{fmt(r.orders)}</td>
                    <td className={`pc-td pc-td-num ${rtoCls}`}>{r.rto}%</td>
                    <td className="pc-td pc-td-num pc-ret">{r.ret}%</td>
                    <td className="pc-td pc-td-num">
                      <span className={`pc-fraud-val ${rtoCls}`}>{r.fraud}%</span>
                      <span className={`pc-risk-badge ${riskCls}`}>● {r.risk}</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── SKU intelligence ─────────────────────────────────────────── */}
      <section>
        <div className="sku-int-head">
          <div className="sku-int-left">
            <span className="sku-int-title">SKU intelligence</span>
            <span className="ct">2,184 tracked</span>
          </div>
          <div className="sku-int-right">
            <button className="p-pill">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="10" y1="18" x2="14" y2="18"/></svg>
              Filters · 2
            </button>
            <div className="sku-int-tabs">
              {['All','Top sellers','High RTO','Stock-out risk','Price drift'].map((t,i) => (
                <button key={t} className={`sku-int-tab${i===0?' active':''}`}>{t}</button>
              ))}
            </div>
            <button className="sku-add-btn">+ Add SKU</button>
          </div>
        </div>

        <div className="sku-int-table-wrap">
          <table className="sku-int-table">
            <thead>
              <tr>
                <th className="si-th">SKU</th>
                <th className="si-th">LISTED ON</th>
                <th className="si-th si-th-r">BEST PRICE</th>
                <th className="si-th si-th-r">UNITS (30D)</th>
                <th className="si-th si-th-r">NET REVENUE</th>
                <th className="si-th si-th-r">RTO%</th>
                <th className="si-th si-th-r">RETURN%</th>
                <th className="si-th si-th-r">MARGIN</th>
                <th className="si-th">STATUS</th>
                <th className="si-th si-th-act"></th>
              </tr>
            </thead>
            <tbody>
              {skuRows.map(s => (
                <tr key={s.code} className="si-row">
                  <td className="si-td">
                    <div className="si-sku-cell">
                      <span className={`si-code-chip ${s.codeCls}`}>{s.code}</span>
                      <div>
                        <div className="si-name">{s.name}</div>
                        <div className="si-sub-row">
                          {s.sub && <span className="si-sub">{s.sub}</span>}
                          {s.co && <span className={`si-co-tag ${s.coCls}`}>📦 {s.co}</span>}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="si-td">
                    <div className="si-plats">
                      {PLAT_KEYS.map(p => {
                        const c   = cfg(p)
                        const act = s.plats.includes(p)
                        return (
                          <span key={p} className={`si-plat-chip${act ? '' : ' si-plat-off'}`}
                            style={act ? { background: c.color, color: c.textColor, fontStyle: c.italic ? 'italic' : 'normal' } : {}}>
                            {c.short}
                          </span>
                        )
                      })}
                    </div>
                  </td>
                  <td className="si-td si-td-r">
                    <span className="si-price">{s.price}</span>
                    <span className="si-price-on"> on {s.priceOn}</span>
                  </td>
                  <td className="si-td si-td-r si-units">{fmt(s.units)}</td>
                  <td className="si-td si-td-r si-rev">{s.rev}</td>
                  <td className="si-td si-td-r">
                    <div className="si-rto-cell">
                      <div className="si-rto-bar-track">
                        <div className="si-rto-bar-fill" style={{ width:`${Math.min(s.rtoBar,100)}%`, background: s.rto > 25 ? '#E04060' : s.rto > 12 ? '#C87030' : '#A8A39A' }} />
                      </div>
                      <span className={`si-rto-val ${s.rto > 25 ? 'rto-crit' : s.rto > 12 ? 'rto-high' : ''}`}>{s.rto}%</span>
                    </div>
                  </td>
                  <td className="si-td si-td-r si-ret">{s.ret}%</td>
                  <td className={`si-td si-td-r si-margin ${s.marginCls}`}>{s.margin}%</td>
                  <td className="si-td">
                    <span className={`si-status-badge ${s.statusCls}`}>● {s.status}</span>
                  </td>
                  <td className="si-td si-td-act">
                    <button className="si-more-btn">···</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {/* Pagination footer */}
          <div className="si-pagination">
            <span className="si-pg-count">Showing {skuRows.length} of {skuIntel?.summary?.total_skus ?? 0} SKUs</span>
            <div className="si-pg-nav">
              <button className="si-pg-btn" disabled>‹</button>
              <span className="si-pg-info">1 / {Math.max(1, Math.ceil((skuIntel?.summary?.total_skus ?? 0) / 7))}</span>
              <button className="si-pg-btn">›</button>
            </div>
          </div>
        </div>
      </section>

      {/* ── Settlement reconciliation (real /dashboard/reconciliation) ── */}
      <SettlementRecon recon={recon} />

      {/* ── Fraud action pipeline (real /dashboard/action-pipeline) ───── */}
      <FraudPipeline pipeline={pipeline} />

      {/* ── Reports drill-down ──────────────────────────────────────── */}
      <section className="reports-section">
        <div className="sec-head" style={{ marginBottom:16 }}>
          <div>
            <h2>Reports <span className="ct">drill-down</span></h2>
            <div className="sub">Breakdowns for orders, RTO, fees and returns across all channels.</div>
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <button className="p-pill">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              CSV
            </button>
            <button className="p-pill">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              Schedule
            </button>
          </div>
        </div>

        <div className="reports-grid">

          {/* ── Left column ── */}
          <div className="reports-left">

            {/* Order funnel */}
            <div className="card rpt-card">
              <div className="rpt-tabs">
                {[
                  { label:'Orders', count:'8,632', active:true },
                  { label:'RTO',    count:'1,018' },
                  { label:'Returns',count:'412'   },
                  { label:'Cancellations', count:'198' },
                ].map(t => (
                  <button key={t.label} className={`rpt-tab${t.active?' active':''}`}>
                    {t.label} <span className="rpt-tab-ct">{t.count}</span>
                  </button>
                ))}
              </div>
              <div className="funnel-rows">
                {[
                  { label:'Orders placed',    val:8632, pct:100,  cls:'bar-gray'  },
                  { label:'Confirmed',        val:8322, pct:96.4, cls:'bar-black' },
                  { label:'Shipped',          val:8004, pct:92.7, cls:'bar-green' },
                  { label:'Delivered',        val:6786, pct:78.6, cls:'bar-teal'  },
                  { label:'RTO',              val:1018, pct:11.8, cls:'bar-red'   },
                  { label:'Customer returns', val:412,  pct:4.8,  cls:'bar-amber' },
                  { label:'Net delivered',    val:6374, pct:73.8, cls:'bar-pink'  },
                ].map(r => (
                  <div key={r.label} className="funnel-row">
                    <span className="funnel-label">{r.label}</span>
                    <div className="funnel-track">
                      <div className={`funnel-bar ${r.cls}`} style={{ width:`${r.pct}%` }} />
                    </div>
                    <span className="funnel-val">{r.val.toLocaleString('en-IN')}</span>
                    <span className="funnel-pct">{r.pct}%</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Fees & charges breakdown */}
            <div className="card rpt-card" style={{ marginTop:14 }}>
              <div className="fees-head">
                <div>
                  <div className="fees-title">Fees &amp; charges breakdown</div>
                  <div className="fees-sub">From GMV to bank settlement · last 30d</div>
                </div>
                <div className="fees-tabs">
                  {['All','Flipkart','Amazon','Meesho'].map((t,i) => (
                    <button key={t} className={`fees-tab${i===0?' active':''}`}>{t}</button>
                  ))}
                </div>
              </div>
              <div className="fees-rows">
                {[
                  { dot:'pos', label:'Gross sales (GMV)',     val:'₹52,14,820',  pct:100, cls:'bar-black' },
                  { dot:'neg', label:'Commission',            val:'−₹12,51,560', pct:24,  cls:'bar-red'   },
                  { dot:'neg', label:'Closing / fixed fee',   val:'−₹3,12,890',  pct:6,   cls:'bar-red'   },
                  { dot:'neg', label:'Shipping & logistics',  val:'−₹6,25,780',  pct:12,  cls:'bar-red'   },
                  { dot:'neg', label:'Storage (FBA / FBF)',   val:'−₹2,08,590',  pct:4,   cls:'bar-red'   },
                  { dot:'neg', label:'RTO charges',           val:'−₹2,60,740',  pct:5,   cls:'bar-red'   },
                  { dot:'neg', label:'Ads & promotion',       val:'−₹4,17,180',  pct:8,   cls:'bar-red'   },
                  { dot:'neg', label:'GST & TCS',             val:'−₹1,56,440',  pct:3,   cls:'bar-red'   },
                  { dot:'pos', label:'Net settlement',        val:'₹19,81,640',  pct:38,  cls:'bar-green', bold:true },
                ].map(r => (
                  <div key={r.label} className={`fees-row${r.bold?' fees-row-bold':''}`}>
                    <span className={`fees-dot fees-dot-${r.dot}`} />
                    <span className="fees-label">{r.label}</span>
                    <div className="fees-track">
                      <div className={`fees-bar ${r.cls}`} style={{ width:`${r.pct}%` }} />
                    </div>
                    <span className={`fees-val${r.bold?' fees-val-settle':r.dot==='neg'?' fees-val-neg':''}`}>{r.val}</span>
                  </div>
                ))}
              </div>
            </div>

          </div>{/* end reports-left */}

          {/* ── Right column ── */}
          <div className="reports-right">

            {/* RTO reasons donut */}
            <div className="card rpt-card">
              <div className="rto-reasons-head">
                <div>
                  <div className="rto-r-title">RTO reasons</div>
                  <div className="rto-r-sub">1,018 RTO events · 30d</div>
                </div>
                <span className="rto-r-rate">11.8%</span>
              </div>
              <div className="rto-donut-wrap">
                {/* SVG donut — r=35, C=219.91 */}
                <svg width="108" height="108" viewBox="0 0 108 108" style={{ flexShrink:0 }}>
                  <circle cx="54" cy="54" r="35" fill="none" stroke="#ECE6DA" strokeWidth="16"/>
                  <g transform="rotate(-90 54 54)">
                    {/* Customer not available 38% = 83.57 */}
                    <circle cx="54" cy="54" r="35" fill="none" stroke="#3B7CE8" strokeWidth="16"
                      strokeDasharray="83.6 136.3" strokeDashoffset="0"/>
                    {/* COD reject at door 24% = 52.78; offset=C-83.6=136.3 */}
                    <circle cx="54" cy="54" r="35" fill="none" stroke="#F43397" strokeWidth="16"
                      strokeDasharray="52.8 167.1" strokeDashoffset="136.3"/>
                    {/* Address incomplete 16% = 35.19; offset=C-83.6-52.8=83.5 */}
                    <circle cx="54" cy="54" r="35" fill="none" stroke="#FF9900" strokeWidth="16"
                      strokeDasharray="35.2 184.7" strokeDashoffset="83.5"/>
                    {/* Refused on delivery 12% = 26.39; offset=C-83.6-52.8-35.2=48.3 */}
                    <circle cx="54" cy="54" r="35" fill="none" stroke="#C43BCC" strokeWidth="16"
                      strokeDasharray="26.4 193.5" strokeDashoffset="48.3"/>
                    {/* Other / unknown 10% = 21.99; offset=C-83.6-52.8-35.2-26.4=21.9 */}
                    <circle cx="54" cy="54" r="35" fill="none" stroke="#A8A39A" strokeWidth="16"
                      strokeDasharray="22.0 197.9" strokeDashoffset="21.9"/>
                  </g>
                  <text x="54" y="49" textAnchor="middle" fontSize="13" fontWeight="700" fill="#1A1714" fontFamily="Geist,sans-serif">11.8%</text>
                  <text x="54" y="62" textAnchor="middle" fontSize="8.5" fill="#A8A39A" fontFamily="Geist,sans-serif">RTO RATE</text>
                </svg>
                <div className="rto-legend">
                  {[
                    { color:'#3B7CE8', label:'Customer not available', count:387, pct:38 },
                    { color:'#F43397', label:'COD reject at door',      count:244, pct:24 },
                    { color:'#FF9900', label:'Address incomplete',       count:163, pct:16 },
                    { color:'#C43BCC', label:'Refused on delivery',      count:122, pct:12 },
                    { color:'#A8A39A', label:'Other / unknown',          count:102, pct:10 },
                  ].map(l => (
                    <div key={l.label} className="rto-leg-row">
                      <span className="rto-leg-dot" style={{ background:l.color }} />
                      <span className="rto-leg-label">{l.label}</span>
                      <span className="rto-leg-count">{l.count}</span>
                      <span className="rto-leg-pct">{l.pct}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Customer returns by channel */}
            <div className="card rpt-card" style={{ marginTop:14 }}>
              <div className="cret-head">
                <div>
                  <div className="cret-title">Customer returns by channel</div>
                  <div className="cret-sub">412 returns · 30d</div>
                </div>
                <span className="cret-rate">4.8%</span>
              </div>
              <div className="cret-rows">
                {[
                  { mk:'flipkart', name:'Flipkart',  count:142, delta:-6,   flat:false, reasons:'Size · 41% · Quality · 22% · Wrong item · 14%' },
                  { mk:'amazon',   name:'Amazon',    count:98,  delta:-2,   flat:false, reasons:'Quality · 38% · Damaged · 21% · Size · 18%'     },
                  { mk:'meesho',   name:'Meesho',    count:114, delta:34,   flat:false, reasons:'Size · 62% · Quality · 18% · Color · 9%'        },
                  { mk:'snapdeal', name:'Snapdeal',  count:42,  delta:null, flat:true,  reasons:'Quality · 34% · Damaged · 28%'                  },
                  { mk:'shopdeck', name:'ShopDeck',  count:16,  delta:-12,  flat:false, reasons:'Color · 29% · Fit · 24%'                        },
                ].map(r => {
                  const c = cfg(r.mk)
                  return (
                    <div key={r.mk} className="cret-row">
                      <span className="cret-av" style={{ background:c.color, color:c.textColor, fontStyle:c.italic?'italic':'normal' }}>{c.short}</span>
                      <div className="cret-info">
                        <div className="cret-name">{r.name}</div>
                        <div className="cret-reasons">{r.reasons}</div>
                      </div>
                      <div className="cret-stat">
                        <span className="cret-count">{r.count}</span>
                        {r.flat
                          ? <span className="cret-flat">— flat</span>
                          : <span className={`cret-delta ${r.delta > 0 ? 'cret-up' : 'cret-down'}`}>
                              {r.delta > 0 ? '▲' : '▼'}{Math.abs(r.delta)}%
                            </span>
                        }
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

          </div>{/* end reports-right */}

        </div>{/* end reports-grid */}

        <div className="reports-footer">
          Data refreshed 2m ago · Pulled from Flipkart Seller API · Amazon SP-API · Meesho Supplier · Snapdeal Sellerzone · ShopDeck connector.
        </div>
      </section>

    </div>
  )
}
