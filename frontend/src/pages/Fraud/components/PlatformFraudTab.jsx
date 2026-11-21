import { useEffect, useState } from 'react'
import api from '../../../api/client'
import { useCompany } from '../../../context/CompanyContext'
import OverviewTab from './OverviewTab'
import SettlementTab from './SettlementTab'

export default function PlatformFraudTab() {
  const { role, isAll } = useCompany()
  const canResolve = !isAll && ['owner', 'admin'].includes(role)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let current = true
    setData(null); setError('')
    Promise.all([api.get('/fraud/overview'), api.get('/fraud/settlement')])
      .then(([overview, settlement]) => { if (current) {setData({ overview: overview.data, settlement: settlement.data })} })
      .catch(() => { if (current) {setError('Could not load platform risk.')} })
    return () => { current = false }
  }, [retry])
  const resolve = async id => {
    try { await api.patch(`/fraud/resolve/${id}`); setRetry(v => v + 1) }
    catch { setError('Could not resolve this alert.') }
  }
  if (error) {return <div role="alert">{error} <button onClick={() => setRetry(v => v + 1)}>Retry</button></div>}
  if (!data) {return <div role="status">Loading platform risk…</div>}
  return <div><OverviewTab overview={data.overview} onResolve={canResolve ? resolve : undefined} /><SettlementTab data={data.settlement} /></div>
}
