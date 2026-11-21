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
  if (token) {cfg.headers.Authorization = `Bearer ${token}`}
  // A caller-supplied header wins. That is how creating from All Companies works:
  // the form picks a company and sends it for that one request, instead of 'all',
  // which the backend refuses for writes because a record must belong to one entity.
  const cid = localStorage.getItem('active_company_id')
  if (cid && !cfg.headers['X-Company-Id']) {cfg.headers['X-Company-Id'] = cid}
  return cfg
})

/** Request config that targets one company, whatever the switcher is set to. */
export const inCompany = id => ({ headers: { 'X-Company-Id': String(id) } })

// If token expired (401), refresh once and retry. A single page load fires many
// requests at once; when the access token has expired they all 401 together. We
// share ONE in-flight refresh across that burst (single-flight) so they can't
// each rotate the token and race one another into a spurious logout — the exact
// failure that showed up as "switching company logs me out" (a switch reloads
// the app, firing the whole burst at once).
let refreshPromise = null

function forceLogout() {
  localStorage.removeItem('access_token')
  localStorage.removeItem('refresh_token')
  localStorage.removeItem('active_company_id')
  if (!window.location.pathname.startsWith('/login')) {window.location.href = '/login'}
}

api.interceptors.response.use(
  res => res,
  async err => {
    const original = err.config
    if (err.response?.status === 401 && original && !original._retry) {
      original._retry = true
      const refresh = localStorage.getItem('refresh_token')
      if (!refresh) {return Promise.reject(err)}
      try {
        if (!refreshPromise) {
          refreshPromise = axios
            .post(`${API_BASE}/auth/refresh`, { refresh_token: refresh })
            .then(({ data }) => {
              localStorage.setItem('access_token', data.access_token)
              localStorage.setItem('refresh_token', data.refresh_token)
              return data.access_token
            })
            .finally(() => { refreshPromise = null })
        }
        const newToken = await refreshPromise
        original.headers.Authorization = `Bearer ${newToken}`
        return api(original)
      } catch (refreshError) {
        if ([401, 403].includes(refreshError.response?.status)) {forceLogout()}
      }
    }
    return Promise.reject(err)
  }
)

// Auth
export const login         = (email, password) => api.post('/auth/login', { email, password }).then(r => r.data)
export const register      = (data)             => api.post('/auth/register', data).then(r => r.data)
// Companies (multi-tenancy)
export const getCompanies      = (includeArchived) => api.get('/companies/', { params: includeArchived ? { include_archived: true } : {} }).then(r => r.data)
export const restoreCompany    = (id)   => api.post(`/companies/${id}/restore`).then(r => r.data)
export const createCompany     = (data) => api.post('/companies/', data).then(r => r.data)
export const getCompanyContext = (id)   => api.get(`/companies/${id}/context`).then(r => r.data)
export const updateCompanyModules = (id, modules) => api.patch(`/companies/${id}/modules`, { modules }).then(r => r.data)
export const renameCompany     = (id, name, color) => api.patch(`/companies/${id}`, { name, ...(color ? { color } : {}) }).then(r => r.data)
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

// Product catalogue: company-scoped profiles, shared physical stock and media.
export const getCatalogue = params => api.get('/catalogue', { params }).then(r => r.data)
export const bulkCreateCatalogue = rows => api.post('/catalogue/bulk-products', { rows }).then(r => r.data)
export const applyCatalogueSheet = body => api.post('/catalogue/bulk-apply', body,
  { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data)
export const getCatalogueProduct = (id, params) => api.get(`/catalogue/${id}`, { params }).then(r => r.data)
export const updateCatalogueProduct = (id, data) => api.patch(`/catalogue/${id}`, data).then(r => r.data)
export const updateCatalogueReverseShipping = (id, data) => api.put(`/catalogue/${id}/reverse-shipping`, data).then(r => r.data)
export const getStockItems = () => api.get('/catalogue/stock-items').then(r => r.data)
export const createStockItem = data => api.post('/catalogue/stock-items', data).then(r => r.data)
export const linkProductStock = (id, data) => api.post(`/catalogue/${id}/stock-link`, data).then(r => r.data)
export const recordStockMovement = (id, data) => api.post(`/catalogue/${id}/movements`, data).then(r => r.data)
export const reverseStockMovement = (id, data) => api.post(`/catalogue/movements/${id}/reverse`, data).then(r => r.data)
export const approveStockCost = (id, data) => api.post(`/catalogue/stock-items/${id}/costs`, data).then(r => r.data)
export const previewStockCost = id => api.get(`/catalogue/stock-items/${id}/cost-preview`).then(r => r.data)
export const applyStockCost = (id, token) => api.post(`/catalogue/stock-items/${id}/cost-apply`, { token }).then(r => r.data)
export const getProductImage = (id, thumb = false) => api.get(`/catalogue/images/${id}`, { params: { thumb }, responseType: 'blob' }).then(r => r.data)
export const uploadProductImage = (skuId, formData) => api.post(`/catalogue/${skuId}/images`, formData, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data)
export const setProductPrimaryImage = id => api.post(`/catalogue/images/${id}/primary`).then(r => r.data)
export const deleteProductImage = id => api.delete(`/catalogue/images/${id}`).then(r => r.data)

// Pricing
export const getPricingForSku = (skuId)   => api.get(`/pricing/sku/${skuId}`).then(r => r.data)
export const createPricing    = (data, cfg) => api.post('/pricing/', data, cfg).then(r => r.data)
export const updatePricing    = (id,data) => api.patch(`/pricing/${id}`, data).then(r => r.data)
export const deletePricing    = (id)      => api.delete(`/pricing/${id}`).then(r => r.data)

// Users
export const getUsers      = ()        => api.get('/users/').then(r => r.data)
export const createUser    = (data)    => api.post('/users/', data).then(r => r.data)
export const updateUser    = (id,data) => api.patch(`/users/${id}`, data).then(r => r.data)
export const deleteUser    = (id)      => api.delete(`/users/${id}`).then(r => r.data)

// Entries — backend route stays /entries/ (batch operations for SKU page)
export const getEntries    = params => api.get('/entries/', { params }).then(r => r.data)
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
export const getUnmatchedSkus           = (reportId)   => api.get('/pnl/unmatched-skus', { params: reportId ? { report_id: reportId } : {} }).then(r => r.data)
export const addHiddenSkuPricing        = (payload)    => api.post('/pnl/hidden-skus/add', payload).then(r => r.data)
export const getPnlRows                 = (reportId)   => api.get(`/pnl/rows/${reportId}`).then(r => r.data)

// Billing / expense ledger
export const getLedger        = (params) => api.get('/ledger/', { params }).then(r => r.data)
export const getLedgerSummary = (params) => api.get('/ledger/summary', { params }).then(r => r.data)
export const createLedgerEntry= (data, cfg) => api.post('/ledger/', data, cfg).then(r => r.data)
export const updateLedgerEntry= (id, data) => api.patch(`/ledger/${id}`, data).then(r => r.data)
export const deleteLedgerEntry= (id)     => api.delete(`/ledger/${id}`).then(r => r.data)

// Bill discrepancies — parse an order export and/or a supplier bill statement.
// Bills are persisted so SKU links, aliases and applied costs survive.
export const checkBillDiscrepancies = (formData) =>
  api.post('/billing/discrepancies', formData, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data)
export const getPurchaseBills = () => api.get('/billing/purchase-bills').then(r => r.data)
export const autoMatchPurchaseBills = () => api.post('/billing/purchase-bills/auto-match').then(r => r.data)
export const linkBillLine = (lineId, { sku_id, pack_multiple = 1, remember = true }) =>
  api.post(`/billing/purchase-bills/lines/${lineId}/link`, null,
    { params: { sku_id, pack_multiple, remember } }).then(r => r.data)
export const applyBillCost = (lineId, pricingId) =>
  api.post(`/billing/purchase-bills/lines/${lineId}/apply-cost`, null, { params: { pricing_id: pricingId } }).then(r => r.data)

export default api
/**
 * Safe message from an axios error.
 *
 * FastAPI returns `detail` as a plain string for HTTPException but as an ARRAY of
 * {type, loc, msg, input} objects for validation errors. Passing that array
 * straight into state and rendering it crashes React with "Objects are not valid
 * as a React child" — which is exactly how the Team page went blank in group mode.
 */
export function errText(e, fallback = 'Something went wrong') {
  const d = e?.response?.data?.detail
  if (typeof d === 'string') {return d}
  if (Array.isArray(d)) {return d.map(x => x?.msg).filter(Boolean).join('; ') || fallback}
  if (d && typeof d === 'object') {return d.msg || d.detail || fallback}
  return e?.message || fallback
}

export const getFinancialHistory = beforeId => api.get("/change-history/", { params: { limit: 100, before_id: beforeId } }).then(r => r.data)
export const undoFinancialChange = id => api.post(`/change-history/${id}/undo`).then(r => r.data)

export const rematchPnlReport = reportId => api.post(`/pnl/rematch/${reportId}`).then(r => r.data)

export const linkMarketplaceSku = payload => api.post("/pnl/marketplace-link", payload).then(r => r.data)

export const previewPricingRefresh = () => api.post("/pricing/refresh-preview").then(r => r.data)
export const applyPricingRefresh = token => api.post("/pricing/refresh-apply", { token }).then(r => r.data)

export const updateBillUnits = (id, data) => api.patch(`/billing/purchase-bills/lines/${id}/units`, data).then(r => r.data)

export const getBillSkuOptions = () => api.get("/billing/purchase-bills/sku-options").then(r => r.data)

export const editBillRow = (id, data) => api.patch(`/billing/purchase-bills/lines/${id}`, data).then(r => r.data)
