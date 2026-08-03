import { useState, useEffect, useCallback } from 'react'
import { useParams, useSearchParams, useNavigate } from 'react-router-dom'
import { getPnlReport } from '../../api/client'
import { fmtPeriod }     from './flipkart/utils'
import { useReportData } from './flipkart/useReportData'
import IncomeStatement   from './flipkart/IncomeStatement'
import ReportOverview    from './flipkart/ReportOverview'
import ProfitLossView    from './flipkart/ProfitLossView'
import OperatingPnLView  from './flipkart/OperatingPnLView'
import InsightsPanel     from './flipkart/InsightsPanel'
import './Flipkart.css'

const PLATFORM_COLORS = {
  flipkart: '#F9A825',
  meesho:   '#9C27B0',
  snapdeal: '#E53935',
  amazon:   '#FF9900',
}

const VIEWS = ['statement', 'overview', 'pnl', 'ops', 'insights']

/**
 * Generic top-level route for /pnl/:platform/:reportId.
 * Platform-aware: reads `platform` from URL params, passes it to children.
 * Replaces the old FlipkartReport.jsx (which was hardcoded to Flipkart).
 */
export default function PnLReport() {
  const { platform = 'flipkart', reportId } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate                        = useNavigate()

  const platformName  = platform.charAt(0).toUpperCase() + platform.slice(1)
  const platformColor = PLATFORM_COLORS[platform.toLowerCase()] || '#888'

  const VIEW_LABELS = ['P&L Statement', `${platformName} Report`, 'Profit & Loss', 'Operating P&L', 'Insights']

  const view     = VIEWS.includes(searchParams.get('view')) ? searchParams.get('view') : VIEWS[0]
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

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') fetchReport(false)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [fetchReport])

  const { augmentedRows, insightsData } = useReportData(report)

  const setView = v => setSearchParams({ view: v }, { replace: true })

  if (loading) return (
    <div className="pnl-page"><div className="pnl-empty">Loading report…</div></div>
  )
  if (error) return (
    <div className="pnl-page">
      <div className="pnl-empty-state">
        <div className="pnl-empty-icon">⚠</div>
        <div className="pnl-empty-title">{error}</div>
        <button className="pnl-btn-ghost" onClick={() => navigate(`/pnl/${platform}`)}>← Back to Reports</button>
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
                onClick={() => navigate(`/pnl/${platform}`)}>← Reports</button>
              <div className="pnl-platform-badge">
                <span className="pnl-fk-dot" style={{ background: platformColor }} />
                {platformName}
              </div>
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

      {view === 'statement' && <IncomeStatement report={report} />}
      {view === 'overview'  && <ReportOverview  report={report} insightsData={insightsData} platform={platform} onViewPnL={() => setView('pnl')} />}
      {view === 'pnl'       && <ProfitLossView   report={report} augmentedRows={augmentedRows} platform={platform} />}
      {view === 'ops'       && <OperatingPnLView report={report} onRefresh={() => fetchReport(false)} />}
      {view === 'insights'  && <InsightsPanel    report={report} insightsData={insightsData} />}

    </div>
  )
}
