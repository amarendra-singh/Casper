import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { login as apiLogin, register as apiRegister, getMe, apiLogout } from '../api/client'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null)
  const [loading, setLoading] = useState(true)

  // On page load — check if token already exists (user was already logged in)
  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (!token) { setLoading(false); return }
    getMe()
      .then(setUser)
      .catch(err => {
        // Only clear tokens on explicit auth failure — not on network errors
        if (err.response?.status === 401) {
          localStorage.removeItem('access_token')
          localStorage.removeItem('refresh_token')
        }
      })
      .finally(() => setLoading(false))
  }, [])

  const _persist = (data, email) => {
    localStorage.setItem('access_token', data.access_token)
    localStorage.setItem('refresh_token', data.refresh_token)
    if (data.companies?.[0]) localStorage.setItem('active_company_id', String(data.companies[0].id))
    setUser({ name: data.name, role: data.role, email })
  }

  const login = useCallback(async (email, password) => {
    const data = await apiLogin(email, password)
    _persist(data, email)
    return data
  }, [])

  const register = useCallback(async (payload) => {
    const data = await apiRegister(payload)
    _persist(data, payload.email)
    return data
  }, [])

  const logout = useCallback(async () => {
    try { await apiLogout() } catch {}
    localStorage.removeItem('access_token')
    localStorage.removeItem('refresh_token')
    localStorage.removeItem('active_company_id')
    setUser(null)
  }, [])

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)