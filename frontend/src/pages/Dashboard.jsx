import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { getSkus, getPlatforms, getVendors, getMiscTotal, getSettings } from '../api/client'
import { useAuth } from '../context/AuthContext'
import './Dashboard.css'

function StatCard({ icon, label, value, sub, accent }) {
  return (
    <div className={`stat-card ${accent ? 'stat-card--accent' : ''}`}>
      <div className="stat-icon">{icon}</div>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  )
}

export default function Dashboard() {
  const { user }          = useAuth()
  const navigate          = useNavigate()
  const [data, setData]   = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Load all data at once in parallel
    Promise.all([
      getSkus(),
      getPlatforms(),
      getVendors(),
      getMiscTotal(),
      getSettings(),
    ]).then(([skus, platforms, vendors, miscTotal, settings]) => {
      setData({ skus, platforms, vendors, miscTotal, settings })
    }).finally(() => setLoading(false))
  }, [])

  if (loading) return (
    <div className="loader-page">
      <div className="loader" style={{ width:32, height:32 }} />
    </div>
  )

  const activeSkus = data.skus.filter(s => s.is_active).length
  const activePlatforms = data.platforms.filter(p => p.is_active).length
  const activeVendors   = data.vendors.filter(v => v.is_active).length
  const miscTotal       = data.miscTotal?.total ?? 0
  const damagePct       = data.settings?.find(s => s.key === 'damage_percent')?.value ?? '15.0'
  const recentSkus      = [...data.skus].slice(-5).reverse()

  return (
    <div className="dashboard">
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">
            Welcome back, {user?.name} · {new Date().toLocaleDateString('en-IN', {
              weekday:'long', day:'numeric', month:'long', year:'numeric'
            })}
          </p>
        </div>
        <button className="btn btn-gold" onClick={() => navigate('/skus')}>
          + New SKU
        </button>
      </div>

      {/* Stats */}
      <div className="stats-grid">
        <StatCard icon="◇" label="Total SKUs"      value={data.skus.length}  sub={`${activeSkus} active`} accent />
        <StatCard icon="⬡" label="Platforms"        value={activePlatforms}   sub="active channels" />
        <StatCard icon="◈" label="Vendors"           value={activeVendors}     sub="active suppliers" />
        <StatCard icon="₹" label="Misc Overhead"    value={`₹${miscTotal}`}   sub="per SKU / month" />
        <StatCard icon="%" label="Default Damage"   value={`${damagePct}%`}   sub="of price" />
      </div>

      {/* Platforms */}
      <div className="section-title">Platforms</div>
      <div className="platform-grid">
        {data.platforms.filter(p => p.is_active).map(p => (
          <div key={p.id} className="platform-card">
            <div className="platform-name">{p.name}</div>
            <div className="platform-row">
              <span className="platform-key">CR Charge</span>
              <span className="platform-val mono">₹{p.cr_charge}</span>
            </div>
            <div className="platform-row">
              <span className="platform-key">CR %</span>
              <span className="platform-val mono">{p.cr_percentage}%</span>
            </div>
            <div className="platform-tiers">
              {p.tiers?.map(t => (
                <span key={t.id} className="tier-badge">
                  {t.tier_name} ₹{t.fee}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Recent SKUs */}
      {recentSkus.length > 0 && (
        <>
          <div className="section-header">
            <div className="section-title" style={{ margin:0 }}>Recent SKUs</div>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('/skus')}>
              View all →
            </button>
          </div>
          <div className="card" style={{ padding:0, overflow:'hidden' }}>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Description</th>
                    <th>Vendor</th>
                    <th>Category</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {recentSkus.map(sku => (
                    <tr key={sku.id} style={{ cursor:'pointer' }}
                      onClick={() => navigate(`/pricing/${sku.id}`)}>
                      <td><span className="mono">{sku.shringar_sku}</span></td>
                      <td>{sku.description || '—'}</td>
                      <td>{sku.vendor?.name || '—'}</td>
                      <td>{sku.category?.name || '—'}</td>
                      <td>
                        <span className={`badge ${sku.is_active ? 'badge-green' : 'badge-red'}`}>
                          {sku.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td style={{ color:'var(--gold)' }}>→</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}