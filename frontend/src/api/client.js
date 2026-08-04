import axios from 'axios'

// In dev this stays '/api/v1' (Vite proxies it to the backend). In production
// (e.g. Cloudflare Pages, which is static-only) set VITE_API_BASE to the
// deployed backend's absolute URL, e.g. https://api.example.com/api/v1
export const API_BASE = import.meta.env.VITE_API_BASE || '/api/v1'

const api = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' }
})

// Attach JWT token + active company to every request automatically
api.interceptors.request.use(cfg => {
  const token = localStorage.getItem('access_token')
  if (token) cfg.headers.Authorization = `Bearer ${token}`
  const cid = localStorage.getItem('active_company_id')
  if (cid) cfg.headers['X-Company-Id'] = cid
  return cfg
})

// If token expired (401), try refresh token automatically
api.interceptors.response.use(
  res => res,
  async err => {
    const original = err.config
    if (err.response?.status === 401 && !original._retry) {
      original._retry = true
      const refresh = localStorage.getItem('refresh_token')
      if (refresh) {
        try {
          const { data } = await axios.post(`${API_BASE}/auth/refresh`, { refresh_token: refresh })
          localStorage.setItem('access_token', data.access_token)
          localStorage.setItem('refresh_token', data.refresh_token)
          original.headers.Authorization = `Bearer ${data.access_token}`
          return api(original)
        } catch {
          localStorage.removeItem('access_token')
          localStorage.removeItem('refresh_token')
          window.location.href = '/login'
        }
      }
    }
    return Promise.reject(err)
  }
)

// Auth
export const login         = (email, password) => api.post('/auth/login', { email, password }).then(r => r.data)
export const register      = (data)             => api.post('/auth/register', data).then(r => r.data)
// Companies (multi-tenancy)
export const getCompanies      = ()     => api.get('/companies/').then(r => r.data)
export const createCompany     = (data) => api.post('/companies/', data).then(r => r.data)
export const getCompanyContext = (id)   => api.get(`/companies/${id}/context`).then(r => r.data)
export const updateCompanyModules = (id, modules) => api.patch(`/companies/${id}/modules`, { modules }).then(r => r.data)
export const renameCompany     = (id, name)  => api.patch(`/companies/${id}`, { name }).then(r => r.data)
export const archiveCompany    = (id)        => api.delete(`/companies/${id}`).then(r => r.data)
export const leaveCompany      = (id)        => api.post(`/companies/${id}/leave`).then(r => r.data)
// Company team members
export const getMembers        = (id)        => api.get(`/companies/${id}/members`).then(r => r.data)
export const inviteMember      = (id, data)  => api.post(`/companies/${id}/members`, data).then(r => r.data)
export const updateMemberRole  = (id, uid, role) => api.patch(`/companies/${id}/members/${uid}`, { role }).then(r => r.data)
export const removeMember      = (id, uid)   => api.delete(`/companies/${id}/members/${uid}`).then(r => r.data)
export const getMe         = ()                => api.get('/auth/me').then(r => r.data)
export const changePassword= (data)            => api.post('/auth/change-password', data).then(r => r.data)
export const apiLogout     = ()                => api.post('/auth/logout').then(r => r.data)

// Platforms
export const getPlatforms  = ()        => api.get('/platforms/').then(r => r.data)
export const createPlatform= (data)    => api.post('/platforms/', data).then(r => r.data)
export const updatePlatform= (id,data) => api.patch(`/platforms/${id}`, data).then(r => r.data)
export const deletePlatform= (id)      => api.delete(`/platforms/${id}`).then(r => r.data)

// Vendors
export const getVendors    = ()        => api.get('/vendors/').then(r => r.data)
export const createVendor  = (data)    => api.post('/vendors/', data).then(r => r.data)
export const updateVendor  = (id,data) => api.patch(`/vendors/${id}`, data).then(r => r.data)
export const deleteVendor  = (id)      => api.delete(`/vendors/${id}`).then(r => r.data)

// Categories
export const getCategories  = ()        => api.get('/categories/').then(r => r.data)
export const createCategory = (data)    => api.post('/categories/', data).then(r => r.data)
export const updateCategory = (id,data) => api.patch(`/categories/${id}`, data).then(r => r.data)
export const deleteCategory = (id)      => api.delete(`/categories/${id}`).then(r => r.data)

// Misc Items
export const getMiscItems  = ()        => api.get('/misc-items/').then(r => r.data)
export const getMiscTotal  = ()        => api.get('/misc-items/total').then(r => r.data)
export const createMiscItem= (data)    => api.post('/misc-items/', data).then(r => r.data)
export const updateMiscItem= (id,data) => api.patch(`/misc-items/${id}`, data).then(r => r.data)
export const deleteMiscItem= (id)      => api.delete(`/misc-items/${id}`).then(r => r.data)

// Settings
export const getSettings   = ()        => api.get('/settings/').then(r => r.data)
export const updateSetting = (key,val) => api.patch(`/settings/${key}`, { value: val }).then(r => r.data)

// SKUs
export const getSkus       = ()        => api.get('/skus/').then(r => r.data)
export const getSku        = (id)      => api.get(`/skus/${id}`).then(r => r.data)
export const createSku     = (data)    => api.post('/skus/', data).then(r => r.data)
export const updateSku     = (id,data) => api.patch(`/skus/${id}`, data).then(r => r.data)
export const deleteSku     = (id)      => api.delete(`/skus/${id}`).then(r => r.data)

// Pricing
export const getPricingForSku = (skuId)   => api.get(`/pricing/sku/${skuId}`).then(r => r.data)
export const createPricing    = (data)    => api.post('/pricing/', data).then(r => r.data)
export const updatePricing    = (id,data) => api.patch(`/pricing/${id}`, data).then(r => r.data)
export const deletePricing    = (id)      => api.delete(`/pricing/${id}`).then(r => r.data)

// Users
export const getUsers      = ()        => api.get('/users/').then(r => r.data)
export const createUser    = (data)    => api.post('/users/', data).then(r => r.data)
export const updateUser    = (id,data) => api.patch(`/users/${id}`, data).then(r => r.data)
export const deleteUser    = (id)      => api.delete(`/users/${id}`).then(r => r.data)

// Entries — backend route stays /entries/ (batch operations for SKU page)
export const getEntries    = ()     => api.get('/entries/').then(r => r.data)
export const upsertBatch   = (rows) => api.post('/entries/upsert-batch', { rows }).then(r => r.data)

// HSN Codes
export const searchHsn     = (q)    => api.get(`/hsn/search?q=${q}`).then(r => r.data)
export const getHsnList    = ()     => api.get('/hsn/').then(r => r.data)
export const createHsnCode = (data) => api.post('/hsn/', data).then(r => r.data)

// P&L
export const getPnlReports              = (platformId) => api.get('/pnl/reports', { params: platformId ? { platform_id: platformId } : {} }).then(r => r.data)
export const getPnlReport               = (id)         => api.get(`/pnl/reports/${id}`).then(r => r.data)
export const deletePnlReport            = (id)         => api.delete(`/pnl/reports/${id}`)
export const getPnlPlatformsWithReports = ()           => api.get('/pnl/platforms-with-reports').then(r => r.data)
export const getPnlDashboard            = ()           => api.get('/pnl/dashboard').then(r => r.data)
export const uploadPnlReport            = (formData)   => api.post('/pnl/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data)
export const uploadShopdeckCustomers    = (formData)   => api.post('/pnl/shopdeck-customers', formData, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data)
export const getPnlStatement            = (reportId)   => api.get(`/pnl/statement/${reportId}`).then(r => r.data)
export const getPnlTrend                = (platformId) => api.get('/pnl/trend', { params: platformId ? { platform_id: platformId } : {} }).then(r => r.data)
export const getPnlConsolidated         = ()           => api.get('/pnl/consolidated').then(r => r.data)
export const getUnmatchedSkus           = ()           => api.get('/pnl/unmatched-skus').then(r => r.data)
export const getPnlRows                 = (reportId)   => api.get(`/pnl/rows/${reportId}`).then(r => r.data)

// Billing / expense ledger
export const getLedger        = (params) => api.get('/ledger/', { params }).then(r => r.data)
export const getLedgerSummary = (params) => api.get('/ledger/summary', { params }).then(r => r.data)
export const createLedgerEntry= (data)   => api.post('/ledger/', data).then(r => r.data)
export const updateLedgerEntry= (id, data) => api.patch(`/ledger/${id}`, data).then(r => r.data)
export const deleteLedgerEntry= (id)     => api.delete(`/ledger/${id}`).then(r => r.data)

export default api