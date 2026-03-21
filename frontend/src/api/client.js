import axios from 'axios'

const api = axios.create({
  baseURL: '/api/v1',
  headers: { 'Content-Type': 'application/json' }
})

// Attach JWT token to every request automatically
api.interceptors.request.use(cfg => {
  const token = localStorage.getItem('access_token')
  if (token) cfg.headers.Authorization = `Bearer ${token}`
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
          const { data } = await axios.post('/api/v1/auth/refresh', { refresh_token: refresh })
          localStorage.setItem('access_token', data.access_token)
          localStorage.setItem('refresh_token', data.refresh_token)
          original.headers.Authorization = `Bearer ${data.access_token}`
          return api(original)
        } catch {
          localStorage.clear()
          window.location.href = '/login'
        }
      }
    }
    return Promise.reject(err)
  }
)

// Auth
export const login = (email, password) =>
  api.post('/auth/login', { email, password }).then(r => r.data)
export const getMe = () =>
  api.get('/auth/me').then(r => r.data)

// Platforms
export const getPlatforms = () => api.get('/platforms/').then(r => r.data)
export const createPlatform = (data) => api.post('/platforms/', data).then(r => r.data)
export const updatePlatform = (id, data) => api.patch(`/platforms/${id}`, data).then(r => r.data)
export const deletePlatform = (id) => api.delete(`/platforms/${id}`).then(r => r.data)

// Vendors
export const getVendors = () => api.get('/vendors/').then(r => r.data)
export const createVendor = (data) => api.post('/vendors/', data).then(r => r.data)
export const updateVendor = (id, data) => api.patch(`/vendors/${id}`, data).then(r => r.data)
export const deleteVendor = (id) => api.delete(`/vendors/${id}`).then(r => r.data)

// Categories
export const getCategories = () => api.get('/categories/').then(r => r.data)
export const createCategory = (data) => api.post('/categories/', data).then(r => r.data)
export const updateCategory = (id, data) => api.patch(`/categories/${id}`, data).then(r => r.data)

// Misc Items
export const getMiscItems = () => api.get('/misc-items/').then(r => r.data)
export const getMiscTotal = () => api.get('/misc-items/total').then(r => r.data)

// Settings
export const getSettings = () => api.get('/settings/').then(r => r.data)
export const updateSetting = (key, value) => api.patch(`/settings/${key}`, { value }).then(r => r.data)

// SKUs
export const getSkus = () => api.get('/skus/').then(r => r.data)
export const getSku = (id) => api.get(`/skus/${id}`).then(r => r.data)
export const createSku = (data) => api.post('/skus/', data).then(r => r.data)
export const updateSku = (id, data) => api.patch(`/skus/${id}`, data).then(r => r.data)
export const deleteSku = (id) => api.delete(`/skus/${id}`).then(r => r.data)

// Pricing
export const getPricingForSku = (skuId) => api.get(`/pricing/sku/${skuId}`).then(r => r.data)
export const createPricing = (data) => api.post('/pricing/', data).then(r => r.data)
export const updatePricing = (id, data) => api.patch(`/pricing/${id}`, data).then(r => r.data)
export const deletePricing = (id) => api.delete(`/pricing/${id}`).then(r => r.data)

// Users
export const getUsers = () => api.get('/users/').then(r => r.data)
export const createUser = (data) => api.post('/users/', data).then(r => r.data)
export const updateUser = (id, data) => api.patch(`/users/${id}`, data).then(r => r.data)
export const deleteUser = (id) => api.delete(`/users/${id}`).then(r => r.data)

// Entries
export const getEntries = () =>
  api.get('/entries/').then(r => r.data)

export const upsertBatch = (rows) =>
  api.post('/entries/upsert-batch', { rows }).then(r => r.data)



// HSN Codes
export const searchHsn = (q) =>
  api.get(`/hsn/search?q=${q}`).then(r => r.data)

export const getHsnList = () =>
  api.get('/hsn/').then(r => r.data)

export const createHsnCode = (data) =>
  api.post('/hsn/', data).then(r => r.data)



export default api