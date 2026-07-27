import { useState } from 'react'
import { changePassword } from '../api/client'
import { useAuth } from '../context/AuthContext'
import './Account.css'

const ROLE_LABEL = { super_admin: 'Super admin', admin: 'Admin', viewer: 'Viewer' }

export default function Account() {
  const { user } = useAuth()
  const [form, setForm] = useState({ current: '', next: '', confirm: '' })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg]   = useState(null)   // { type: 'ok'|'err', text }

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const initials = (user?.name || 'U').split(' ').filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase()

  const submit = async e => {
    e.preventDefault()
    setMsg(null)
    if (form.next.length < 6)        return setMsg({ type: 'err', text: 'New password must be at least 6 characters' })
    if (form.next !== form.confirm)  return setMsg({ type: 'err', text: 'New passwords do not match' })
    if (form.next === form.current)  return setMsg({ type: 'err', text: 'New password must differ from the current one' })
    setBusy(true)
    try {
      await changePassword({ current_password: form.current, new_password: form.next })
      setForm({ current: '', next: '', confirm: '' })
      setMsg({ type: 'ok', text: 'Password changed successfully' })
    } catch (err) {
      setMsg({ type: 'err', text: err.response?.data?.detail || 'Could not change password' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="acc">
      <header className="acc-head">
        <h1 className="acc-title">Account</h1>
        <p className="acc-sub">Your profile and sign-in security</p>
      </header>

      {/* Profile */}
      <section className="acc-card">
        <div className="acc-profile">
          <span className="acc-avatar" aria-hidden="true">{initials}</span>
          <div>
            <div className="acc-name">{user?.name || '—'}</div>
            <div className="acc-email">{user?.email || '—'}</div>
          </div>
          <span className="acc-role">{ROLE_LABEL[user?.role] || user?.role || '—'}</span>
        </div>
      </section>

      {/* Change password */}
      <section className="acc-card">
        <h2 className="acc-card-title">Change password</h2>
        <form className="acc-form" onSubmit={submit}>
          <div className="acc-field">
            <label htmlFor="acc-current">Current password</label>
            <input id="acc-current" type="password" autoComplete="current-password" className="acc-input"
              value={form.current} onChange={e => set('current', e.target.value)} required />
          </div>
          <div className="acc-field">
            <label htmlFor="acc-next">New password</label>
            <input id="acc-next" type="password" autoComplete="new-password" className="acc-input"
              value={form.next} onChange={e => set('next', e.target.value)} required minLength={6} />
          </div>
          <div className="acc-field">
            <label htmlFor="acc-confirm">Confirm new password</label>
            <input id="acc-confirm" type="password" autoComplete="new-password" className="acc-input"
              value={form.confirm} onChange={e => set('confirm', e.target.value)} required minLength={6} />
          </div>
          {msg && <div className={`acc-msg acc-msg-${msg.type}`} role={msg.type === 'err' ? 'alert' : 'status'}>{msg.text}</div>}
          <button className="acc-save" type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Update password'}
          </button>
        </form>
      </section>
    </div>
  )
}
