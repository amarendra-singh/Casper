import { useState, useEffect, useCallback } from 'react'
import { useParams, useSearchParams, useNavigate } from 'react-router-dom'
import { getPnlReport } from '../../api/client'
import { fmtPeriod }      from './flipkart/utils'
import { useFlipkartData } from './flipkart/useFlipkartData'
import FlipkartOverview   from './flipkart/FlipkartOverview'
import ProfitLossView     from './flipkart/ProfitLossView'
import OperatingPnLView   from './flipkart/OperatingPnLView'
import InsightsPanel      from './flipkart/InsightsPanel'
import './Flipkart.css'

const VIEWS       = ['fk', 'pnl', 'ops', 'insights']
const VIEW_LABELS = ['Flipkart Report', 'Profit & Loss', 'Operating P&L', 'Insights']

/**
 * Top-level route component for /pnl/flipkart/:reportId.
 * Owns: fetching, tab state, refresh button.
 * Delegates rendering to tab-specific children.
 */
export default function FlipkartReport() {
  const { reportId }                    = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate                        = useNavigate()

  const view     = VIEWS.includes(searchParams.get('view')) ? searchParams.get('view') : 'fk'
  const tabIndex = VIEWS.indexOf(view)

  const [report,  setReport]  = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  const fetchReport = useCallback((showLoader = true) => {
    if (showLoader) setLoading(true)
    setError(null)
    getPnlReport(Number(reportId))
      .then(data => { setReport(data); setLoading(false) })
      .catch(() => { setError('Report not found'); setLoading(false) })
  }, [reportId])

  useEffect(() => { fetchReport() }, [fetchReport])

  // Refetch on tab visibility change — catches SKU edits made in another tab
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') fetchReport(false)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [fetchReport])

  const { augmentedRows, insightsData } = useFlipkartData(report)

  const setView = v => setSearchParams({ view: v }, { replace: true })

  if (loading) return (
    <div className="pnl-page"><div className="pnl-empty">Loading report…</div></div>
  )
  if (error) return (
    <div className="pnl-page">
      <div className="pnl-empty-state">
        <div className="pnl-empty-icon">⚠</div>
        <div className="pnl-empty-title">{error}</div>
        <button className="pnl-btn-ghost" onClick={() => navigate('/pnl/flipkart')}>← Back to Reports</button>
      </div>
    </div>
  )

  return (
    <div className="pnl-page">

      {/* ── Header ── */}
      <div className="pnl-header">
        <div className="pnl-title-row">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <button className="pnl-btn-ghost" style={{ fontSize: 11, padding: '3px 10px' }}
                onClick={() => navigate('/pnl/flipkart')}>← Reports</button>
              <div className="pnl-platform-badge"><span className="pnl-fk-dot"/>Flipkart</div>
            </div>
            <h1 className="pnl-title">{fmtPeriod(report.period_start, report.period_end)}</h1>
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{report.filename}</div>
          </div>
          <button
            className="pnl-btn-ghost"
            style={{ fontSize: 11, padding: '4px 12px', alignSelf: 'flex-start' }}
            onClick={() => fetchReport(false)}
            title="Refetch live pricing from Casper">
            ↻ Refresh
          </button>
        </div>
        <div className="pnl-tabs">
          {VIEW_LABELS.map((label, i) => (
            <button key={label} className={`pnl-tab${tabIndex === i ? ' active' : ''}`}
              onClick={() => setView(VIEWS[i])}>{label}</button>
          ))}
        </div>
      </div>

      {view === 'fk'       && <FlipkartOverview report={report} insightsData={insightsData} onViewPnL={() => setView('pnl')} />}
      {view === 'pnl'      && <ProfitLossView    report={report} augmentedRows={augmentedRows} />}
      {view === 'ops'      && <OperatingPnLView  report={report} onRefresh={() => fetchReport(false)} />}
      {view === 'insights' && <InsightsPanel    report={report} insightsData={insightsData} />}

    </div>
  )
}
