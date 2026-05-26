import { useState } from 'react'
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

  return (
    <div className="fd-page">
      <div className="fd-header">
        <h1 className="fd-title">Fraud Intelligence</h1>
        <p className="fd-subtitle">
          Actor-centric fraud detection — customers and platforms are the fraud actors.
          SKU vulnerability is derived from actor patterns.
        </p>
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
        {activeTab === 'actors'   && <ActorIntelligenceTab />}
        {activeTab === 'states'   && <StateRiskTab />}
        {activeTab === 'reasons'  && <ReturnReasonTab />}
        {activeTab === 'platform' && <PlatformFraudTab />}
        {activeTab === 'sku'      && <SkuVulnerabilityTab />}
      </div>
    </div>
  )
}
