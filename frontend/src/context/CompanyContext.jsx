import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { getCompanies, createCompany as apiCreate, getCompanyContext, updateCompanyModules } from '../api/client'
import { useAuth } from './AuthContext'

const CompanyContext = createContext(null)

export function CompanyProvider({ children }) {
  const { user } = useAuth()
  const [companies, setCompanies] = useState([])
  const [activeId, setActiveId] = useState(() => {
    const v = localStorage.getItem('active_company_id')
    return v ? Number(v) : null
  })

  const load = useCallback(async () => {
    if (!localStorage.getItem('access_token')) { setCompanies([]); return }
    try {
      const cs = await getCompanies()
      setCompanies(cs)
      const stored = Number(localStorage.getItem('active_company_id'))
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
    getCompanyContext(activeId)
      .then(ctx => { setModules(ctx.modules || {}); setRole(ctx.company?.role || null) })
      .catch(() => {})
  }, [activeId, user])

  const updateModules = useCallback(async (next) => {
    const ctx = await updateCompanyModules(activeId, next)
    setModules(ctx.modules || {})
    return ctx.modules
  }, [activeId])

  // Switching company reloads the app so every screen refetches scoped data.
  const setActive = useCallback((id) => {
    localStorage.setItem('active_company_id', String(id))
    setActiveId(id)
    window.location.assign('/')
  }, [])

  const createCompany = useCallback(async (name, color) => {
    const co = await apiCreate({ name, color })
    setCompanies(p => [...p, co])
    return co
  }, [])

  const activeCompany = companies.find(c => c.id === activeId) || companies[0] || null

  return (
    <CompanyContext.Provider value={{ companies, activeCompany, activeId, setActive, createCompany, reload: load, modules, role, updateModules }}>
      {children}
    </CompanyContext.Provider>
  )
}

export const useCompany = () => useContext(CompanyContext)
