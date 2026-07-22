import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import './Login.css'

export default function Register() {
  const [form, setForm] = useState({ name: '', email: '', password: '', company_name: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { register } = useAuth()
  const navigate = useNavigate()

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async e => {
    e.preventDefault()
    setError(''); setLoading(true)
    try {
      await register(form)
      navigate('/')
    } catch (err) {
      const detail = err.response?.data?.detail
      setError(Array.isArray(detail) ? 'Please check your details' : (detail || 'Registration failed'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-box">
        <div className="login-logo">C</div>
        <div className="login-brand">Create your account</div>
        <div className="login-tagline">Start with your first company — add more later</div>

        <form onSubmit={handleSubmit} className="login-form">
          <div className="input-group">
            <label>Your name</label>
            <input className="input" placeholder="Priya Sharma"
              value={form.name} onChange={e => set('name', e.target.value)} required autoFocus />
          </div>
          <div className="input-group">
            <label>Email</label>
            <input className="input" type="email" placeholder="you@example.com"
              value={form.email} onChange={e => set('email', e.target.value)} required />
          </div>
          <div className="input-group">
            <label>Password</label>
            <input className="input" type="password" placeholder="••••••••"
              value={form.password} onChange={e => set('password', e.target.value)} required minLength={6} />
          </div>
          <div className="input-group">
            <label>Company name</label>
            <input className="input" placeholder="Shringar House Jewellery"
              value={form.company_name} onChange={e => set('company_name', e.target.value)} required />
          </div>
          {error && <div className="login-error">{error}</div>}
          <button className="btn btn-primary login-submit" type="submit" disabled={loading}>
            {loading && (
              <span className="loader" style={{ width:13, height:13, borderWidth:2,
                borderTopColor:'rgba(255,255,255,0.8)', borderColor:'rgba(255,255,255,0.2)' }}/>
            )}
            {loading ? 'Creating…' : 'Create account'}
          </button>
        </form>

        <div className="login-footer">
          Already have an account? <Link to="/login" className="login-link">Sign in</Link>
        </div>
      </div>
    </div>
  )
}
