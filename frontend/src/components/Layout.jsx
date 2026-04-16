import { useState, useRef, useEffect } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { getPnlPlatformsWithReports } from '../api/client'
import './Layout.css'

const WORKSPACE = [
  { to: '/',          label: 'Dashboard', end: true  },
  { to: '/skus',      label: 'SKUs',      end: false },
  { to: '/vendors',   label: 'Vendors',   end: false },
  { to: '/pricing',   label: 'Pricing',   end: false },
  { to: '/settings',  label: 'Settings',  end: false },
]
const ANALYTICS      = ['Overview','Revenue','Platform Performance','SKU Analysis']
const REPORTS_MY     = ['Sales Report','Profitability','Platform Compare']
const REPORTS_SHARED = ['Weekly Summary','Deal Duration']
const COMPANIES = [
  { name: 'Shringar House Jewellery', color: '#16A34A', sub: 'Active' },
  { name: 'My Fashion Brand',         color: '#7C5CFC', sub: '3 SKUs' },
  { name: 'Electronics Store',        color: '#E8365D', sub: '12 SKUs' },
]
const ALL_SEARCH = [
  { label:'Dashboard',            sub:'Workspace',      to:'/' },
  { label:'SKUs',                 sub:'Workspace',      to:'/skus' },
  { label:'Pricing',              sub:'Workspace',      to:'/pricing' },
  { label:'Overview',             sub:'Analytics',      to:null },
  { label:'Revenue',              sub:'Analytics',      to:null },
  { label:'Platform Performance', sub:'Analytics',      to:null },
  { label:'SKU Analysis',         sub:'Analytics',      to:null },
  { label:'Sales Report',         sub:'My Reports',     to:null },
  { label:'Profitability',        sub:'My Reports',     to:null },
  { label:'Platform Compare',     sub:'My Reports',     to:null },
  { label:'Weekly Summary',       sub:'Shared with me', to:null },
  { label:'Deal Duration',        sub:'Shared with me', to:null },
  { label:'Settings',             sub:'Settings',       to:'/settings' },
]
const ICON_BTNS = [
  { icon:'⊞', title:'Dashboard', to:'/' },
  { icon:'◇', title:'SKUs',      to:'/skus' },
  { icon:'◆', title:'Pricing',   to:'/pricing' },
  { icon:'📊', title:'Analytics', to:null },
  { icon:'📋', title:'Reports',   to:null, badge:7 },
]

export default function Layout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const initials = user?.name?.split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase() || 'U'
  const handleLogout = () => { logout(); navigate('/login') }

  const [pnlPlatforms, setPnlPlatforms] = useState([])
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('sidebarCollapsed') === 'true')
  const toggleSidebar = () => setSidebarCollapsed(p => { localStorage.setItem('sidebarCollapsed', !p); return !p })
  const [open,      setOpen]      = useState({ workspace:true, pnl:true, analytics:true, reports:true, settings:true })
  const [treeOpen,  setTreeOpen]  = useState({ my:true, shared:true })
  const [company,   setCompany]   = useState(COMPANIES[0])
  const [showCo,    setShowCo]    = useState(false)
  const [query,     setQuery]     = useState('')
  const [searchRes, setSearchRes] = useState([])
  const [showSR,    setShowSR]    = useState(false)

  const coRef = useRef(null)
  const srRef = useRef(null)

  useEffect(() => {
    const h = e => {
      if (coRef.current && !coRef.current.contains(e.target)) setShowCo(false)
      if (srRef.current  && !srRef.current.contains(e.target)) setShowSR(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  useEffect(() => {
    getPnlPlatformsWithReports().then(setPnlPlatforms).catch(() => {})
  }, [])

  const togSec  = k => setOpen(p => ({ ...p, [k]: !p[k] }))
  const togTree = k => setTreeOpen(p => ({ ...p, [k]: !p[k] }))

  const handleSearch = q => {
    setQuery(q)
    if (!q.trim()) { setShowSR(false); return }
    setSearchRes(ALL_SEARCH.filter(p =>
      p.label.toLowerCase().includes(q.toLowerCase()) ||
      p.sub.toLowerCase().includes(q.toLowerCase())
    ))
    setShowSR(true)
  }

  return (
    <div className="layout">

      {/* ── Sidebar — same warm gray as outer bg ── */}
      <aside className={`sidebar${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>

        {/* Icon strip */}
        <div className="ic-strip">
          <div className="ic-logo" onClick={() => navigate('/')}>C</div>
          <div className="ic-collapse" onClick={toggleSidebar} title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            {sidebarCollapsed ? '›' : '‹'}
          </div>
          <div className="ic-nav">
            {ICON_BTNS.map((b, i) => (
              <div key={i} className="ic-btn" title={b.title}
                onClick={() => b.to ? navigate(b.to) : null}
                style={{ position:'relative' }}>
                {b.icon}
                {b.badge && <span className="ic-badge">{b.badge}</span>}
              </div>
            ))}
          </div>
          <div className="ic-bottom">
            <div className="ic-btn" style={{ position:'relative' }} title="Notifications">
              🔔<span className="ic-badge">3</span>
            </div>
            <div className="ic-btn" title="Settings" onClick={() => navigate('/settings')}>⚙</div>
            <div className="ic-avatar" title={user?.name}>{initials}</div>
          </div>
        </div>

        {/* Text nav */}
        <div className="nav-text">
          <div className="nav-brand">
            <span className="nav-brand-name">Casper</span>
            <span className="nav-brand-chev">▾</span>
          </div>

          {/* Company switcher */}
          <div className="co-wrap" ref={coRef}>
            <div className="co-btn" onClick={() => setShowCo(p => !p)}>
              <div className="co-dot" style={{ background: company.color }}/>
              <span className="co-name">{company.name}</span>
              <span className="co-chev">▾</span>
            </div>
            {showCo && (
              <div className="co-dd">
                {COMPANIES.map((c, i) => (
                  <div key={i} className="co-row"
                    onClick={() => { setCompany(c); setShowCo(false) }}>
                    <div className="co-rdot" style={{ background: c.color }}/>
                    <div>
                      <div className="co-rname">{c.name}</div>
                      <div className="co-rsub">{c.sub}</div>
                    </div>
                  </div>
                ))}
                <div className="co-add">
                  <span className="co-add-plus">+</span>
                  <span className="co-add-label">Add new company</span>
                </div>
              </div>
            )}
          </div>

          {/* Scrollable nav */}
          <div className="nav-scroll">

            {/* Workspace */}
            <div className="nav-sec">
              <div className="sec-hdr" onClick={() => togSec('workspace')}>
                <span className="sec-lbl">Workspace</span>
                <span className={`sec-chev ${open.workspace ? '' : 'closed'}`}>▾</span>
              </div>
              {open.workspace && WORKSPACE.map(item => (
                <NavLink key={item.to} to={item.to} end={item.end}
                  className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
                  {item.label}
                </NavLink>
              ))}
            </div>

            {/* P&L */}
            <div className="nav-sec">
              <div className="sec-hdr" onClick={() => togSec('pnl')}>
                <span className="sec-lbl">P&amp;L</span>
                <span className={`sec-chev ${open.pnl ? '' : 'closed'}`}>▾</span>
              </div>
              {open.pnl && (
                pnlPlatforms.length === 0
                  ? <NavLink to="/pnl/flipkart"
                      className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
                      Flipkart
                    </NavLink>
                  : pnlPlatforms.map(p => (
                      <NavLink key={p.id}
                        to={`/pnl/${p.name.toLowerCase()}`}
                        className={({ isActive }) => `nav-item nav-sub-item${isActive ? ' active' : ''}`}>
                        {p.name}
                      </NavLink>
                    ))
              )}
            </div>

            {/* Analytics */}
            <div className="nav-sec">
              <div className="sec-hdr" onClick={() => togSec('analytics')}>
                <span className="sec-lbl">Analytics</span>
                <span className={`sec-chev ${open.analytics ? '' : 'closed'}`}>▾</span>
              </div>
              {open.analytics && (
                <div className="tree-body">
                  {ANALYTICS.map(label => (
                    <div key={label} className="tree-item">
                      <div className="tree-dot"/>{label}
                      <span className="soon-pill">Soon</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Reports */}
            <div className="nav-sec">
              <div className="sec-hdr" onClick={() => togSec('reports')}>
                <span className="sec-lbl">Reports</span>
                <div style={{ display:'flex', alignItems:'center', gap:4 }}>
                  <span className="rp-badge">7</span>
                  <span className={`sec-chev ${open.reports ? '' : 'closed'}`}>▾</span>
                </div>
              </div>
              {open.reports && <>
                <div className="tree-group-hdr" onClick={() => togTree('my')}>
                  My Reports
                  <span className={`tree-chev${treeOpen.my ? ' open' : ''}`}>▶</span>
                </div>
                {treeOpen.my && (
                  <div className="tree-body">
                    {REPORTS_MY.map(label => (
                      <div key={label} className="tree-item">
                        <div className="tree-dot"/>{label}
                      </div>
                    ))}
                  </div>
                )}
                <div className="tree-group-hdr" onClick={() => togTree('shared')}>
                  Shared with me
                  <span className={`tree-chev${treeOpen.shared ? ' open' : ''}`}>▶</span>
                </div>
                {treeOpen.shared && (
                  <div className="tree-body">
                    {REPORTS_SHARED.map(label => (
                      <div key={label} className="tree-item">
                        <div className="tree-dot"/>{label}
                      </div>
                    ))}
                  </div>
                )}
              </>}
            </div>

            {/* Settings */}
            <div className="nav-sec">
              <div className="sec-hdr" onClick={() => togSec('settings')}>
                <span className="sec-lbl">Settings</span>
                <span className={`sec-chev ${open.settings ? '' : 'closed'}`}>▾</span>
              </div>
              {open.settings && <>
                <NavLink to="/settings"
                  className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
                  Settings
                </NavLink>
                <div className="nav-item" style={{ cursor:'pointer' }}
                  onClick={() => navigate('/settings')}>
                  Users
                </div>
              </>}
            </div>

          </div>

          {/* Footer */}
          <div className="nav-footer">
            <div className="nf-row">
              <div className="nf-avatar">{initials}</div>
              <div>
                <div className="nf-name">{user?.name}</div>
                <div className="nf-role">{user?.role?.replace('_', ' ')}</div>
              </div>
              <div className="nf-actions">
                <button className="nf-btn" onClick={handleLogout} title="Logout">⎋</button>
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* ── Right side: topbar (on gray) + white content box ── */}
      <div className="right-col">

        {/* Topbar sits on gray background */}
        <div className="topbar">
          <div className="topbar-search-wrap" ref={srRef}>
            <div className="topbar-search">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                stroke="#A8A59F" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"/>
                <line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <input className="topbar-input"
                placeholder='Try searching "insights"'
                value={query}
                onChange={e => handleSearch(e.target.value)}
                onFocus={() => query && setShowSR(true)}
              />
            </div>
            {showSR && (
              <div className="search-dd">
                {searchRes.length > 0
                  ? searchRes.map((item, i) => (
                    <div key={i} className="sd-item"
                      onClick={() => {
                        setQuery(''); setShowSR(false)
                        if (item.to) navigate(item.to)
                      }}>
                      <div>
                        <div className="sd-label">{item.label}</div>
                        <div className="sd-sub">{item.sub}</div>
                      </div>
                      <span className="sd-arrow">→</span>
                    </div>
                  ))
                  : <div className="sd-empty">No results for "{query}"</div>
                }
              </div>
            )}
          </div>
          <div className="topbar-right">
            <button className="tb-btn">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="3" y1="6" x2="21" y2="6"/>
                <line x1="3" y1="12" x2="21" y2="12"/>
                <line x1="3" y1="18" x2="21" y2="18"/>
              </svg>
            </button>
            <div className="tb-avatar-grad"/>
            <button className="tb-plus">+</button>
          </div>
        </div>

        {/* White content box */}
        <div className="main-wrap">
          <main className="page-content">
            <Outlet />
          </main>
        </div>

      </div>
    </div>
  )
}