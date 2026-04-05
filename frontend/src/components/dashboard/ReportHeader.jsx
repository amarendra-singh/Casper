/**
 * ReportHeader — the top white card section of the dashboard
 * Matches the red-highlighted area in the reference screenshot exactly.
 *
 * Props:
 *   team       — array of { name, ini, color, rev, leads, kpi, w, l, pct }
 *   totalRev   — number  (PLUG-IN: sum bank_settlement from /api/v1/entries)
 *   prevRev    — number  (PLUG-IN: previous period total)
 *   revChange  — number  (PLUG-IN: % change)
 *   revDiff    — number  (PLUG-IN: absolute difference)
 *   totalSkus  — number  (PLUG-IN: real from /api/v1/skus)
 *   activeSkus — number  (PLUG-IN: real from /api/v1/skus filtered is_active)
 *   dateRange  — string  e.g. "Sep 1 – Nov 30, 2025"
 */

import { useNavigate } from 'react-router-dom'

// ── Avatar circle ────────────────────────────────────────────────────────────
function Av({ ini, color, size = 24 }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        background: color,
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: Math.floor(size * 0.36),
        fontWeight: 700,
        color: '#fff',
        flexShrink: 0,
        letterSpacing: '0.01em',
      }}
    >
      {ini}
    </div>
  )
}

// ── Icon SVGs ────────────────────────────────────────────────────────────────
const IconFilter = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <line x1="4" y1="6" x2="20" y2="6" /><line x1="8" y1="12" x2="16" y2="12" /><line x1="11" y1="18" x2="13" y2="18" />
  </svg>
)
const IconDownload = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
  </svg>
)
const IconShare = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
  </svg>
)

// ── Stat card base styles (shared) ──────────────────────────────────────────
const CARD_BASE = {
  borderRadius: 12,
  padding: '12px 14px',
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
  minWidth: 0,
  // height: '100%' makes all cards same height inside the grid
  height: '100%',
  boxSizing: 'border-box',
}

const LABEL_STYLE = {
  fontSize: 10,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.07em',
  marginBottom: 2,
}

// ── Stat card variants ───────────────────────────────────────────────────────
function StatCard({ label, value, sub, sub2, person, dark, highlight }) {

  // ── Dark card (Best deal) ──
  if (dark) return (
    <div style={{
      ...CARD_BASE,
      background: '#111110',
      boxShadow: '0 2px 12px rgba(0,0,0,0.18), 0 1px 3px rgba(0,0,0,0.12)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ ...LABEL_STYLE, color: 'rgba(255,255,255,0.3)' }}>{label}</span>
        <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: 12, lineHeight: 1 }}>☆</span>
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, color: '#fff', letterSpacing: '-0.03em', lineHeight: 1.1 }}>
        {value}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'auto', paddingTop: 4 }}>
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', fontWeight: 500 }}>{sub}</span>
        <span style={{ fontSize: 14, color: 'rgba(255,255,255,0.15)', lineHeight: 1 }}>›</span>
      </div>
    </div>
  )

  // ── Highlighted card (Value) ──
  if (highlight) return (
    <div style={{
      ...CARD_BASE,
      background: 'linear-gradient(145deg, #fff 50%, rgba(232,54,93,0.04))',
      border: '1.5px solid #E8365D',
      boxShadow: '0 0 0 3px rgba(232,54,93,0.08)',
    }}>
      <span style={{ ...LABEL_STYLE, color: '#A8A59F' }}>{label}</span>
      <div style={{ fontSize: 22, fontWeight: 800, color: '#E8365D', letterSpacing: '-0.03em', lineHeight: 1.1 }}>
        {value}
      </div>
      <span style={{ fontSize: 11, fontWeight: 600, color: '#16A34A', marginTop: 'auto', paddingTop: 2 }}>{sub}</span>
    </div>
  )

  // ── Plain white card (Top sales, Deals, Win rate) ──
  return (
    <div style={{
      ...CARD_BASE,
      background: '#fff',
      border: '1px solid #EBEBEB',
      boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
    }}>
      <span style={{ ...LABEL_STYLE, color: '#A8A59F' }}>{label}</span>
      <div style={{ fontSize: 22, fontWeight: 800, color: '#111110', letterSpacing: '-0.03em', lineHeight: 1.1 }}>
        {value}
      </div>
      {/* Person row (Top sales) */}
      {person && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'auto', paddingTop: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <Av ini={person.ini} color={person.color} size={18} />
            <span style={{ fontSize: 11, color: '#6B6866', fontWeight: 500 }}>{person.name}</span>
          </div>
          <span style={{ fontSize: 14, color: '#D4D2CE', lineHeight: 1 }}>›</span>
        </div>
      )}
      {/* Sub lines (Deals, Win rate) */}
      {sub && !person && (
        <span style={{ fontSize: 11, color: '#A8A59F', marginTop: 2 }}>{sub}</span>
      )}
      {sub2 && (
        <span style={{ fontSize: 11, fontWeight: 600, color: '#16A34A' }}>{sub2}</span>
      )}
    </div>
  )
}

// ── Main component ───────────────────────────────────────────────────────────
export default function ReportHeader({
  team       = [],
  totalRev   = 528976,
  prevRev    = 501641,
  revChange  = 7.9,
  revDiff    = 27335,
  totalSkus  = 2,
  activeSkus = 2,
  dateRange  = 'Sep 1 – Nov 30, 2025',
}) {
  const navigate   = useNavigate()
  const topPerson  = team[1] ?? { ini: 'RM', color: '#E8365D', name: 'Rohan' }
  const winRate    = totalSkus > 0 ? Math.round((activeSkus / totalSkus) * 100) : 44

  return (
    <div style={{
      background: '#fff',
      borderRadius: 16,
      border: '1px solid #EBEBEB',
      boxShadow: '0 1px 3px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.03)',
      padding: '18px 20px 20px',
      marginBottom: 16,
    }}>

      {/* ── Row 1: Avatar pills + action icons ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>

        {/* Avatar pills */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {/* + button */}
          <button style={{
            width: 32, height: 32, borderRadius: '50%',
            border: '1px solid #E0DDD6', background: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 16, color: '#A8A59F', cursor: 'pointer', flexShrink: 0,
          }}>+</button>

          {/* Each person as a pill */}
          {team.map((p, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '5px 10px 5px 6px',
              borderRadius: 99, border: '1px solid #EBEBEB', background: '#fff',
              cursor: 'pointer', transition: 'background 0.12s',
            }}
              onMouseEnter={e => e.currentTarget.style.background = '#F7F6F3'}
              onMouseLeave={e => e.currentTarget.style.background = '#fff'}
            >
              <Av ini={p.ini} color={p.color} size={22} />
              <span style={{ fontSize: 11, fontWeight: 600, color: '#6B6866', whiteSpace: 'nowrap' }}>
                {p.name.split(' ')[0]} {p.name.split(' ')[1]?.[0]}.
              </span>
            </div>
          ))}
        </div>

        {/* Action icon buttons */}
        <div style={{ display: 'flex', gap: 6 }}>
          {[<IconFilter />, <IconDownload />, <IconShare />].map((icon, i) => (
            <button key={i} style={{
              width: 32, height: 32, borderRadius: 8,
              border: '1px solid #E0DDD6', background: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#6B6866', cursor: 'pointer', transition: 'all 0.12s',
            }}
              onMouseEnter={e => { e.currentTarget.style.background = '#F7F6F3'; e.currentTarget.style.color = '#111110' }}
              onMouseLeave={e => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.color = '#6B6866' }}
            >
              {icon}
            </button>
          ))}
        </div>
      </div>

      {/* ── Row 2: "New report" title + Timeframe toggle ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h1 style={{
          fontSize: 38, fontWeight: 700, letterSpacing: '-0.04em',
          color: '#E0DDD6', lineHeight: 1, userSelect: 'none',
          fontFamily: 'var(--font-ui)',
        }}>
          New report
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 500, color: '#6B6866' }}>
            <div style={{
              width: 36, height: 20, borderRadius: 99, background: '#E8365D',
              position: 'relative', flexShrink: 0, cursor: 'pointer',
            }}>
              <div style={{
                position: 'absolute', right: 3, top: 3,
                width: 14, height: 14, borderRadius: '50%', background: '#fff',
                boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
              }} />
            </div>
            Timeframe
          </div>
          {/* Date range button */}
          <button style={{
            fontSize: 12, fontWeight: 600, color: '#111110',
            background: '#fff', border: '1px solid #E0DDD6',
            borderRadius: 8, padding: '6px 12px', cursor: 'pointer',
            fontFamily: 'var(--font-ui)',
          }}>
            {dateRange} ▾
          </button>
        </div>
      </div>

      {/* ── Row 3: Revenue hero (left) + 5 Stat cards (right) ── */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'stretch' }}>

        {/* Revenue section */}
        <div style={{ flexShrink: 0, width: 280 }}>
          {/* Label */}
          <div style={{
            fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
            letterSpacing: '0.1em', color: '#A8A59F', marginBottom: 6,
          }}>
            Revenue
          </div>
          {/* Big number */}
          {/* PLUG-IN: totalRev from sum(bank_settlement) in /api/v1/entries */}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 5 }}>
            <span style={{
              fontSize: 40, fontWeight: 800, letterSpacing: '-0.04em',
              color: '#111110', lineHeight: 1, fontFamily: 'var(--font-ui)',
            }}>
              ₹{totalRev.toLocaleString('en-IN')}
              {/* .82 = paise/decimal portion — PLUG-IN: real decimal from entries */}
              <span style={{ fontSize: 24, color: '#6B6866' }}>.82</span>
            </span>
            {/* +% badge */}
            <span style={{
              display: 'inline-flex', alignItems: 'center',
              padding: '2px 8px', borderRadius: 99,
              fontSize: 11, fontWeight: 700,
              background: '#DCFCE7', color: '#166534',
            }}>
              ↑ {revChange}%
            </span>
            {/* +amount badge */}
            <span style={{
              display: 'inline-flex', alignItems: 'center',
              padding: '2px 8px', borderRadius: 99,
              fontSize: 11, fontWeight: 700,
              background: '#FEE2E2', color: '#991B1B',
            }}>
              +₹{revDiff.toLocaleString('en-IN')}
            </span>
          </div>
          {/* vs prev */}
          <div style={{ fontSize: 11, color: '#A8A59F' }}>
            vs prev. ₹{prevRev.toLocaleString('en-IN')} &nbsp;·&nbsp; {dateRange.replace('2025', '2024')} ↓
          </div>
        </div>

        {/* Vertical divider */}
        <div style={{ width: 1, background: '#F0EEEA', flexShrink: 0, alignSelf: 'stretch' }} />

        {/* 5 Stat cards — alignItems:stretch makes all cards same height */}
        <div style={{
          flex: 1, display: 'grid',
          gridTemplateColumns: 'repeat(5, 1fr)',
          gap: 8, minWidth: 0,
          alignItems: 'stretch',
        }}>
          {/* Top sales — PLUG-IN: person with most total from /api/v1/entries */}
          <StatCard
            label="Top sales"
            value={team[0]?.leads + team[1]?.leads || 95}
            person={{ ini: topPerson.ini, color: topPerson.color, name: topPerson.name.split(' ')[0] }}
          />

          {/* Best deal — PLUG-IN: max price entry from /api/v1/entries */}
          <StatCard
            label="Best deal"
            value="₹12,400"
            sub="Flipkart"
            dark
          />

          {/* Deals — PLUG-IN: count from /api/v1/entries */}
          <StatCard
            label="Deals"
            value={totalSkus}
            sub="↓ 5"
            sub2="↑ 7.9%"
          />

          {/* Value — PLUG-IN: total from sum(bank_settlement) */}
          <StatCard
            label="Value"
            value={`₹${Math.floor(totalRev / 1000)}k`}
            sub="↑ 7.9%"
            highlight
          />

          {/* Win rate — PLUG-IN: % profitable from /api/v1/entries */}
          <StatCard
            label="Win rate"
            value={`${winRate}%`}
            sub2="↑ 1.2%"
          />
        </div>
      </div>

    </div>
  )
}
