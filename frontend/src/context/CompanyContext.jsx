import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { getCompanies, createCompany as apiCreate, getCompanyContext, updateCompanyModules,
         renameCompany as apiRename, archiveCompany as apiArchive, leaveCompany as apiLeave,
         restoreCompany as apiRestore } from '../api/client'
import { useAuth } from './AuthContext'

const CompanyContext = createContext(null)

export const ALL = 'all'   // sentinel for group mode; sent as the X-Company-Id header

export function CompanyProvider({ children }) {
  const { user } = useAuth()
  const [companies, setCompanies] = useState([])
  // 'all' = group mode: consolidated reads across every company the user belongs to.
  // Writes stay single-company (the backend refuses non-GET while in group mode).
  const [activeId, setActiveId] = useState(() => {
    const v = localStorage.getItem('active_company_id')
    if (v === ALL) return ALL
    return v ? Number(v) : null
  })
  const isAll = activeId === ALL

  const load = useCallback(async () => {
    if (!localStorage.getItem('access_token')) { setCompanies([]); return }
    try {
      const cs = await getCompanies()
      setCompanies(cs)
      const raw = localStorage.getItem('active_company_id')
      if (raw === ALL) { setActiveId(ALL); return }   // stay in group mode across reloads
      const stored = Number(raw)
      const next = cs.find(c => c.id === stored) ? stored : (cs[0]?.id ?? null)
      if (next) { localStorage.setItem('active_company_id', String(next)); setActiveId(next) }
    } catch { /* unauthenticated or none yet */ }
  }, [])

  // Re-fetch whenever the logged-in user changes (login / logout).
  useEffect(() => { load() }, [user, load])

  // Load the active company's enabled modules + the user's role in it.
  const [modules, setModules] = useState({})
  const [role, setRole] = useState(null)
  useEffect(() => {
    if (!activeId || !localStorage.getItem('access_token')) { setModules({}); setRole(null); return }
    // Master view: every feature is available. Per-company views stay restricted
    // to that company's own enabled modules (below). Enabling all keys here — not
    // just the union of what companies happen to have on — keeps the master a
    // true superset, so a feature never disappears from it because every company
    // switched it off.
    if (activeId === ALL) {
      if (!companies.length) return
      Promise.all(companies.map(c => getCompanyContext(c.id).catch(() => null)))
        .then(ctxs => {
          const all = {}
          ctxs.filter(Boolean).forEach(ctx => {
            Object.keys(ctx.modules || {}).forEach(k => { all[k] = true })
          })
          setModules(all); setRole(null)
        })
      return
    }
    getCompanyContext(activeId)
      .then(ctx => { setModules(ctx.modules || {}); setRole(ctx.company?.role || null) })
      .catch(() => {})
  }, [activeId, user, companies])

  const updateModules = useCallback(async (next) => {
    const ctx = await updateCompanyModules(activeId, next)
    setModules(ctx.modules || {})
    return ctx.modules
  }, [activeId])

  // Switching company reloads the app so every screen refetches scoped data.
  const setActive = useCallback((id) => {
    localStorage.setItem('active_company_id', String(id))   // 'all' stays a string
    setActiveId(id === ALL ? ALL : Number(id))
    window.location.assign('/')
  }, [])

  const createCompany = useCallback(async (name, color) => {
    const co = await apiCreate({ name, color })
    setCompanies(p => [...p, co])
    return co
  }, [])

  const renameCompany = useCallback(async (id, name, color) => {
    const co = await apiRename(id, name, color)
    setCompanies(p => p.map(c => (c.id === id ? { ...c, name: co.name, color: co.color } : c)))
    return co
  }, [])

  // After archiving or leaving a company: if it was active, drop the stored id
  // and hard-reload so load() picks a new first company; otherwise just refetch.
  const afterRemoval = useCallback(async (id) => {
    if (id === activeId) {
      localStorage.removeItem('active_company_id')
      window.location.assign('/')
    } else {
      await load()
    }
  }, [activeId, load])

  const archiveCompany = useCallback(async (id) => { await apiArchive(id); await afterRemoval(id) }, [afterRemoval])
  const leaveCompany   = useCallback(async (id) => { await apiLeave(id);   await afterRemoval(id) }, [afterRemoval])
  const restoreCompany = useCallback(async (id) => { await apiRestore(id); await load() }, [load])

  const activeCompany = isAll
    ? { id: ALL, name: 'All Companies', color: 'var(--ink)', role: null, isAll: true }
    : (companies.find(c => c.id === activeId) || companies[0] || null)

  return (
    <CompanyContext.Provider value={{ companies, activeCompany, activeId, isAll, setActive, createCompany,
        renameCompany, archiveCompany, leaveCompany, restoreCompany, reload: load, modules, role, updateModules }}>
      {children}
    </CompanyContext.Provider>
  )
}

export const useCompany = () => useContext(CompanyContext)
