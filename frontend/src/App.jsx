import { Routes, Route, Navigate } from 'react-router-dom'
import { Component } from 'react'
import { AuthProvider, useAuth } from './context/AuthContext'

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
import Dashboard from './pages/Dashboard'
import SKUs from './pages/SKUs'
import Pricing from './pages/Pricing'
import Vendors from './pages/Vendors'
import PnLList from './pages/PnL/PnLList'
import PnLReport from './pages/PnL/PnLReport'
import Settings from './pages/Settings'
import FraudDashboard from './pages/Fraud/FraudDashboard'
import PnLIntro from './pages/intros/PnLIntro'
import SKUsIntro from './pages/intros/SKUsIntro'
import VendorsIntro from './pages/intros/VendorsIntro'
import PricingIntro from './pages/intros/PricingIntro'
import SettingsIntro from './pages/intros/SettingsIntro'
// import Entries from './pages/Entries'

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
      <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route index element={<Dashboard />} />
        <Route path="skus/intro" element={<SKUsIntro />} />
        <Route path="skus" element={<SKUs />} />
        <Route path="vendors/intro" element={<VendorsIntro />} />
        <Route path="vendors" element={<Vendors />} />
        <Route path="pricing/intro" element={<PricingIntro />} />
        <Route path="pricing/:skuId?" element={<Pricing />} />
        <Route path="settings/intro" element={<SettingsIntro />} />
        <Route path="pnl/intro" element={<PnLIntro />} />
        <Route path="pnl/:platform" element={<PnLList />} />
        <Route path="pnl/:platform/:reportId" element={<PnLReport />} />
        <Route path="fraud" element={<FraudDashboard />} />
        <Route path="settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </ErrorBoundary>
  )
}