import { useState, useEffect } from 'react'
import api from '../../../api/client'

const CATEGORY_COLORS = {
  FRAUD_SIGNAL: '#ef4444',
  QUALITY:      '#f59e0b',
  PREFERENCE:   '#3b82f6',
  LOGISTICS:    '#8b5cf6',
  UNKNOWN:      '#6b7280',
}

export default function ReturnReasonTab() {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get('/fraud/return-reasons')
      .then(r => setData(r.data))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="fd-loading">Loading return reason intelligence…</div>
  if (!data)   return <div className="fd-empty">No return reason data available.</div>

  const maxCount = Math.max(...(data.by_category || []).map(c => c.count), 1)
  const pct = v => data.total_with_reasons > 0
    ? ((v / data.total_with_reasons) * 100).toFixed(1) + '%'
    : '—'

  return (
    <div className="rr-tab">
      <div className="fd-section-title">Return Reason Intelligence</div>
      <p className="actor-subtitle">
        Classify why customers return.{' '}
        <strong style={{ color: '#ef4444' }}>Fraud Signal</strong> returns indicate deliberate policy abuse.
      </p>

      {/* Category breakdown bars */}
      <div className="rr-categories">
        {(data.by_category || []).map(cat => (
          <div key={cat.category} className="rr-cat-row">
            <div className="rr-cat-label" style={{ color: CATEGORY_COLORS[cat.category] || '#6b7280' }}>
              {cat.category.replace(/_/g, ' ')}
            </div>
            <div className="rr-bar-wrap">
              <div
                className="rr-bar"
                style={{
                  width:      `${(cat.count / maxCount) * 280}px`,
                  background: CATEGORY_COLORS[cat.category] || '#6b7280',
                }}
              />
              <span className="rr-bar-val">{cat.count} orders ({pct(cat.count)})</span>
            </div>
          </div>
        ))}
      </div>

      {data.fraud_signal_total > 0 && (
        <div className="rr-fraud-callout">
          ⚠️ <strong>{data.fraud_signal_total} orders</strong> flagged as{' '}
          <strong>FRAUD SIGNAL</strong> ({pct(data.fraud_signal_total)} of returns).
          Indicates deliberate abuse — empty box claims, fake "not received", product swap fraud.
        </div>
      )}

      <div className="fd-section-title" style={{ marginTop: '24px' }}>Top Return Reasons</div>
      <div className="fd-table-wrap">
        <table className="fd-table">
          <thead>
            <tr>
              <th className="fd-th">Return Reason</th>
              <th className="fd-th">Sub-Reason</th>
              <th className="fd-th">Signal Type</th>
              <th className="fd-th fd-num">Orders</th>
            </tr>
          </thead>
          <tbody>
            {(data.top_reasons || []).length === 0 && (
              <tr>
                <td colSpan={4} style={{ textAlign: 'center', padding: '24px', color: '#6b7280' }}>
                  No return reason data. Upload Flipkart Orders file to populate.
                </td>
              </tr>
            )}
            {(data.top_reasons || []).map((r, i) => (
              <tr key={i} className="fd-tr">
                <td className="fd-td" style={{ fontSize: '0.82rem' }}>
                  {(r.return_reason || '—').replace(/_/g, ' ')}
                </td>
                <td className="fd-td" style={{ fontSize: '0.78rem', color: '#9ca3af' }}>
                  {r.return_sub_reason ? r.return_sub_reason.replace(/_/g, ' ') : '—'}
                </td>
                <td className="fd-td">
                  <span className="fd-badge" style={{
                    color:      CATEGORY_COLORS[r.fraud_signal_type] || '#6b7280',
                    background: (CATEGORY_COLORS[r.fraud_signal_type] || '#6b7280') + '20',
                    fontWeight: 600,
                  }}>
                    {(r.fraud_signal_type || 'UNKNOWN').replace(/_/g, ' ')}
                  </span>
                </td>
                <td className="fd-td fd-num">{r.order_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
