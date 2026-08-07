import { useState, useRef, useEffect } from 'react'
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useCompany } from '../context/CompanyContext'
import { getPlatforms } from '../api/client'
import './Layout.css'

// ── SVG Icons ──────────────────────────────────────────────────────────────
const IcHome    = () => <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9.5L10 3l7 6.5V17a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5z"/><path d="M7 18V11h6v7"/></svg>
const IcLayers  = () => <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12l8 4 8-4M2 8l8 4 8-4M2 4l8 4 8-4"/></svg>
const IcChart   = () => <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3 17V7m4 10V3m4 14v-6m4 6v-4"/></svg>
const IcDoc     = () => <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V6l-3-4z"/><path d="M13 2v4h4M7 9h6M7 12h6M7 15h4"/></svg>
const IcEdit    = () => <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2.5a2.12 2.12 0 0 1 3 3L6 17l-4 1 1-4 11.5-11.5z"/></svg>
const IcSettings= () => <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="10" cy="10" r="2.5"/><path d="M10 2v1.5M10 16.5V18M2 10h1.5M16.5 10H18M4.22 4.22l1.06 1.06M14.72 14.72l1.06 1.06M4.22 15.78l1.06-1.06M14.72 5.28l1.06-1.06"/></svg>
const IcSearch  = () => <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="9" r="6"/><path d="M17 17l-3.5-3.5"/></svg>
const IcPlus    = () => <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M10 4v12M4 10h12"/></svg>
const IcChevron = () => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 4l4 4-4 4"/></svg>
const IcUsers   = () => <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M13 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM3 17a7 7 0 0 1 14 0"/></svg>
const IcTag     = () => <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3h6l8 8a2 2 0 0 1 0 2.83l-3.17 3.17a2 2 0 0 1-2.83 0L3 9V3z"/><circle cx="7" cy="7" r="1" fill="currentColor" stroke="none"/></svg>
const IcPnl     = () => <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="16" height="14" rx="2"/><path d="M6 8h5M6 11h8M6 14h4"/><path d="M14 6l1.5 1.5L14 9"/></svg>
const IcCalc    = () => <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="2" width="12" height="16" rx="2"/><path d="M7 6h6M7 10h.01M10 10h.01M13 10h.01M7 13h.01M10 13h.01M13 13v3"/></svg>
const IcLedger  = () => <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 3h9a2 2 0 0 1 2 2v12a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2V4a1 1 0 0 1 1-1z"/><path d="M3 7h12M8 3v14"/></svg>
const IcInvoice = () => <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 2h10v16l-2.5-1.5L10 18l-2.5-1.5L5 18V2z"/><path d="M8 7h4M8 10h4"/></svg>

// ── Nav data ──────────────────────────────────────────────────────────────
const RAIL_NAV = [
  { to: '/',           title: 'Dashboard', Icon: IcHome,  end: true },
  { to: '/skus',       title: 'SKUs',      Icon: IcLayers },
  { to: '/pricing',    title: 'Pricing',   Icon: IcTag },
  { to: '/fraud',      title: 'Fraud',     Icon: IcChart },
  { to: '/pnl/flipkart', title: 'P&L reports', Icon: IcDoc },
]

const WORKSPACE = [
  { to: '/',         label: 'Dashboard', Icon: IcHome,     end: true },
  { to: '/skus',     label: 'SKUs',      Icon: IcLayers,   module: 'skus', subItems: [
    { to: '/skus',         label: 'Manage SKUs',    end: true },
    { to: '/skus/intro',   label: 'Overview' },
  ]},
  { to: '/vendors',  label: 'Vendors',   Icon: IcUsers,    module: 'skus', subItems: [
    { to: '/vendors',        label: 'Manage Vendors', end: true },
    { to: '/vendors/intro',  label: 'Overview' },
  ]},
  { to: '/pricing',  label: 'Pricing',   Icon: IcTag,      module: 'pricing', subItems: [
    { to: '/pricing',        label: 'New Pricing',   end: true },
    { to: '/pricing/intro',  label: 'Overview' },
  ]},
  { to: '/calculator', label: 'Profit Calculator', Icon: IcCalc, module: 'calculator', end: true },
  { to: '/billing', label: 'Billing & Invoices', Icon: IcInvoice, module: 'billing', end: true },
  { to: '/ledger', label: 'Expense Ledger', Icon: IcLedger, module: 'ledger', end: true },
  { to: '/users', label: 'Users', Icon: IcUsers, module: 'users', end: true },
  { to: '/settings', label: 'Settings',  Icon: IcSettings, subItems: [
    { to: '/companies',      label: 'Companies' },
    { to: '/settings',       label: 'Platforms & Tiers', end: true },
    { to: '/settings/intro', label: 'Overview' },
  ]},
]

const ANALYTICS      = ['Overview','Revenue','Platform Performance','SKU Analysis']
const REPORTS_MY     = ['Sales Report','Profitability','Platform Compare']
const REPORTS_SHARED = ['Weekly Summary','Deal Duration']

const ALL_SEARCH = [
  { label: 'Dashboard',         sub: 'Workspace', to: '/' },
  { label: 'Manage SKUs',       sub: 'Workspace', to: '/skus' },
  { label: 'Vendors',           sub: 'Workspace', to: '/vendors' },
  { label: 'Pricing',           sub: 'Workspace', to: '/pricing' },
  { label: 'Profit Calculator', sub: 'Workspace', to: '/calculator' },
  { label: 'Fraud Detection',   sub: 'Analytics', to: '/fraud' },
  { label: 'P&L reports',       sub: 'Reports',   to: '/pnl/flipkart' },
  { label: 'Team',              sub: 'Company',   to: '/users' },
  { label: 'Platforms & Tiers', sub: 'Settings',  to: '/settings' },
  { label: 'Account',           sub: 'Settings',  to: '/account' },
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
  const { companies, activeCompany, isAll, setActive, createCompany, modules } = useCompany()
  const company = activeCompany || { name: 'Select company', color: 'var(--muted-2)' }
  // Enter/Space activation for role="button" divs (keyboard a11y).
  const onKey = fn => e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn() } }
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
              title={item.title} aria-label={item.title}
              onClick={() => item.to ? navigate(item.to) : null}
            >
              <item.Icon />
              {item.badge && <span className="rail-badge">{item.badge}</span>}
            </button>
          ))}
        </nav>

        <div className="rail-spacer" />

        <div className="rail-bottom">
          <button className="rail-btn" title="Settings" aria-label="Settings" onClick={() => navigate('/settings')}>
            <IcSettings />
          </button>
          <div className="rail-avatar" role="button" tabIndex={0}
            title={`${user?.name || 'Account'} · account`} aria-label="Account settings"
            onClick={() => navigate('/account')} onKeyDown={onKey(() => navigate('/account'))} />
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
          <div className="co-btn" role="button" tabIndex={0}
            aria-haspopup="menu" aria-expanded={showCo}
            aria-label={`Current company: ${company.name}. Switch company`}
            onClick={() => setShowCo(p => !p)} onKeyDown={onKey(() => setShowCo(p => !p))}>
            <div className="co-dot" style={{ background: company.color }} />
            <span className="co-name">{company.name}</span>
            <span className="co-chev">▾</span>
          </div>
          {showCo && (
            <div className="co-dd" role="menu">
              {/* Group mode — consolidated reads across every company. */}
              {companies.length > 1 && (() => {
                const pickAll = () => { setShowCo(false); if (!isAll) setActive('all') }
                return (
                  <div className={`co-row co-row-all${isAll ? ' on' : ''}`} role="menuitem" tabIndex={0}
                    aria-label={`All Companies, consolidated${isAll ? ', active' : ''}`}
                    onClick={pickAll} onKeyDown={onKey(pickAll)}>
                    <div className="co-rdot co-rdot-all" />
                    <div>
                      <div className="co-rname">All Companies</div>
                      <div className="co-rsub">
                        Consolidated · {companies.length} companies{isAll ? ' · active' : ''}
                      </div>
                    </div>
                  </div>
                )
              })()}
              {companies.map(c => {
                const pick = () => { setShowCo(false); if (c.id !== activeCompany?.id) setActive(c.id) }
                return (
                  <div key={c.id} className="co-row" role="menuitem" tabIndex={0}
                    aria-label={`${c.name}, ${c.role}${c.id === activeCompany?.id ? ', active' : ''}`}
                    onClick={pick} onKeyDown={onKey(pick)}>
                    <div className="co-rdot" style={{ background: c.color }} />
                    <div>
                      <div className="co-rname">{c.name}</div>
                      <div className="co-rsub">{c.role}{c.id === activeCompany?.id ? ' · active' : ''}</div>
                    </div>
                  </div>
                )
              })}
              {/* Creating used to happen through a raw window.prompt() here — no colour,
                  no validation. It now goes to the Companies page, which owns company CRUD. */}
              <div className="co-add" role="menuitem" tabIndex={0} aria-label="Manage companies"
                onClick={() => { setShowCo(false); navigate('/companies') }}
                onKeyDown={onKey(() => { setShowCo(false); navigate('/companies') })}>
                <span className="co-add-plus">+</span>
                <span className="co-add-label">Add / manage companies</span>
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
            {open.workspace && WORKSPACE.filter(item => !item.module || modules[item.module] !== false).map(item => {
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
              <NavLink to="/pnl/business"
                className={({ isActive }) => `nav-item nav-sub-item${isActive ? ' active' : ''}`}>
                Business P&amp;L
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
              Fraud Detection
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
              <span className={`sec-chev ${open.reports ? '' : 'closed'}`}>▾</span>
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
                      <span className="soon-pill">Soon</span>
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
                      <span className="soon-pill">Soon</span>
                    </div>
                  ))}
                </div>
              )}
            </>}
          </div>

          {/* NOTE: a second "Settings" section used to live here, linking to the same
              /settings route as the Workspace item above and re-listing Vendors (already
              its own Workspace item). Removed — one Settings entry, one home per feature. */}

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
              <button className="nf-btn" onClick={() => navigate('/account')} title="Account" aria-label="Account settings">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/></svg>
              </button>
              <button className="nf-btn" onClick={handleLogout} title="Logout" aria-label="Logout">⎋</button>
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

          {/* Group-mode indicator. This was a full-width band above every page —
              it is one short fact, so it belongs in the bar that already exists. */}
          {isAll && (
            <span className="group-pill" title={`Consolidated across ${companies.length} companies · read-only; switch to a company to add or edit`}>
              <span className="group-pill-dot" />
              All Companies
              <span className="group-pill-n">{companies.length}</span>
            </span>
          )}

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
            <div className="tb-avatar-grad" role="button" tabIndex={0}
              title={user?.name} aria-label="Account settings"
              onClick={() => navigate('/account')} onKeyDown={onKey(() => navigate('/account'))} />
            <button className="tb-plus" title="New pricing" aria-label="New pricing"
              onClick={() => navigate('/pricing')}><IcPlus /></button>
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
