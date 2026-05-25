const money = v => v != null ? `₹${Math.round(Math.abs(v)).toLocaleString('en-IN')}` : '—'
const pct   = v => v != null ? `${(v * 100).toFixed(1)}%` : '—'

const SEV_STYLE = {
  CRITICAL: { color: '#ef4444', bg: 'rgba(239,68,68,0.1)' },
  HIGH:     { color: '#f97316', bg: 'rgba(249,115,22,0.1)' },
  MEDIUM:   { color: '#f59e0b', bg: 'rgba(245,158,11,0.1)' },
}

export default function SettlementTab({ data }) {
  if (!data) return <div className="fd-empty">Loading…</div>

  return (
    <div className="fd-settlement">
      {/* Summary KPIs */}
      <div className="fd-settle-summary">
        <div className="fd-settle-kpi">
          <div className="fd-sk-val" style={{ color: data.total_gap < 0 ? '#ef4444' : '#22c55e' }}>
            {data.total_gap < 0 ? '−' : '+'}{money(data.total_gap)}
          </div>
          <div className="fd-sk-lbl">Total settlement gap (all reports)</div>
        </div>
        <div className="fd-settle-kpi">
          <div className="fd-sk-val">{data.gap_count}</div>
          <div className="fd-sk-lbl">Reports with gap &gt; ₹100</div>
        </div>
        <div className="fd-settle-note">{data.note}</div>
      </div>

      {/* Empty state */}
      {!data.reports?.length && (
        <div className="fd-empty" style={{ marginTop: 24 }}>
          No settlement data yet. Upload a report with SKU pricing set to see reconciliation.
          <br />
          <span style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6, display: 'block' }}>
            Settlement gap requires Casper expected BS to be set (Pricing page → set target BS per SKU per platform).
          </span>
        </div>
      )}

      {/* Report table */}
      {data.reports?.length > 0 && (
        <div className="fd-table-scroll" style={{ marginTop: 16 }}>
          <table className="fd-table">
            <thead>
              <tr>
                <th className="fd-th">Platform</th>
                <th className="fd-th">Period</th>
                <th className="fd-th">SKUs</th>
                <th className="fd-th">Expected BS</th>
                <th className="fd-th">Actual BS</th>
                <th className="fd-th">Gap</th>
                <th className="fd-th">Gap%</th>
                <th className="fd-th">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.reports.map((r, i) => {
                const isNeg = r.gap < 0
                const s = SEV_STYLE[r.severity] || null
                return (
                  <tr key={i} className="fd-row">
                    <td>{r.platform_name}</td>
                    <td className="fd-period">{r.period}</td>
                    <td className="fd-num">{r.sku_count}</td>
                    <td className="fd-num">{money(r.expected_bs)}</td>
                    <td className="fd-num">{money(r.actual_bs)}</td>
                    <td className="fd-num" style={{ color: isNeg ? '#ef4444' : '#22c55e', fontWeight: 600 }}>
                      {isNeg ? '−' : '+'}{money(r.gap)}
                    </td>
                    <td className="fd-num" style={{ color: isNeg ? '#ef4444' : '#22c55e' }}>
                      {isNeg ? '−' : '+'}{pct(Math.abs(r.pct_gap))}
                    </td>
                    <td>
                      {r.severity && s ? (
                        <span className="fd-tier-badge" style={{ color: s.color, background: s.bg }}>
                          {r.severity}
                        </span>
                      ) : (
                        <span className="fd-tier-badge"
                          style={{ color: '#22c55e', background: 'rgba(34,197,94,0.1)' }}>
                          OK
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
