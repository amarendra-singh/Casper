import { useState, useEffect } from 'react'
import { getMembers, inviteMember, updateMemberRole, removeMember } from '../api/client'
import { useCompany } from '../context/CompanyContext'
import './Users.css'

const ASSIGNABLE = ['admin', 'viewer']              // owner is fixed to the creator
const ROLE_LABEL = { owner: 'Owner', admin: 'Admin', viewer: 'Viewer' }
const ROLE_CLS   = { owner: 'role-super', admin: 'role-admin', viewer: 'role-viewer' }
const BLANK = { name: '', email: '', password: '', role: 'viewer' }

export default function Users() {
  const { activeCompany, role } = useCompany()
  const canManage = role === 'owner'
  const cid = activeCompany?.id

  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(null)
  const [showAdd, setShowAdd] = useState(false)
  const [draft, setDraft] = useState(BLANK)

  useEffect(() => {
    if (!cid) return
    setLoading(true)
    getMembers(cid)
      .then(setMembers)
      .catch(e => setError(e.response?.data?.detail || 'Failed to load team'))
      .finally(() => setLoading(false))
  }, [cid])

  const add = async () => {
    if (!draft.email.trim()) { setError('Email is required'); return }
    setBusy('add'); setError('')
    try {
      const m = await inviteMember(cid, { ...draft, email: draft.email.trim(), name: draft.name.trim() })
      setMembers(p => [...p, m])
      setDraft(BLANK); setShowAdd(false)
    } catch (e) { setError(e.response?.data?.detail || 'Invite failed') }
    finally { setBusy(null) }
  }

  const changeRole = async (m, newRole) => {
    setBusy(m.id); setError('')
    try {
      const updated = await updateMemberRole(cid, m.id, newRole)
      setMembers(p => p.map(x => x.id === m.id ? updated : x))
    } catch (e) { setError(e.response?.data?.detail || 'Update failed') }
    finally { setBusy(null) }
  }

  const remove = async m => {
    if (!window.confirm(`Remove ${m.name || m.email} from ${activeCompany?.name}?`)) return
    setBusy(m.id); setError('')
    try {
      await removeMember(cid, m.id)
      setMembers(p => p.filter(x => x.id !== m.id))
    } catch (e) { setError(e.response?.data?.detail || 'Remove failed') }
    finally { setBusy(null) }
  }

  if (loading) return <div className="usr-loading"><div className="loader" style={{ width: 28, height: 28 }} /></div>

  return (
    <div className="usr">
      <header className="usr-head">
        <div>
          <h1 className="usr-title">Team</h1>
          <p className="usr-sub">{members.length} member{members.length !== 1 ? 's' : ''} · {activeCompany?.name}</p>
        </div>
        {canManage && (
          <button className="usr-add-btn" onClick={() => { setShowAdd(s => !s); setError('') }}>
            {showAdd ? 'Cancel' : '+ Invite member'}
          </button>
        )}
      </header>

      <div className="stat-grid" style={{ marginBottom: 16 }}>
        <div className="stat accent"><div className="stat-label">Members</div><div className="stat-value">{members.length}</div></div>
        <div className="stat"><div className="stat-label">Owners</div><div className="stat-value">{members.filter(m => m.role === 'owner').length}</div></div>
        <div className="stat"><div className="stat-label">Admins</div><div className="stat-value">{members.filter(m => m.role === 'admin').length}</div></div>
        <div className="stat"><div className="stat-label">Viewers</div><div className="stat-value">{members.filter(m => m.role === 'viewer').length}</div></div>
      </div>

      {error && <div className="usr-error" role="alert">{error}</div>}

      {canManage && showAdd && (
        <div className="usr-add-form">
          <input className="usr-input" placeholder="Full name" value={draft.name}
            onChange={e => setDraft({ ...draft, name: e.target.value })} aria-label="Name" />
          <input className="usr-input" type="email" placeholder="Email" value={draft.email}
            onChange={e => setDraft({ ...draft, email: e.target.value })} aria-label="Email" />
          <input className="usr-input" type="password" placeholder="Temp password (new user)" value={draft.password}
            onChange={e => setDraft({ ...draft, password: e.target.value })} aria-label="Temp password" />
          <select className="usr-input usr-select" value={draft.role}
            onChange={e => setDraft({ ...draft, role: e.target.value })} aria-label="Role">
            {ASSIGNABLE.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
          <button className="usr-save" onClick={add} disabled={busy === 'add'}>
            {busy === 'add' ? 'Inviting…' : 'Invite'}
          </button>
        </div>
      )}

      <div className="usr-table-wrap">
        <table className="usr-table">
          <thead>
            <tr><th>Name</th><th>Email</th><th>Role</th>{canManage && <th className="usr-th-act">Actions</th>}</tr>
          </thead>
          <tbody>
            {members.map(m => {
              const isOwner = m.role === 'owner'
              return (
                <tr key={m.id}>
                  <td><span className="usr-name">{m.name}</span></td>
                  <td className="usr-email">{m.email}</td>
                  <td>
                    {canManage && !isOwner
                      ? <select className="usr-input usr-input-sm usr-select" value={m.role}
                          onChange={e => changeRole(m, e.target.value)} disabled={busy === m.id} aria-label="Change role">
                          {ASSIGNABLE.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                        </select>
                      : <span className={`usr-role ${ROLE_CLS[m.role]}`}>{ROLE_LABEL[m.role]}</span>}
                  </td>
                  {canManage && (
                    <td className="usr-td-act">
                      {!isOwner
                        ? <button className="usr-act usr-act-del" onClick={() => remove(m)} disabled={busy === m.id}>Remove</button>
                        : <span className="usr-sub" style={{ fontSize: 12 }}>—</span>}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {!canManage && <p className="usr-note">Only the company owner can invite or manage members.</p>}
    </div>
  )
}
