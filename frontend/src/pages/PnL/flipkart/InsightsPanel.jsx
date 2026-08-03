import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { fmt, fmtN } from './utils'
import { Undo, XMark, Check, Warn } from './glyphs'

/**
 * Insights tab — KPIs, variance bar chart, waterfall, return analysis, margin distribution.
 */
export default function InsightsPanel({ report, insightsData }) {
  if (!insightsData) return null

  return (
    <div className="pnl-body pnl-insights-body pnl-animate-in">
      <div className="ins-grid">

        <KpiRow data={insightsData} />

        <div className="ins-two-col">
          <VarianceChart data={insightsData} />
          <WaterfallPanel report={report} data={insightsData} />
        </div>

        <div className="ins-two-col">
          <ReturnAnalysis report={report} data={insightsData} />
          <MarginDistribution report={report} data={insightsData} />
        </div>

      </div>
    </div>
  )
}

// ── Sub-panels ───────────────────────────────────────────────────────────────

function KpiRow({ data }) {
  return (
    <div className="ins-kpis">
      <div className="ins-kpi">
        <div className="ins-kpi-label">Flipkart Settlement</div>
        <div className="ins-kpi-val gold">{fmt(data.totalActualBS)}</div>
        <div className="ins-kpi-sub">{data.beatingCount + data.missingCount} matched SKUs</div>
      </div>
      <div className="ins-kpi">
        <div className="ins-kpi-label">Your Target Settlement</div>
        <div className="ins-kpi-val">{fmt(data.totalExpectedBS)}</div>
        <div className="ins-kpi-sub">Based on SKU pricing formula</div>
      </div>
      <div className={`ins-kpi ${data.netVariance >= 0 ? 'ins-kpi-pos' : 'ins-kpi-neg'}`}>
        <div className="ins-kpi-label">Net P&amp;L Signal</div>
        <div className={`ins-kpi-val ${data.netVariance >= 0 ? 'green' : 'red'}`}>
          {data.netVariance >= 0 ? '+' : ''}{fmt(data.netVariance)}
        </div>
        <div className="ins-kpi-sub">Actual vs your target</div>
      </div>
      <div className="ins-kpi ins-kpi-warn">
        <div className="ins-kpi-label">Return Shipping Cost</div>
        <div className="ins-kpi-val red">{fmt(-data.totalRevShipping)}</div>
        <div className="ins-kpi-sub">Biggest single fee this period</div>
      </div>
    </div>
  )
}

function VarianceChart({ data }) {
  return (
    <div className="ins-panel">
      <div className="ins-panel-hdr">
        <div>
          <div className="ins-panel-title">Settlement Variance by SKU</div>
          <div className="ins-panel-sub">Actual Flipkart payment vs your pricing target</div>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data.varianceChartData} layout="vertical"
          margin={{ top: 4, right: 48, left: 4, bottom: 0 }}>
          <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => `₹${v}`} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={70} axisLine={false} tickLine={false} />
          <Tooltip formatter={v => [`₹${Number(v).toLocaleString('en-IN')}`, 'Variance']}
            labelFormatter={(_, p) => p?.[0]?.payload?.fullName || ''} contentStyle={{ fontSize: 12 }} />
          <Bar dataKey="variance" radius={[0, 3, 3, 0]} barSize={14}>
            {data.varianceChartData.map((entry, i) => (
              <Cell key={i} fill={entry.variance >= 0 ? '#22c55e' : '#ef4444'} fillOpacity={0.85} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div className="ins-var-legend">
        <span className="ins-vleg green">▲ {data.beatingCount} SKUs beating target (+{fmt(data.beatingTotal)})</span>
        <span className="ins-vleg red">▼ {data.missingCount} SKUs below target ({fmt(data.missingTotal)})</span>
      </div>
    </div>
  )
}

function WaterfallPanel({ report, data }) {
  const rows = [
    { label: 'Net Sales',        value: report.net_sales,        type: 'base'    },
    { label: 'Reverse Shipping', value: -data.totalRevShipping,  type: 'cost'    },
    { label: 'GST on Fees',      value: -data.totalGST,          type: 'cost'    },
    { label: 'TCS / TDS',        value: -data.totalTax,          type: 'cost'    },
    { label: 'Commission',       value: -data.totalCommission,   type: 'cost'    },
    { label: 'Collection Fee',   value: -data.totalCollection,   type: 'cost'    },
    { label: 'Rewards',          value: data.totalRewards,       type: 'benefit' },
    { label: 'Bank Settlement',  value: report.bank_settlement,  type: 'result'  },
  ]
  const base = report.net_sales || 1

  return (
    <div className="ins-panel">
      <div className="ins-panel-hdr">
        <div>
          <div className="ins-panel-title">Where Your Money Goes</div>
          <div className="ins-panel-sub">Net sales → bank settlement breakdown</div>
        </div>
      </div>
      <div className="ins-waterfall">
        {rows.map((item, i) => {
          const barW   = Math.min(Math.abs(item.value) / base * 100, 100)
          const pctLbl = ((item.value / base) * 100).toFixed(1) + '%'
          return (
            <div key={i} className={`ins-wf-row ins-wf-${item.type}`}>
              <div className="ins-wf-label">{item.label}</div>
              <div className="ins-wf-bar-wrap"><div className="ins-wf-bar" style={{ width: `${barW}%` }} /></div>
              <div className="ins-wf-val">{item.value < 0 ? '−' : ''}{fmt(Math.abs(item.value))}</div>
              <div className="ins-wf-pct">{pctLbl}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ReturnAnalysis({ report, data }) {
  const cards = [
    { label: 'Delivered', value: report.net_units,        cls: 'green', icon: <Check /> },
    { label: 'RTO',       value: data.totalRTO,           cls: 'amber', icon: <Undo /> },
    { label: 'RVP',       value: data.totalRVP,           cls: 'red',   icon: <Undo /> },
    { label: 'Cancelled', value: data.totalCancelled,     cls: 'muted', icon: <XMark /> },
  ]

  return (
    <div className="ins-panel">
      <div className="ins-panel-hdr">
        <div>
          <div className="ins-panel-title">Return Analysis</div>
          <div className="ins-panel-sub">Where your {fmtN(report.gross_units)} gross units went</div>
        </div>
      </div>
      <div className="ins-ret-grid">
        {cards.map((item, i) => {
          const pct = ((item.value / (report.gross_units || 1)) * 100).toFixed(1)
          return (
            <div key={i} className={`ins-ret-card ins-ret-${item.cls}`}>
              <div className="ins-ret-icon">{item.icon}</div>
              <div className="ins-ret-num">{item.value}</div>
              <div className="ins-ret-lbl">{item.label}</div>
              <div className="ins-ret-pct">{pct}%</div>
            </div>
          )
        })}
      </div>
      <div className="ins-ret-note">
        Avg return shipping cost per returned unit: {fmt(data.totalRevShipping / Math.max(data.totalRTO + data.totalRVP, 1))}
      </div>
    </div>
  )
}

function MarginDistribution({ report, data }) {
  return (
    <div className="ins-panel">
      <div className="ins-panel-hdr">
        <div>
          <div className="ins-panel-title">Flipkart Margin Distribution</div>
          <div className="ins-panel-sub">Net margin % per SKU after Flipkart fees</div>
        </div>
      </div>
      <div className="ins-margin-dist">
        {data.marginBrackets.map((b, i) => {
          const pct = (b.count / (report.total_skus || 1)) * 100
          return (
            <div key={i} className="ins-md-row">
              <div className="ins-md-label">{b.label}</div>
              <div className="ins-md-bar-wrap"><div className="ins-md-bar" style={{ width: `${pct}%`, background: b.color }} /></div>
              <div className="ins-md-count">{b.count} SKUs</div>
              <div className="ins-md-pct">{pct.toFixed(0)}%</div>
            </div>
          )
        })}
      </div>
      <div className="ins-margin-note">
        <Warn s={13} /> Flipkart Margin = after Flipkart fees only. Add your purchase cost for true business margin.
      </div>
    </div>
  )
}
