import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import './Login.css'

export default function Login() {
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)
  const { login }  = useAuth()
  const navigate   = useNavigate()

  const handleSubmit = async e => {
    e.preventDefault()
    setError(''); setLoading(true)
    try {
      await login(email, password)
      navigate('/')
    } catch (err) {
      setError(err.response?.data?.detail || 'Invalid credentials')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-box">
        <div className="login-logo">C</div>
        <div className="login-brand">Casper</div>
        <div className="login-tagline">Pricing intelligence for ecommerce sellers</div>

        <form onSubmit={handleSubmit} className="login-form">
          <div className="input-group">
            <label>Email</label>
            <input className="input" type="email" placeholder="admin@casper.com"
              value={email} onChange={e => setEmail(e.target.value)} required autoFocus />
          </div>
          <div className="input-group">
            <label>Password</label>
            <input className="input" type="password" placeholder="••••••••"
              value={password} onChange={e => setPassword(e.target.value)} required />
          </div>
          {error && <div className="login-error">{error}</div>}
          <button className="btn btn-primary login-submit" type="submit" disabled={loading}>
            {loading && (
              <span className="loader" style={{ width:13, height:13, borderWidth:2,
                borderTopColor:'rgba(255,255,255,0.8)', borderColor:'rgba(255,255,255,0.2)' }}/>
            )}
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <div className="login-footer">Casper · Ecommerce Pricing Platform</div>
      </div>
    </div>
  )
}