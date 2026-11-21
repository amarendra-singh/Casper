import { Routes, Route, Navigate, Link } from 'react-router-dom'
import { Component, lazy, Suspense } from 'react'
import { AuthProvider, useAuth } from './context/AuthContext'
import { CompanyProvider, useCompany } from './context/CompanyContext'

class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(e) { return { error: e } }
  render() {
    if (this.state.error) {return (
      <div role="alert" style={{ padding: 24 }}>
        <h1>Something went wrong</h1>
        <p>Reload to recover. Your saved records are safe.</p>
        <button className="btn btn-ghost" onClick={() => window.location.reload()}>Reload application</button>
      </div>
    )}
    return this.props.children
  }
}
import Layout from './components/Layout'
import Login from './pages/Login'
import Register from './pages/Register'
// Route pages are code-split so heavy deps (recharts) load
// only when their page is visited — keeps the initial bundle small.
const Dashboard = lazy(() => import('./pages/Dashboard'))

const ProductLayout = lazy(() => import('./pages/Product/ProductLayout'))
const UnitEconomics = lazy(() => import('./pages/Product/UnitEconomics'))
const Catalogue = lazy(() => import('./pages/Product/Catalogue'))
const ProductProfile = lazy(() => import('./pages/Product/ProductProfile'))
const CategoriesPage = lazy(() => import('./pages/Product/Categories'))
const Pricing = lazy(() => import('./pages/Pricing'))
const Vendors = lazy(() => import('./pages/Vendors'))
const PnLList = lazy(() => import('./pages/PnL/PnLList'))
const PnLReport = lazy(() => import('./pages/PnL/PnLReport'))
const ConsolidatedPnL = lazy(() => import('./pages/PnL/ConsolidatedPnL'))
const Companies = lazy(() => import('./pages/Companies'))
const Settings = lazy(() => import('./pages/Settings'))
const ProfitCalculator = lazy(() => import('./pages/ProfitCalculator'))
const Users = lazy(() => import('./pages/Users'))
const Account = lazy(() => import('./pages/Account'))
const Ledger = lazy(() => import('./pages/Ledger'))
const Billing = lazy(() => import('./pages/Billing'))
const FraudDashboard = lazy(() => import('./pages/Fraud/FraudDashboard'))
const FraudPlatformPage = lazy(() => import('./pages/Fraud/FraudPlatformPage'))
const PnLIntro = lazy(() => import('./pages/intros/PnLIntro'))
const SKUsIntro = lazy(() => import('./pages/intros/SKUsIntro'))
const VendorsIntro = lazy(() => import('./pages/intros/VendorsIntro'))
const PricingIntro = lazy(() => import('./pages/intros/PricingIntro'))
const SettingsIntro = lazy(() => import('./pages/intros/SettingsIntro'))

const RouteLoader = () => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
    <div className="loader" style={{ width: 28, height: 28 }} />
  </div>
)

function ProtectedRoute({ children }) {
  const { user, loading, error, retrySession } = useAuth()
  if (error) {return <div role="alert">{error} <button onClick={retrySession}>Retry</button></div>}
  if (loading) {return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh' }}>
      <div className="loader" style={{ width:32, height:32 }} />
    </div>
  )}
  return user ? children : <Navigate to="/login" replace />
}

// Blocks direct-URL access to a module the active company has turned off,
// mirroring the sidebar nav (which hides disabled modules). Modules default
// to enabled, so we only block on an explicit `false`. Settings is never
// gated — it's where an owner re-enables modules.
function RequireModule({ module, children }) {
  const { modules, contextReady } = useCompany()
  if (!contextReady) {return <div role="status">Loading company access…</div>}
  if (modules && modules[module] === false) {return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'60vh', gap:10, textAlign:'center', padding:24 }}>
      <div style={{ fontSize:15, fontWeight:600 }}>This module is turned off for this company</div>
      <div style={{ fontSize:13, color:'var(--text-2)', maxWidth:380 }}>
        An owner can re-enable it under Settings → Modules.
      </div>
      <Link to="/settings" style={{ fontSize:13, textDecoration:'underline' }}>Go to Settings</Link>
    </div>
  )}
  return children
}

function AppRoutes() {
  const { user } = useAuth()
  return (
    <Routes>
      {/* <Route path="entries" element={<Entries />} /> */}
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/register" element={user ? <Navigate to="/" replace /> : <Register />} />
      <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route index element={<Dashboard />} />
        <Route path="skus/intro" element={<RequireModule module="skus"><SKUsIntro /></RequireModule>} />
        <Route path="skus" element={<Navigate to="/product/unit-economics" replace />} />
        <Route path="product" element={<RequireModule module="skus"><ProductLayout /></RequireModule>}>
          <Route index element={<Navigate to="catalogue" replace />} />
          <Route path="catalogue" element={<Catalogue />} />
          <Route path="catalogue/:skuId" element={<ProductProfile />} />
          <Route path="unit-economics" element={<UnitEconomics />} />
          <Route path="inventory" element={<Navigate to="/product/catalogue" replace />} />
          <Route path="categories" element={<CategoriesPage />} />
        </Route>
        <Route path="calculator" element={<RequireModule module="calculator"><ProfitCalculator /></RequireModule>} />
        <Route path="ledger" element={<RequireModule module="ledger"><Ledger /></RequireModule>} />
        <Route path="billing" element={<RequireModule module="billing"><Billing /></RequireModule>} />
        <Route path="vendors/intro" element={<RequireModule module="skus"><VendorsIntro /></RequireModule>} />
        <Route path="vendors" element={<RequireModule module="skus"><Vendors /></RequireModule>} />
        <Route path="pricing/intro" element={<RequireModule module="pricing"><PricingIntro /></RequireModule>} />
        <Route path="pricing/:skuId?" element={<RequireModule module="pricing"><Pricing /></RequireModule>} />
        <Route path="settings/intro" element={<SettingsIntro />} />
        <Route path="pnl/intro" element={<RequireModule module="pnl"><PnLIntro /></RequireModule>} />
        <Route path="pnl/business" element={<RequireModule module="pnl"><ConsolidatedPnL /></RequireModule>} />
        <Route path="pnl/:platform" element={<RequireModule module="pnl"><PnLList /></RequireModule>} />
        <Route path="pnl/:platform/:reportId" element={<RequireModule module="pnl"><PnLReport /></RequireModule>} />
        <Route path="fraud" element={<RequireModule module="fraud"><FraudDashboard /></RequireModule>} />
        <Route path="fraud/platform/:platformId" element={<RequireModule module="fraud"><FraudPlatformPage /></RequireModule>} />
        <Route path="settings" element={<Settings />} />
        <Route path="companies" element={<Companies />} />
        <Route path="account" element={<Account />} />
        <Route path="users" element={<RequireModule module="users"><Users /></RequireModule>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <CompanyProvider>
          <Suspense fallback={<RouteLoader />}>
            <AppRoutes />
          </Suspense>
        </CompanyProvider>
      </AuthProvider>
    </ErrorBoundary>
  )
}
