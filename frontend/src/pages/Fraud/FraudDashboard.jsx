import { useState, useRef } from 'react'
import { uploadShopdeckCustomers } from '../../api/client'
import ActorIntelligenceTab from './components/ActorIntelligenceTab'
import StateRiskTab         from './components/StateRiskTab'
import ReturnReasonTab      from './components/ReturnReasonTab'
import PlatformFraudTab     from './components/PlatformFraudTab'
import SkuVulnerabilityTab  from './components/SkuVulnerabilityTab'
import './FraudDashboard.css'

const TABS = [
  { id: 'actors',   label: '🎭 Actor Intelligence', primary: true  },
  { id: 'states',   label: '🗺️ State Risk Map',     primary: false },
  { id: 'reasons',  label: '📋 Return Reasons',     primary: false },
  { id: 'platform', label: '🏢 Platform Fraud',     primary: false },
  { id: 'sku',      label: '📦 SKU Vulnerability',  primary: false },
]

export default function FraudDashboard() {
  const [activeTab, setActiveTab] = useState('actors')
  const [busy, setBusy]     = useState(false)
  const [msg, setMsg]       = useState(null)   // { ok: bool, text: string }
  const [reloadKey, setReloadKey] = useState(0)
  const fileRef = useRef(null)

  const onCustomerFile = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''                        // allow re-selecting the same file
    if (!file) return
    setBusy(true); setMsg(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const r = await uploadShopdeckCustomers(fd)
      setMsg({ ok: true, text: `Scored ${r.parsed} customers · ${r.ingested} flagged into the pipeline` })
      setActiveTab('actors')
      setReloadKey(k => k + 1)                 // remount the Actor tab so it refetches
    } catch (err) {
      setMsg({ ok: false, text: err.response?.data?.detail || 'Upload failed' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fd-page">
      <div className="fd-header">
        <div>
          <h1 className="fd-title">Fraud Intelligence</h1>
          <p className="fd-subtitle">
            Actor-centric fraud detection — customers and platforms are the fraud actors.
            SKU vulnerability is derived from actor patterns.
          </p>
        </div>
        <div className="fd-actions">
          <input ref={fileRef} type="file" accept=".csv" hidden
                 onChange={onCustomerFile} aria-label="ShopDeck customer CSV" />
          <button className="fd-upload-btn" onClick={() => fileRef.current?.click()} disabled={busy}>
            {busy ? 'Scoring…' : '+ Upload ShopDeck customers'}
          </button>
          {msg && <span className={`fd-upload-msg ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</span>}
        </div>
      </div>

      <div className="fd-tabs">
        {TABS.map(tab => (
          <button
            key={tab.id}
            className={`fd-tab ${activeTab === tab.id ? 'fd-tab--active' : ''} ${tab.primary && activeTab === tab.id ? 'fd-tab--primary' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="fd-tab-content">
        {activeTab === 'actors'   && <ActorIntelligenceTab key={reloadKey} />}
        {activeTab === 'states'   && <StateRiskTab />}
        {activeTab === 'reasons'  && <ReturnReasonTab />}
        {activeTab === 'platform' && <PlatformFraudTab />}
        {activeTab === 'sku'      && <SkuVulnerabilityTab />}
      </div>
    </div>
  )
}
