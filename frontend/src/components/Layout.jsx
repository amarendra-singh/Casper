import { useState, useRef, useEffect } from 'react'
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { getPlatforms } from '../api/client'
import './Layout.css'

// ── SVG Icons ──────────────────────────────────────────────────────────────
const IcHome    = () => <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9.5L10 3l7 6.5V17a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5z"/><path d="M7 18V11h6v7"/></svg>
const IcLayers  = () => <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12l8 4 8-4M2 8l8 4 8-4M2 4l8 4 8-4"/></svg>
const IcChart   = () => <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3 17V7m4 10V3m4 14v-6m4 6v-4"/></svg>
const IcDoc     = () => <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V6l-3-4z"/><path d="M13 2v4h4M7 9h6M7 12h6M7 15h4"/></svg>
const IcEdit    = () => <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2.5a2.12 2.12 0 0 1 3 3L6 17l-4 1 1-4 11.5-11.5z"/></svg>
const IcHelp    = () => <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="10" cy="10" r="8"/><path d="M7.5 7.5a2.5 2.5 0 0 1 5 .83c0 1.67-2.5 2.5-2.5 2.5M10 14.5h.01"/></svg>
const IcSettings= () => <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="10" cy="10" r="2.5"/><path d="M10 2v1.5M10 16.5V18M2 10h1.5M16.5 10H18M4.22 4.22l1.06 1.06M14.72 14.72l1.06 1.06M4.22 15.78l1.06-1.06M14.72 5.28l1.06-1.06"/></svg>
const IcSearch  = () => <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="9" r="6"/><path d="M17 17l-3.5-3.5"/></svg>
const IcMenu    = () => <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M3 5h14M3 10h14M3 15h14"/></svg>
const IcPlus    = () => <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M10 4v12M4 10h12"/></svg>
const IcChevron = () => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 4l4 4-4 4"/></svg>
const IcUsers   = () => <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M13 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM3 17a7 7 0 0 1 14 0"/></svg>
const IcTag     = () => <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3h6l8 8a2 2 0 0 1 0 2.83l-3.17 3.17a2 2 0 0 1-2.83 0L3 9V3z"/><circle cx="7" cy="7" r="1" fill="currentColor" stroke="none"/></svg>
const IcPnl     = () => <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="16" height="14" rx="2"/><path d="M6 8h5M6 11h8M6 14h4"/><path d="M14 6l1.5 1.5L14 9"/></svg>

// ── Nav data ──────────────────────────────────────────────────────────────
const RAIL_NAV = [
  { to: '/',        title: 'Dashboard', Icon: IcHome,   end: true },
  { to: '/skus',    title: 'SKUs',      Icon: IcLayers },
  { to: '/pricing', title: 'Pricing',   Icon: IcTag },
  { to: null,       title: 'Analytics', Icon: IcChart },
  { to: null,       title: 'Reports',   Icon: IcDoc,   badge: 7 },
]

const WORKSPACE = [
  { to: '/',         label: 'Dashboard', Icon: IcHome,     end: true },
  { to: '/skus',     label: 'SKUs',      Icon: IcLayers,   subItems: [
    { to: '/skus',         label: 'Manage SKUs',    end: true },
    { to: '/skus/intro',   label: 'Overview' },
  ]},
  { to: '/vendors',  label: 'Vendors',   Icon: IcUsers,    subItems: [
    { to: '/vendors',        label: 'Manage Vendors', end: true },
    { to: '/vendors/intro',  label: 'Overview' },
  ]},
  { to: '/pricing',  label: 'Pricing',   Icon: IcTag,      subItems: [
    { to: '/pricing',        label: 'New Pricing',   end: true },
    { to: '/pricing/intro',  label: 'Overview' },
  ]},
  { to: '/settings', label: 'Settings',  Icon: IcSettings, subItems: [
    { to: '/settings',       label: 'Platforms & Tiers', end: true },
    { to: '/settings/intro', label: 'Overview' },
  ]},
]

const ANALYTICS      = ['Overview','Revenue','Platform Performance','SKU Analysis']
const REPORTS_MY     = ['Sales Report','Profitability','Platform Compare']
const REPORTS_SHARED = ['Weekly Summary','Deal Duration']

const COMPANIES = [
  { name: 'Shringar House Jewellery', color: '#EC2D6E', sub: 'Active' },
  { name: 'My Fashion Brand',         color: '#7C5CFC', sub: '3 SKUs' },
  { name: 'Electronics Store',        color: '#F59E0B', sub: '12 SKUs' },
]

const ALL_SEARCH = [
  { label: 'Dashboard',           sub: 'Workspace', to: '/' },
  { label: 'SKUs',                sub: 'Workspace', to: '/skus' },
  { label: 'Pricing',             sub: 'Workspace', to: '/pricing' },
  { label: 'Platform Performance',sub: 'Analytics', to: null },
  { label: 'Revenue',             sub: 'Analytics', to: null },
  { label: 'Sales Report',        sub: 'Reports',   to: null },
  { label: 'Profitability',       sub: 'Reports',   to: null },
  { label: 'Settings',            sub: 'Settings',  to: '/settings' },
]

// ── Component ──────────────────────────────────────────────────────────────
export default function Layout() {
  const { user, logout } = useAuth()
  const navigate  = useNavigate()
  const location  = useLocation()
  const initials  = user?.name?.split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase() || 'U'
  const handleLogout = () => { logout(); navigate('/login') }

  const [pnlPlatforms, setPnlPlatforms] = useState([])
  const [open,      setOpen]      = useState({ workspace:true, pnl:true, analytics:false, reports:true, settings:false })
  const [openWsItem,setOpenWsItem]= useState({})
  const [treeOpen,  setTreeOpen]  = useState({ my:true, shared:false })
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
    getPlatforms().then(setPnlPlatforms).catch(() => {})
  }, [])

  const togSec    = k => setOpen(p => ({ ...p, [k]: !p[k] }))
  const togTree   = k => setTreeOpen(p => ({ ...p, [k]: !p[k] }))
  const togWsItem = k => setOpenWsItem(p => ({ ...p, [k]: !p[k] }))

  const handleSearch = q => {
    setQuery(q)
    if (!q.trim()) { setShowSR(false); return }
    setSearchRes(ALL_SEARCH.filter(p =>
      p.label.toLowerCase().includes(q.toLowerCase()) ||
      p.sub.toLowerCase().includes(q.toLowerCase())
    ))
    setShowSR(true)
  }

  // Determine active rail button
  const isRailActive = (item) => {
    if (!item.to) return false
    if (item.end) return location.pathname === item.to
    return location.pathname.startsWith(item.to)
  }

  return (
    <div className="app">

      {/* ══ RAIL ══ */}
      <aside className="rail">
        <div className="rail-logo" onClick={() => navigate('/')}>C</div>

        <nav className="rail-nav">
          {RAIL_NAV.map((item, i) => (
            <button key={i}
              className={`rail-btn${isRailActive(item) ? ' active' : ''}`}
              title={item.title}
              onClick={() => item.to ? navigate(item.to) : null}
            >
              <item.Icon />
              {item.badge && <span className="rail-badge">{item.badge}</span>}
            </button>
          ))}
        </nav>

        <div className="rail-spacer" />

        <div className="rail-bottom">
          <button className="rail-btn" title="Help" style={{ position:'relative' }}>
            <IcHelp />
            <span className="rail-dot" />
          </button>
          <button className="rail-btn" title="Settings" onClick={() => navigate('/settings')}>
            <IcSettings />
          </button>
          <div className="rail-avatar" title={user?.name} onClick={handleLogout} />
        </div>
      </aside>

      {/* ══ TREE NAV ══ */}
      <nav className="tree">

        {/* Brand */}
        <div className="tree-brand">
          Casper.com
          <span className="tree-brand-caret">›</span>
        </div>

        {/* Company switcher */}
        <div className="co-wrap" ref={coRef}>
          <div className="co-btn" onClick={() => setShowCo(p => !p)}>
            <div className="co-dot" style={{ background: company.color }} />
            <span className="co-name">{company.name}</span>
            <span className="co-chev">▾</span>
          </div>
          {showCo && (
            <div className="co-dd">
              {COMPANIES.map((c, i) => (
                <div key={i} className="co-row" onClick={() => { setCompany(c); setShowCo(false) }}>
                  <div className="co-rdot" style={{ background: c.color }} />
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
        <div className="tree-scroll">

          {/* Workspace */}
          <div className="nav-sec">
            <div className="sec-hdr" onClick={() => togSec('workspace')}>
              <span className="sec-lbl">Workspace</span>
              <span className={`sec-chev ${open.workspace ? '' : 'closed'}`}>▾</span>
            </div>
            {open.workspace && WORKSPACE.map(item => {
              if (!item.subItems) return (
                <NavLink key={item.to} to={item.to} end={item.end}
                  className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
                  {item.Icon && <span className="nav-icon"><item.Icon /></span>}
                  {item.label}
                </NavLink>
              )
              const expanded = openWsItem[item.to] ?? true
              return (
                <div key={item.to} className="nav-ws-group">
                  <div className="nav-item nav-ws-hdr" onClick={() => togWsItem(item.to)}>
                    {item.Icon && <span className="nav-icon"><item.Icon /></span>}
                    <span>{item.label}</span>
                    <span className={`sec-chev sec-chev-sm ${expanded ? '' : 'closed'}`}>▾</span>
                  </div>
                  {expanded && item.subItems.map(sub => (
                    <NavLink key={sub.to} to={sub.to} end={sub.end}
                      className={({ isActive }) => `nav-item nav-sub-item${isActive ? ' active' : ''}`}>
                      {sub.label}
                    </NavLink>
                  ))}
                </div>
              )
            })}
          </div>

          {/* P&L */}
          <div className="nav-sec">
            <div className="sec-hdr" onClick={() => togSec('pnl')}>
              <span className="sec-lbl">P&amp;L</span>
              <span className={`sec-chev ${open.pnl ? '' : 'closed'}`}>▾</span>
            </div>
            {open.pnl && <>
              <NavLink to="/pnl/intro"
                className={({ isActive }) => `nav-item nav-sub-item${isActive ? ' active' : ''}`}>
                Overview
              </NavLink>
              {pnlPlatforms.map(p => (
                <NavLink key={p.id} to={`/pnl/${p.name.toLowerCase()}`}
                  className={({ isActive }) => `nav-item nav-sub-item${isActive ? ' active' : ''}`}>
                  <span className="nav-plat-dot" style={{ background: p.color || 'var(--muted-2)' }} />
                  {p.name}
                </NavLink>
              ))}
            </>}
          </div>

          {/* Risk Intelligence */}
          <div className="nav-sec">
            <NavLink to="/fraud"
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
              style={{ display:'flex', alignItems:'center', gap:8 }}>
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{width:16,height:16,flexShrink:0}}><path d="M10 2l1.8 5.4H17l-4.6 3.3 1.8 5.4L10 13l-4.2 3.1 1.8-5.4L3 7.4h5.2L10 2z"/></svg>
              Risk Intelligence
              <span style={{marginLeft:'auto',background:'#ef4444',color:'#fff',borderRadius:4,padding:'1px 5px',fontSize:'0.68rem',fontWeight:700}}>LIVE</span>
            </NavLink>
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
                    <div className="tree-dot" />{label}
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
                      <div className="tree-dot" />{label}
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
                      <div className="tree-dot" />{label}
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
                Platforms & Tiers
              </NavLink>
              <NavLink to="/vendors"
                className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
                Vendors
              </NavLink>
            </>}
          </div>

        </div>

        {/* Footer */}
        <div className="tree-footer">
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

      </nav>

      {/* ══ MAIN COLUMN ══ */}
      <div className="main-col">

        {/* Topbar */}
        <div className="topbar">
          <div className="topbar-brand">
            Casper.com
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M5 3l4 4-4 4"/></svg>
          </div>

          <div className="topbar-search-wrap" ref={srRef}>
            <div className="topbar-search">
              <IcSearch />
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
                      onClick={() => { setQuery(''); setShowSR(false); if (item.to) navigate(item.to) }}>
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
            <button className="tb-btn" title="Menu"><IcMenu /></button>
            <div className="tb-avatar-grad" title={user?.name} />
            <button className="tb-plus" title="New" onClick={() => navigate('/pricing')}><IcPlus /></button>
          </div>
        </div>

        {/* Canvas */}
        <div className="canvas-wrap">
          <main className="canvas">
            <Outlet />
          </main>
        </div>

      </div>
    </div>
  )
}
