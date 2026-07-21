import { useState, useEffect } from 'react'
import { getUsers, createUser, updateUser, deleteUser } from '../api/client'
import { useAuth } from '../context/AuthContext'
import './Users.css'

const ROLES = ['super_admin', 'admin', 'viewer']
const ROLE_LABEL = { super_admin: 'Super admin', admin: 'Admin', viewer: 'Viewer' }
const ROLE_CLS = { super_admin: 'role-super', admin: 'role-admin', viewer: 'role-viewer' }

const BLANK = { name: '', email: '', password: '', role: 'viewer' }

export default function Users() {
  const { user } = useAuth()
  const canManage = user?.role === 'super_admin'

  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(null)
  const [showAdd, setShowAdd] = useState(false)
  const [draft, setDraft] = useState(BLANK)
  const [editId, setEditId] = useState(null)
  const [edit, setEdit] = useState({})

  useEffect(() => {
    getUsers()
      .then(setUsers)
      .catch(e => setError(e.response?.data?.detail || 'Failed to load users'))
      .finally(() => setLoading(false))
  }, [])

  const add = async () => {
    if (!draft.name.trim() || !draft.email.trim() || !draft.password) {
      setError('Name, email and password are required'); return
    }
    setBusy('add'); setError('')
    try {
      const created = await createUser({ ...draft, name: draft.name.trim(), email: draft.email.trim() })
      setUsers(p => [...p, created])
      setDraft(BLANK); setShowAdd(false)
    } catch (e) { setError(e.response?.data?.detail || 'Create failed') }
    finally { setBusy(null) }
  }

  const startEdit = u => { setEditId(u.id); setEdit({ name: u.name, email: u.email, role: u.role }); setError('') }
  const cancelEdit = () => { setEditId(null); setEdit({}) }

  const saveEdit = async u => {
    setBusy(u.id); setError('')
    try {
      const updated = await updateUser(u.id, edit)
      setUsers(p => p.map(x => x.id === u.id ? updated : x))
      cancelEdit()
    } catch (e) { setError(e.response?.data?.detail || 'Update failed') }
    finally { setBusy(null) }
  }

  const toggleActive = async u => {
    setBusy(u.id); setError('')
    try {
      const updated = await updateUser(u.id, { is_active: !u.is_active })
      setUsers(p => p.map(x => x.id === u.id ? updated : x))
    } catch (e) { setError(e.response?.data?.detail || 'Update failed') }
    finally { setBusy(null) }
  }

  const remove = async u => {
    if (!window.confirm(`Delete ${u.name} (${u.email})? This cannot be undone.`)) return
    setBusy(u.id); setError('')
    try {
      await deleteUser(u.id)
      setUsers(p => p.filter(x => x.id !== u.id))
    } catch (e) { setError(e.response?.data?.detail || 'Delete failed') }
    finally { setBusy(null) }
  }

  if (loading) return (
    <div className="usr-loading"><div className="loader" style={{ width: 28, height: 28 }} /></div>
  )

  return (
    <div className="usr">
      <header className="usr-head">
        <div>
          <h1 className="usr-title">Users</h1>
          <p className="usr-sub">{users.length} account{users.length !== 1 ? 's' : ''} · roles &amp; access</p>
        </div>
        {canManage && (
          <button className="usr-add-btn" onClick={() => { setShowAdd(s => !s); setError('') }}>
            {showAdd ? 'Cancel' : '+ Add user'}
          </button>
        )}
      </header>

      {error && <div className="usr-error" role="alert">{error}</div>}

      {canManage && showAdd && (
        <div className="usr-add-form">
          <input className="usr-input" placeholder="Full name" value={draft.name}
            onChange={e => setDraft({ ...draft, name: e.target.value })} aria-label="Name" />
          <input className="usr-input" type="email" placeholder="Email" value={draft.email}
            onChange={e => setDraft({ ...draft, email: e.target.value })} aria-label="Email" />
          <input className="usr-input" type="password" placeholder="Temp password" value={draft.password}
            onChange={e => setDraft({ ...draft, password: e.target.value })} aria-label="Password" />
          <select className="usr-input usr-select" value={draft.role}
            onChange={e => setDraft({ ...draft, role: e.target.value })} aria-label="Role">
            {ROLES.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
          <button className="usr-save" onClick={add} disabled={busy === 'add'}>
            {busy === 'add' ? 'Adding…' : 'Create'}
          </button>
        </div>
      )}

      <div className="usr-table-wrap">
        <table className="usr-table">
          <thead>
            <tr>
              <th>Name</th><th>Email</th><th>Role</th><th>Status</th>
              {canManage && <th className="usr-th-act">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {users.map(u => {
              const editing = editId === u.id
              const isSelf = u.email === user?.email
              return (
                <tr key={u.id} className={u.is_active ? '' : 'usr-inactive'}>
                  <td>
                    {editing
                      ? <input className="usr-input usr-input-sm" value={edit.name}
                          onChange={e => setEdit({ ...edit, name: e.target.value })} aria-label="Edit name" />
                      : <span className="usr-name">{u.name}{isSelf && <span className="usr-you">you</span>}</span>}
                  </td>
                  <td className="usr-email">
                    {editing
                      ? <input className="usr-input usr-input-sm" value={edit.email}
                          onChange={e => setEdit({ ...edit, email: e.target.value })} aria-label="Edit email" />
                      : u.email}
                  </td>
                  <td>
                    {editing
                      ? <select className="usr-input usr-input-sm usr-select" value={edit.role}
                          onChange={e => setEdit({ ...edit, role: e.target.value })} aria-label="Edit role">
                          {ROLES.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                        </select>
                      : <span className={`usr-role ${ROLE_CLS[u.role]}`}>{ROLE_LABEL[u.role]}</span>}
                  </td>
                  <td>
                    {canManage
                      ? <button className={`usr-toggle ${u.is_active ? 'on' : ''}`} onClick={() => toggleActive(u)}
                          disabled={busy === u.id} aria-label="Toggle active" title={u.is_active ? 'Deactivate' : 'Activate'}>
                          <span className="usr-toggle-dot" />
                        </button>
                      : <span className={`usr-status ${u.is_active ? 'active' : ''}`}>{u.is_active ? 'Active' : 'Inactive'}</span>}
                  </td>
                  {canManage && (
                    <td className="usr-td-act">
                      {editing ? (
                        <>
                          <button className="usr-act usr-act-save" onClick={() => saveEdit(u)} disabled={busy === u.id}>Save</button>
                          <button className="usr-act" onClick={cancelEdit}>Cancel</button>
                        </>
                      ) : (
                        <>
                          <button className="usr-act" onClick={() => startEdit(u)}>Edit</button>
                          {!isSelf && <button className="usr-act usr-act-del" onClick={() => remove(u)} disabled={busy === u.id}>Delete</button>}
                        </>
                      )}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {!canManage && (
        <p className="usr-note">You have read-only access. Only a super admin can add, edit or remove users.</p>
      )}
    </div>
  )
}
