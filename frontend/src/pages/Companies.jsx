import { useState, useEffect, useCallback } from 'react'
import { useCompany } from '../context/CompanyContext'
import { getCompanies } from '../api/client'
import './Companies.css'

/**
 * Companies — one home for company CRUD.
 *
 * Company management used to be split across the sidebar switcher (create, via a
 * raw window.prompt), the Settings page (rename/archive/leave) and the Team page,
 * with no way to act on a company other than the active one and no way back from
 * an archive. This page lists every company — including archived — and acts on any
 * of them in place.
 */
const SWATCHES = ['#EC2D6E', '#7A5BFF', '#0EA5E9', '#16A34A', '#F59E0B', '#DC2626', '#0E0E10']

export default function Companies() {
  const { activeId, setActive, createCompany, renameCompany,
          archiveCompany, leaveCompany, restoreCompany } = useCompany()

  const [rows, setRows]         = useState(null)   // includes archived
  const [showArch, setShowArch] = useState(false)
  const [editing, setEditing]   = useState(null)   // company id
  const [draft, setDraft]       = useState({ name: '', color: '' })
  const [creating, setCreating] = useState(false)
  const [newCo, setNewCo]       = useState({ name: '', color: SWATCHES[0] })
  const [busy, setBusy]         = useState(false)
  const [err, setErr]           = useState('')

  const load = useCallback(() => {
    getCompanies(true).then(setRows).catch(() => setRows([]))
  }, [])
  useEffect(() => { load() }, [load])

  const run = async (fn, confirmMsg) => {
    if (confirmMsg && !window.confirm(confirmMsg)) return
    setBusy(true); setErr('')
    try { await fn(); load() }
    catch (e) { setErr(e?.response?.data?.detail || 'Action failed') }
    finally { setBusy(false) }
  }

  const submitCreate = async () => {
    if (!newCo.name.trim()) { setErr('Enter a company name'); return }
    await run(async () => {
      const co = await createCompany(newCo.name.trim(), newCo.color)
      setCreating(false); setNewCo({ name: '', color: SWATCHES[0] })
      setActive(co.id)              // jump straight into the new company
    })
  }

  const saveEdit = async (id) => {
    await run(async () => {
      await renameCompany(id, draft.name.trim(), draft.color)
      setEditing(null)
    })
  }

  if (rows === null) return <div className="co-page"><div className="co-empty">Loading…</div></div>

  const active   = rows.filter(c => c.is_active !== false)
  const archived = rows.filter(c => c.is_active === false)

  return (
    <div className="co-page">
      <header className="co-head">
        <div>
          <h1 className="co-h1">Companies</h1>
          <p className="co-sub">
            {active.length} active{archived.length ? ` · ${archived.length} archived` : ''} ·
            each company keeps its own SKUs, reports and team
          </p>
        </div>
        <button className="btn btn-accent" onClick={() => { setCreating(c => !c); setErr('') }}>
          {creating ? 'Cancel' : '+ New company'}
        </button>
      </header>

      {err && <div className="co-err">{err}</div>}

      {creating && (
        <div className="co-create">
          <label className="co-f">Company name
            <input autoFocus value={newCo.name} placeholder="e.g. Shringar House"
              onChange={e => setNewCo({ ...newCo, name: e.target.value })}
              onKeyDown={e => e.key === 'Enter' && submitCreate()} />
          </label>
          <div className="co-f">Colour
            <div className="co-swatches">
              {SWATCHES.map(c => (
                <button key={c} type="button" aria-label={`Colour ${c}`}
                  className={`co-sw${newCo.color === c ? ' on' : ''}`} style={{ background: c }}
                  onClick={() => setNewCo({ ...newCo, color: c })} />
              ))}
            </div>
          </div>
          <button className="btn btn-accent btn-sm" disabled={busy} onClick={submitCreate}>
            {busy ? 'Creating…' : 'Create company'}
          </button>
        </div>
      )}

      <div className="co-list">
        {active.map(c => (
          <CompanyCard key={c.id} c={c} isActive={c.id === activeId} busy={busy}
            editing={editing === c.id} draft={draft} setDraft={setDraft}
            onEdit={() => { setEditing(c.id); setDraft({ name: c.name, color: c.color }); setErr('') }}
            onCancel={() => setEditing(null)}
            onSave={() => saveEdit(c.id)}
            onSwitch={() => setActive(c.id)}
            onArchive={() => run(() => archiveCompany(c.id),
              `Archive "${c.name}"? It leaves the switcher but all its data is kept, and you can restore it here.`)}
            onLeave={() => run(() => leaveCompany(c.id),
              `Leave "${c.name}"? You'll lose access unless someone re-invites you.`)}
            canRemove={active.length > 1} />
        ))}
      </div>

      {archived.length > 0 && (
        <div className="co-arch">
          <button className="co-arch-toggle" onClick={() => setShowArch(s => !s)}>
            {showArch ? 'Hide' : 'Show'} archived ({archived.length})
          </button>
          {showArch && (
            <div className="co-list">
              {archived.map(c => (
                <div key={c.id} className="co-card co-card-arch">
                  <span className="co-dot" style={{ background: c.color }} />
                  <div className="co-info">
                    <div className="co-name">{c.name}<span className="co-tag">Archived</span></div>
                    <div className="co-meta">{c.role}</div>
                  </div>
                  <button className="btn btn-ghost btn-sm" disabled={busy || c.role !== 'owner'}
                    title={c.role === 'owner' ? '' : 'Only the owner can restore'}
                    onClick={() => run(() => restoreCompany(c.id))}>Restore</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function CompanyCard({ c, isActive, busy, editing, draft, setDraft,
                       onEdit, onCancel, onSave, onSwitch, onArchive, onLeave, canRemove }) {
  const isOwner = c.role === 'owner'
  if (editing) {
    return (
      <div className="co-card co-card-edit">
        <input className="co-edit-name" autoFocus value={draft.name}
          onChange={e => setDraft({ ...draft, name: e.target.value })}
          onKeyDown={e => e.key === 'Enter' && onSave()} />
        <div className="co-swatches">
          {SWATCHES.map(s => (
            <button key={s} type="button" aria-label={`Colour ${s}`}
              className={`co-sw${draft.color === s ? ' on' : ''}`} style={{ background: s }}
              onClick={() => setDraft({ ...draft, color: s })} />
          ))}
        </div>
        <div className="co-actions">
          <button className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
          <button className="btn btn-accent btn-sm" disabled={busy || !draft.name.trim()} onClick={onSave}>Save</button>
        </div>
      </div>
    )
  }
  return (
    <div className={`co-card${isActive ? ' on' : ''}`}>
      <span className="co-dot" style={{ background: c.color }} />
      <div className="co-info">
        <div className="co-name">
          {c.name}
          {isActive && <span className="co-tag co-tag-on">Active</span>}
        </div>
        <div className="co-meta">{c.role}</div>
      </div>
      <div className="co-actions">
        {!isActive && <button className="btn btn-ghost btn-sm" onClick={onSwitch}>Switch to</button>}
        {isOwner && <button className="btn btn-ghost btn-sm" onClick={onEdit}>Edit</button>}
        {isOwner ? (
          <button className="btn btn-ghost btn-sm co-danger" disabled={busy || !canRemove}
            title={canRemove ? '' : 'You must keep at least one company'}
            onClick={onArchive}>Archive</button>
        ) : (
          <button className="btn btn-ghost btn-sm co-danger" disabled={busy || !canRemove}
            onClick={onLeave}>Leave</button>
        )}
      </div>
    </div>
  )
}
