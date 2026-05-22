import { useState } from 'react'
import { ComposableMap, Geographies, Geography, Marker } from 'react-simple-maps'
import './IndiaMapCard.css'

const INDIA_GEO = '/india_states.geojson'

const BASE = {
  Maharashtra: 4520, Delhi: 3890, Karnataka: 3240, 'Tamil Nadu': 2810,
  Gujarat: 2450, 'Uttar Pradesh': 2180, Rajasthan: 1850, 'West Bengal': 1740,
  'Andhra Pradesh': 1520, Telangana: 1380, 'Madhya Pradesh': 1240, Haryana: 1180,
  Kerala: 1050, Bihar: 940, Punjab: 870, Odisha: 760,
  Jharkhand: 620, Chhattisgarh: 540, Assam: 480,
  Uttarakhand: 420, 'Himachal Pradesh': 380, Goa: 310,
  'Jammu & Kashmir': 280, Tripura: 210, Manipur: 180,
  Meghalaya: 160, Nagaland: 140, 'Arunanchal Pradesh': 120,
  Mizoram: 95, Sikkim: 70,
}

const CR = {
  Maharashtra: 0.094, Delhi: 0.088, Karnataka: 0.072, 'Tamil Nadu': 0.067,
  Gujarat: 0.101, 'Uttar Pradesh': 0.156, Rajasthan: 0.134, 'West Bengal': 0.118,
  'Andhra Pradesh': 0.112, Telangana: 0.095, 'Madhya Pradesh': 0.128, Haryana: 0.118,
  Kerala: 0.081, Bihar: 0.162, Punjab: 0.109, Odisha: 0.108,
  Jharkhand: 0.138, Chhattisgarh: 0.122, Assam: 0.135, Uttarakhand: 0.096,
  'Himachal Pradesh': 0.079, Goa: 0.063, 'Jammu & Kashmir': 0.089,
  Tripura: 0.134, Manipur: 0.122, Meghalaya: 0.110, Nagaland: 0.098,
  'Arunanchal Pradesh': 0.094, Mizoram: 0.083, Sikkim: 0.071,
}

const RTO = {
  Maharashtra: 0.051, Delhi: 0.070, Karnataka: 0.059, 'Tamil Nadu': 0.057,
  Gujarat: 0.063, 'Uttar Pradesh': 0.113, Rajasthan: 0.088, 'West Bengal': 0.034,
  'Andhra Pradesh': 0.026, Telangana: 0.007, 'Madhya Pradesh': 0.041, Haryana: 0.025,
  Kerala: 0.008, Bihar: 0.050, Punjab: 0.026, Odisha: 0.020,
  Jharkhand: 0.036, Chhattisgarh: 0.024, Assam: 0.027, Uttarakhand: 0.022,
  'Himachal Pradesh': 0.013, Goa: 0.008, 'Jammu & Kashmir': 0.088,
  Tripura: 0.024, Manipur: 0.020, Meghalaya: 0.016, Nagaland: 0.016,
  'Arunanchal Pradesh': 0.014, Mizoram: 0.012, Sikkim: 0.010,
}

// Centroids for large states only — used for value labels
const CENTROIDS = {
  Maharashtra:      [76.1, 19.2], Karnataka:        [76.2, 14.5],
  'Tamil Nadu':     [78.7, 11.0], Gujarat:          [71.6, 22.3],
  'Uttar Pradesh':  [80.9, 27.0], Rajasthan:        [74.0, 26.5],
  'West Bengal':    [87.8, 23.5], 'Andhra Pradesh': [79.6, 15.9],
  Telangana:        [79.4, 17.8], 'Madhya Pradesh': [78.0, 23.5],
}

// Dummy SKU data — will be replaced with real API data
const SKU_DATA = [
  { id: 'B09X2WZ5K1', delivered: 892, returns:  67, rto:  34 },
  { id: 'B08N5WRWNW', delivered: 756, returns: 156, rto:  89 },
  { id: 'B07PQRS412', delivered: 634, returns:  48, rto:  28 },
  { id: 'B06LMNOP34', delivered: 521, returns:  89, rto:  67 },
  { id: 'B05GHIJK56', delivered: 489, returns: 234, rto:  45 },
  { id: 'B04CDEFG78', delivered: 445, returns:  56, rto: 123 },
  { id: 'B03YZAB901', delivered: 398, returns:  78, rto:  56 },
  { id: 'B02WXYZ234', delivered: 367, returns:  34, rto:  29 },
  { id: 'B01VWXY567', delivered: 312, returns:  98, rto:  78 },
  { id: 'B00UVWX890', delivered: 289, returns:  23, rto:  18 },
]

const ORDER_SCALE = { All: 1.0, Sep: 0.28, Oct: 0.37, Nov: 0.35 }
const MONTHS      = ['All', 'Sep', 'Oct', 'Nov']

const METRICS = [
  { key: 'delivered', label: 'Delivered', short: 'Del', color: '#EC2D6E' },
  { key: 'returns',   label: 'Returns',   short: 'Ret', color: '#EA7828' },
  { key: 'rto',       label: 'RTO',       short: 'RTO', color: '#7C58E6' },
]

function buildData(scale) {
  const out = {}
  for (const [s, base] of Object.entries(BASE)) {
    const total   = Math.round(base * scale)
    const returns = Math.round(total * (CR[s]  ?? 0.10))
    const rto     = Math.round(total * (RTO[s] ?? 0.05))
    out[s] = { total, delivered: total - returns - rto, returns, rto }
  }
  return out
}

const fmtN   = v => v.toLocaleString('en-IN')
const fmtPct = (v, t) => t ? `${(v / t * 100).toFixed(1)}%` : '0%'
const fmtSh  = v => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v)

export default function IndiaMapCard() {
  const [metric,   setMetric]   = useState('delivered')
  const [month,    setMonth]    = useState('All')
  const [hovered,  setHovered]  = useState(null)
  const [selected, setSelected] = useState('Maharashtra')

  const allData = buildData(ORDER_SCALE[month])
  const mc      = METRICS.find(m => m.key === metric)

  const stateVal = (s, k) => allData[s]?.[k ?? metric] ?? 0
  const top8     = Object.keys(BASE)
    .map(s => [s, stateVal(s)])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)

  const maxTotal = Object.values(allData).reduce((m, d) => Math.max(m, d.total), 0)

  const totals = METRICS.reduce((acc, m) => {
    acc[m.key] = Object.keys(BASE).reduce((s, st) => s + stateVal(st, m.key), 0)
    return acc
  }, {})
  const grandTotal = Object.keys(BASE).reduce((s, st) => s + (allData[st]?.total ?? 0), 0)

  // Top state per metric (for footer + overlay)
  const topByMetric = METRICS.map(m => {
    const [topState, topData] = Object.entries(allData)
      .sort((a, b) => b[1][m.key] - a[1][m.key])[0]
    return { ...m, topState, topVal: topData[m.key] }
  })

  // SKUs sorted by active metric
  const sortedSkus = [...SKU_DATA].sort((a, b) => b[mc.key] - a[mc.key])

  const maxVal = Math.max(...Object.keys(BASE).map(s => stateVal(s)), 1)

  const activeState = hovered || selected
  const panelData   = activeState ? allData[activeState] : null

  return (
    <div className="imc">

      {/* Header */}
      <div className="imc-head">
        <div>
          <div className="imc-eyebrow">Geo Insights</div>
          <div className="imc-title">Sales by State</div>
        </div>
        <div className="imc-head-controls">
          <select className="imc-month-sel" value={month} onChange={e => setMonth(e.target.value)}>
            {MONTHS.map(m => <option key={m}>{m}</option>)}
          </select>
          <div className="imc-tabs">
            {METRICS.map(m => (
              <button
                key={m.key}
                className={`imc-tab${metric === m.key ? ' on' : ''}`}
                style={metric === m.key ? { background: m.color } : {}}
                onClick={() => setMetric(m.key)}
              >{m.label}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="imc-body">

        {/* Map column: map + footer strip */}
        <div className="imc-map-col">
          <div className="imc-map">
            <ComposableMap
              projection="geoMercator"
              projectionConfig={{ scale: 800, center: [82.5, 23] }}
              width={520} height={520}
              style={{ width: '100%', height: '100%', filter: 'drop-shadow(0 0 1.5px rgba(160,155,150,0.5)) drop-shadow(0 6px 18px rgba(0,0,0,0.18))' }}
            >
              <Geographies geography={INDIA_GEO}>
                {({ geographies }) =>
                  geographies.map(geo => {
                    const name  = geo.properties.ST_NM
                    const isSel = name === selected
                    const isHov = name === hovered
                    const val      = stateVal(name)
                    const opacity  = val ? (0.15 + 0.85 * val / maxVal) : 0
                    const fill     = isSel ? mc.color : val ? mc.color : '#EDE8E1'
                    return (
                      <Geography
                        key={geo.rsmKey} geography={geo}
                        fill={fill}
                        fillOpacity={isSel ? 1 : isHov ? Math.min(1, opacity + 0.15) : opacity || 0.08}
                        stroke={isSel ? '#fff' : 'rgba(255,255,255,0.85)'}
                        strokeWidth={isSel ? 1.8 : 0.5}
                        onMouseEnter={() => setHovered(name)}
                        onMouseLeave={() => setHovered(null)}
                        onClick={() => setSelected(name)}
                        style={{
                          default: { outline: 'none', cursor: 'pointer' },
                          hover:   { outline: 'none' },
                          pressed: { outline: 'none' },
                        }}
                      />
                    )
                  })
                }
              </Geographies>

              {/* Value labels for major states */}
              {Object.entries(CENTROIDS).map(([name, [lon, lat]]) => {
                const val = stateVal(name)
                if (!val) return null
                return (
                  <Marker key={name} coordinates={[lon, lat]}>
                    <text textAnchor="middle" dominantBaseline="middle"
                      style={{
                        fontSize: 8.5, fontWeight: 700,
                        fill: 'rgba(255,255,255,0.95)',
                        fontFamily: 'var(--font-ui)',
                        pointerEvents: 'none',
                        textShadow: '0 1px 3px rgba(0,0,0,0.55)',
                      }}
                    >{fmtSh(val)}</text>
                  </Marker>
                )
              })}
            </ComposableMap>

            {/* Top-right overlay: #1 state per metric */}
            <div className="imc-map-overlay">
              <div className="imc-ov-title">Top Leaders</div>
              {topByMetric.map(m => (
                <div key={m.key} className="imc-ov-row" onClick={() => { setSelected(m.topState); setMetric(m.key) }}>
                  <span className="imc-ov-dot" style={{ background: m.color }} />
                  <span className="imc-ov-lbl">{m.short}</span>
                  <span className="imc-ov-state">{m.topState.split(' ')[0]}</span>
                  <span className="imc-ov-val" style={{ color: m.color }}>{fmtSh(m.topVal)}</span>
                </div>
              ))}
            </div>

            {/* 3-metric legend */}
            <div className="imc-legend">
              {[...METRICS].reverse().map(m => (
                <span key={m.key} className="imc-leg-item">
                  <span className="imc-leg-dot" style={{ background: m.color }} />
                  <span className="imc-leg-lbl">{m.label}</span>
                </span>
              ))}
            </div>
          </div>

          {/* Map footer: top state per metric */}
          <div className="imc-map-footer">
            {topByMetric.map(m => (
              <div key={m.key} className="imc-ft-cell"
                onClick={() => { setSelected(m.topState); setMetric(m.key) }}>
                <div className="imc-ft-badge" style={{ background: `${m.color}1a`, color: m.color }}>
                  #{1} {m.short}
                </div>
                <div className="imc-ft-name">{m.topState}</div>
                <div className="imc-ft-val" style={{ color: m.color }}>{fmtN(m.topVal)}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Right panel */}
        <div className="imc-panel">

          {/* National strip */}
          <div className="imc-national">
            <span className="imc-nat-lbl">National</span>
            <span className="imc-nat-total">{fmtN(grandTotal)}</span>
            {METRICS.map(m => (
              <span key={m.key} className="imc-nat-chip" style={{ color: m.color }}>
                {fmtSh(totals[m.key])} <span style={{ opacity: 0.7 }}>{fmtPct(totals[m.key], grandTotal)}</span>
              </span>
            ))}
          </div>

          {/* State detail — hover updates, click locks */}
          {panelData ? (
            <div className="imc-detail">
              <div className="imc-detail-name">{activeState}</div>
              <div className="imc-detail-total">{fmtN(panelData.total)} total orders</div>
              <div className="imc-detail-metrics">
                {METRICS.map(m => (
                  <div key={m.key} className={`imc-dm${metric === m.key ? ' imc-dm-active' : ''}`}
                    style={metric === m.key ? { borderColor: m.color, background: `${m.color}10` } : {}}>
                    <div className="imc-dm-dot" style={{ background: m.color }} />
                    <div className="imc-dm-body">
                      <div className="imc-dm-lbl">{m.label}</div>
                      <div className="imc-dm-val">{fmtN(panelData[m.key])}</div>
                      <div className="imc-dm-pct" style={{ color: m.color }}>{fmtPct(panelData[m.key], panelData.total)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="imc-detail" style={{ color: 'var(--text-2)', fontSize: 12, padding: '18px 18px 14px', fontFamily: 'var(--font-ui)' }}>
              Click any state on the map
            </div>
          )}

          {/* Top SKUs by active metric */}
          <div className="imc-list">
            <div className="imc-list-hdr">
              <span>Top SKUs</span>
              <div className="imc-list-hdr-cols">
                {METRICS.map(m => <span key={m.key} style={{ color: m.color }}>{m.short}</span>)}
              </div>
            </div>
            {sortedSkus.slice(0, 8).map((sku, i) => {
              const skuTotal = sku.delivered + sku.returns + sku.rto
              return (
                <div key={sku.id} className={`imc-row${metric === METRICS[0].key && i === 0 ? ' imc-row-sel' : ''}`}>
                  <span className="imc-rank">{i + 1}</span>
                  <span className="imc-sname imc-sku-id">{sku.id.slice(0, 10)}</span>
                  {METRICS.map(m => (
                    <div key={m.key} className="imc-scol">
                      <div className="imc-scol-val">{fmtSh(sku[m.key])}</div>
                      <div className="imc-scol-pct" style={{ color: m.color }}>{fmtPct(sku[m.key], skuTotal)}</div>
                    </div>
                  ))}
                </div>
              )
            })}
          </div>

        </div>
      </div>
    </div>
  )
}
