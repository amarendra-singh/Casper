import { Routes, Route, Navigate } from 'react-router-dom'
import { Component, lazy, Suspense } from 'react'
import { AuthProvider, useAuth } from './context/AuthContext'
import { CompanyProvider } from './context/CompanyContext'

class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(e) { return { error: e } }
  render() {
    if (this.state.error) return (
      <pre style={{ padding: 24, color: 'red', whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: 13 }}>
        {this.state.error?.message}{'\n\n'}{this.state.error?.stack}
      </pre>
    )
    return this.props.children
  }
}
import Layout from './components/Layout'
import Login from './pages/Login'
import Register from './pages/Register'
// Route pages are code-split so heavy deps (recharts, react-simple-maps) load
// only when their page is visited — keeps the initial bundle small.
const Dashboard = lazy(() => import('./pages/Dashboard'))
const SKUs = lazy(() => import('./pages/SKUs'))
const Pricing = lazy(() => import('./pages/Pricing'))
const Vendors = lazy(() => import('./pages/Vendors'))
const PnLList = lazy(() => import('./pages/PnL/PnLList'))
const PnLReport = lazy(() => import('./pages/PnL/PnLReport'))
const Settings = lazy(() => import('./pages/Settings'))
const ProfitCalculator = lazy(() => import('./pages/ProfitCalculator'))
const Users = lazy(() => import('./pages/Users'))
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
  const { user, loading } = useAuth()
  if (loading) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh' }}>
      <div className="loader" style={{ width:32, height:32 }} />
    </div>
  )
  return user ? children : <Navigate to="/login" replace />
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
        <Route path="skus/intro" element={<SKUsIntro />} />
        <Route path="skus" element={<SKUs />} />
        <Route path="calculator" element={<ProfitCalculator />} />
        <Route path="vendors/intro" element={<VendorsIntro />} />
        <Route path="vendors" element={<Vendors />} />
        <Route path="pricing/intro" element={<PricingIntro />} />
        <Route path="pricing/:skuId?" element={<Pricing />} />
        <Route path="settings/intro" element={<SettingsIntro />} />
        <Route path="pnl/intro" element={<PnLIntro />} />
        <Route path="pnl/:platform" element={<PnLList />} />
        <Route path="pnl/:platform/:reportId" element={<PnLReport />} />
        <Route path="fraud" element={<FraudDashboard />} />
        <Route path="fraud/platform/:platformId" element={<FraudPlatformPage />} />
        <Route path="settings" element={<Settings />} />
        <Route path="users" element={<Users />} />
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