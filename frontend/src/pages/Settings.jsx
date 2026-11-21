import PricingRefresh from '../components/PricingRefresh'
import FinancialHistory from '../components/FinancialHistory'
import { useState, useEffect, useId, useRef } from 'react'
import { getPlatforms, updatePlatform, createPlatform, errText } from '../api/client'
import api from '../api/client'
import { useCompany } from '../context/CompanyContext'
import './Settings.css'
import { useConfirm } from '../components/ConfirmDialog'

const MODULE_META = [
  { key: 'skus',       label: 'SKUs & Catalog' },
  { key: 'pricing',    label: 'Pricing' },
  { key: 'pnl',        label: 'P&L' },
  { key: 'fraud',      label: 'Fraud Detection' },
  { key: 'calculator', label: 'Profit Calculator' },
  { key: 'billing', label: 'Billing & Invoices' },
  { key: 'ledger', label: 'Expense Ledger' },
  { key: 'users',      label: 'Users & Team' },
]

function CompanyModules() {
  const { modules, role, updateModules, activeCompany } = useCompany()
  const [busy, setBusy] = useState(null)
  const [moduleError, setModuleError] = useState('')
  const isOwner = role === 'owner'

  const toggle = async key => {
    if (!isOwner) {return}
    setBusy(key)
    setModuleError('')
    try { await updateModules({ [key]: !(modules[key] !== false) }) } catch (e) { setModuleError(errText(e, 'Module update failed')) }
    finally { setBusy(null) }
  }

  return (
    <div className="st-add-card" style={{ marginBottom: 16 }}>
      <div style={{ marginBottom: 12 }}>
        <div className="st-title" style={{ fontSize: 16 }}>Modules</div>
        <p className="st-sub" style={{ margin: '2px 0 0' }}>
          Show or hide navigation features for <b>{activeCompany?.name || 'this company'}</b>
        </p>
      </div>
      {moduleError && <p role="alert">{moduleError}</p>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 10 }}>
        {MODULE_META.map(m => {
          const on = modules[m.key] !== false
          return (
            <div key={m.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 14px', border: '1px solid var(--rule,#E4DFD5)', borderRadius: 10,
              background: 'var(--surface-2,#F7F3EC)' }}>
              <span style={{ fontSize: 14, fontWeight: 500 }}>{m.label}</span>
              <button onClick={() => toggle(m.key)} disabled={!isOwner || busy === m.key}
                role="switch" aria-checked={on} aria-label={`Toggle ${m.label}`}
                style={{ width: 38, height: 22, borderRadius: 11, border: 'none', position: 'relative',
                  cursor: isOwner ? 'pointer' : 'default', padding: 0, transition: 'background .18s',
                  background: on ? '#1FA968' : 'var(--muted-2,#C7C1B6)', opacity: isOwner ? 1 : .6 }}>
                <span style={{ position: 'absolute', top: 3, left: 3, width: 16, height: 16, borderRadius: '50%',
                  background: '#fff', transition: 'transform .18s', transform: on ? 'translateX(16px)' : 'none' }} />
              </button>
            </div>
          )
        })}
      </div>
      {!isOwner && <p className="st-sub" style={{ margin: '10px 0 0' }}>Only the company owner can change modules.</p>}
    </div>
  )
}

function CompanyManage() {
  const { ask, dialog } = useConfirm()
  const { activeCompany, companies, role, renameCompany, archiveCompany, leaveCompany } = useCompany()
  const isOwner = role === 'owner'
  const id = activeCompany?.id
  const canRemove = companies.length > 1   // never let the user remove their only company
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err,  setErr]  = useState('')
  useEffect(() => { setName(activeCompany?.name || '') }, [activeCompany?.id, activeCompany?.name])

  const doRename = async () => {
    const n = name.trim()
    if (!n || n === activeCompany?.name) {return}
    setBusy(true); setErr('')
    try { await renameCompany(id, n) } catch (e) { setErr(errText(e, 'Rename failed')) }
    finally { setBusy(false) }
  }
  const runArchive = async () => {
    setBusy(true); setErr('')
    try { await archiveCompany(id) } catch (e) { setErr(errText(e, 'Archive failed')); setBusy(false) }
  }
  const doArchive = () => ask({
    title: 'Archive company',
    body: <>Archive <strong>{activeCompany?.name}</strong>?
      <span className="cd-note">It leaves the switcher but none of its data is deleted — you can restore it
        from the Companies page.</span></>,
    confirmLabel: 'Archive company', tone: 'danger',
    onConfirm: runArchive,
  })

  const runLeave = async () => {
    setBusy(true); setErr('')
    try { await leaveCompany(id) } catch (e) { setErr(errText(e, 'Leave failed')); setBusy(false) }
  }
  const doLeave = () => ask({
    title: 'Leave company',
    body: <>Leave <strong>{activeCompany?.name}</strong>?
      <span className="cd-note">You lose access to its data unless someone re-invites you.</span></>,
    confirmLabel: 'Leave company', tone: 'danger',
    onConfirm: runLeave,
  })

  return (
    <div className="st-add-card" style={{ marginBottom: 16 }}>
      {dialog}
      <div style={{ marginBottom: 12, display: 'flex', alignItems: 'flex-start',
                    justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div className="st-title" style={{ fontSize: 16 }}>Company</div>
          <p className="st-sub" style={{ margin: '2px 0 0' }}>
            Rename or remove <b>{activeCompany?.name || 'this company'}</b>
          </p>
        </div>
        {/* Company CRUD now lives on the Companies page. This stays as a shortcut for the
            ACTIVE company only, so the two surfaces can't drift apart again. */}
        <a className="st-cancel-btn" href="/companies"
           style={{ textDecoration: 'none', whiteSpace: 'nowrap' }}>All companies →</a>
      </div>
      {isOwner ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input className="st-input" style={{ maxWidth: 280 }} value={name}
            onChange={e => setName(e.target.value)} aria-label="Company name" />
          <button className="st-save-btn" onClick={doRename}
            disabled={busy || !name.trim() || name.trim() === activeCompany?.name}>Rename</button>
          <button className="st-cancel-btn" onClick={doArchive} disabled={busy || !canRemove}
            title={canRemove ? '' : 'You must keep at least one company'}
            style={{ marginLeft: 'auto', color: '#dc2626', borderColor: 'rgba(220,38,38,.35)' }}>
            Archive company
          </button>
        </div>
      ) : (
        <button className="st-cancel-btn" onClick={doLeave} disabled={busy || !canRemove}
          style={{ color: '#dc2626', borderColor: 'rgba(220,38,38,.35)' }}>
          Leave company
        </button>
      )}
      {err && <p className="st-sub" style={{ margin: '10px 0 0', color: '#dc2626' }}>{err}</p>}
      {!canRemove && <p className="st-sub" style={{ margin: '10px 0 0' }}>You must belong to at least one company.</p>}
    </div>
  )
}

const TIER_DEFAULTS = { tier_name: '', fee: '', fee_pct: '', mode: 'amt' /* 'amt' = ₹, 'pct' = % */ }

function Toast({ msg, type, onDismiss }) {
  return <div role={type === 'error' ? 'alert' : 'status'} className={`st-toast st-toast-${type}`}>{msg} <button onClick={onDismiss} aria-label="Dismiss notification">×</button></div>
}

function TierRow({ tier, platformId, onUpdated, onDeleted, onError, canEdit }) {
  const { ask, dialog } = useConfirm()
  const [editing, setEditing] = useState(false)
  const [name,    setName]    = useState(tier.tier_name)
  // Determine current mode from existing data: pct if fee_pct is set, else amt
  const startMode = tier.fee_pct != null ? 'pct' : 'amt'
  const [mode,    setMode]    = useState(startMode)
  const [fee,     setFee]     = useState(tier.fee != null ? String(tier.fee) : '')
  const [feePct,  setFeePct]  = useState(tier.fee_pct != null ? String(tier.fee_pct) : '')
  const [busy,    setBusy]    = useState(false)

  const save = async () => {
    if (!name.trim()) {return}
    const payload = { tier_name: name.trim() }
    if (mode === 'pct') {
      if (feePct === '') {return}
      payload.fee_pct = parseFloat(feePct)
      payload.fee     = 0   // when in pct mode, store 0 for the unused field
    } else {
      if (fee === '') {return}
      payload.fee     = parseFloat(fee)
      payload.fee_pct = null
    }
    setBusy(true)
    try {
      const r = await api.patch(`/platforms/${platformId}/tiers/${tier.id}`, payload)
      onUpdated(r.data)
      setEditing(false)
    } catch(e) { onError?.(errText(e, 'Failed to save tier')) }
    finally { setBusy(false) }
  }

  const del = async () => {
    setBusy(true)
    try {
      await api.delete(`/platforms/${platformId}/tiers/${tier.id}`)
      onDeleted(tier.id)
    } catch(e) { onError?.(errText(e, 'Failed to delete tier')) }
    finally { setBusy(false) }
  }

  const cancelEdit = () => {
    setEditing(false)
    setName(tier.tier_name)
    setMode(startMode)
    setFee(tier.fee != null ? String(tier.fee) : '')
    setFeePct(tier.fee_pct != null ? String(tier.fee_pct) : '')
  }

  if (editing) {return (
    <div className="st-tier-row st-tier-edit">
      <input aria-label="Tier name" className="st-tier-input" value={name} onChange={e => setName(e.target.value)} placeholder="Tier name" />
      <select className="st-tier-input st-tier-mode" value={mode} onChange={e => setMode(e.target.value)}>
        <option value="amt">₹</option>
        <option value="pct">%</option>
      </select>
      {mode === 'pct'
        ? <input aria-label="% of base" className="st-tier-input st-tier-fee" type="number" value={feePct}
            onChange={e => setFeePct(e.target.value)} placeholder="% of base" />
        : <input aria-label="Fee in ₹" className="st-tier-input st-tier-fee" type="number" value={fee}
            onChange={e => setFee(e.target.value)} placeholder="Fee in ₹" />
      }
      <button className="st-tier-save" onClick={save} disabled={busy}>{busy ? '…' : 'Save'}</button>
      <button className="st-tier-cancel" onClick={cancelEdit}>✕</button>
    </div>
  )}

  // Read-only view
  const displayValue = tier.fee_pct != null ? `${tier.fee_pct}%` : `₹${tier.fee}`
  return (
    <div className="st-tier-row">
      <span className="st-tier-name">{tier.tier_name}</span>
      <span className="st-tier-fee-val">{displayValue}</span>
      <button className="st-tier-edit-btn" disabled={!canEdit} onClick={() => setEditing(true)}>Edit</button>
      <button className="st-tier-del-btn" disabled={busy || !canEdit}
        onClick={() => ask({
          title: 'Delete tier',
          body: <>Delete tier <strong>{tier.tier_name}</strong>?<span className="cd-note">This cannot be undone.</span></>,
          confirmLabel: 'Delete tier', tone: 'danger',
          onConfirm: del,
        })}>✕</button>
      {dialog}
    </div>
  )
}

function PlatformCard({ platform, onUpdated, onError, canEdit }) {
  const fieldId0 = useId()
  const [expanded, setExpanded] = useState(false)
  const [editing,  setEditing]  = useState(false)
  const [busy,     setBusy]     = useState(false)
  const [tiers,    setTiers]    = useState(platform.tiers || [])
  const [addTier,  setAddTier]  = useState(false)
  const [newTier,  setNewTier]  = useState(TIER_DEFAULTS)

  const [form, setForm] = useState({
    name:               platform.name,
    cr_charge:          String(platform.cr_charge),
    cr_percentage:      String(platform.cr_percentage),
    default_ad_pct:     String(platform.default_ad_pct),
    default_profit_pct: String(platform.default_profit_pct),
  })

  const cancelEdit = () => {
    setForm({
      name:               platform.name,
      cr_charge:          String(platform.cr_charge),
      cr_percentage:      String(platform.cr_percentage),
      default_ad_pct:     String(platform.default_ad_pct),
      default_profit_pct: String(platform.default_profit_pct),
    })
    setEditing(false)
  }

  const save = async () => {
    setBusy(true)
    try {
      const updated = await updatePlatform(platform.id, {
        name:               form.name.trim(),
        cr_charge:          parseFloat(form.cr_charge),
        cr_percentage:      parseFloat(form.cr_percentage),
        default_ad_pct:     parseFloat(form.default_ad_pct),
        default_profit_pct: parseFloat(form.default_profit_pct),
      })
      onUpdated(updated)
      setEditing(false)
    } catch(e) { onError?.(errText(e, 'Failed to save platform')) }
    finally { setBusy(false) }
  }

  const toggleActive = async () => {
    setBusy(true)
    try {
      const updated = await updatePlatform(platform.id, { is_active: !platform.is_active })
      onUpdated(updated)
    } catch(e) { onError?.(errText(e, 'Failed to toggle status')) }
    finally { setBusy(false) }
  }

  const handleTierAdded = async () => {
    if (!newTier.tier_name.trim()) {return}
    const isPct = (newTier.mode || 'amt') === 'pct'
    const valStr = isPct ? newTier.fee_pct : newTier.fee
    if (valStr === '' || valStr === undefined) {return}
    const payload = {
      tier_name: newTier.tier_name.trim(),
      fee:     isPct ? 0 : parseFloat(newTier.fee),
      fee_pct: isPct ? parseFloat(newTier.fee_pct) : null,
    }
    setBusy(true)
    try {
      const r = await api.post(`/platforms/${platform.id}/tiers`, payload)
      setTiers(p => [...p, r.data])
      setNewTier(TIER_DEFAULTS)
      setAddTier(false)
    } catch(e) { onError?.(errText(e, 'Failed to add tier')) }
    finally { setBusy(false) }
  }

  const f = (k, v) => setForm(p => ({ ...p, [k]: v }))

  return (
    <div className={`st-card${platform.is_active ? '' : ' st-card-inactive'}`}>
      {/* Card header */}
      <div role="button" tabIndex={0} aria-expanded={expanded} onKeyDown={e => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); setExpanded(p => !p) } }} className="st-card-head" onClick={() => setExpanded(p => !p)}>
        <div className="st-card-left">
          <div className="st-plat-dot" style={{ background: platform.is_active ? '#22c55e' : '#9ca3af' }} />
          <span className="st-plat-name">{platform.name}{!canEdit && <small> · company {platform.company_id}</small>}</span>
          <span className={`st-active-badge ${platform.is_active ? 'active' : 'inactive'}`}>
            {platform.is_active ? 'Active' : 'Inactive'}
          </span>
        </div>
        <div className="st-card-right">
          <span className="st-reverse-fee">Reverse shipping <strong>₹{platform.cr_charge}</strong> / return</span>
          <span className="st-plat-meta">AD {platform.default_ad_pct}% · Profit {platform.default_profit_pct}% · {tiers.length} tier{tiers.length !== 1 ? 's' : ''}</span>
          <span className={`st-chev${expanded ? ' open' : ''}`}>▾</span>
        </div>
      </div>

      {/* Expanded body */}
      {expanded && (
        <div className="st-card-body">

          {/* Fields */}
          {editing ? (
            <div className="st-fields">
              <div className="st-field-group">
                <label htmlFor={fieldId0 + '-field-342'} className="st-label">Platform Name</label>
                <input aria-label={"Platform Name"} id={fieldId0 + '-field-342'} className="st-input" value={form.name} onChange={e => f('name', e.target.value)} />
              </div>
              <div className="st-field-row">
                <div className="st-field-group">
                  <label htmlFor={fieldId0 + '-field-347'} className="st-label">Reverse shipping / return (₹)</label>
                  <input aria-label="Reverse shipping charge per return" id={fieldId0 + '-field-347'} className="st-input" type="number" min="0" step="0.01" value={form.cr_charge} onChange={e => f('cr_charge', e.target.value)} />
                </div>
                <div className="st-field-group">
                  <label htmlFor={fieldId0 + '-field-351'} className="st-label">CR %</label>
                  <input aria-label={"CR %"} id={fieldId0 + '-field-351'} className="st-input" type="number" value={form.cr_percentage} onChange={e => f('cr_percentage', e.target.value)} />
                </div>
                <div className="st-field-group">
                  <label htmlFor={fieldId0 + '-field-355'} className="st-label">Default AD %</label>
                  <input aria-label={"Default AD %"} id={fieldId0 + '-field-355'} className="st-input" type="number" value={form.default_ad_pct} onChange={e => f('default_ad_pct', e.target.value)} />
                </div>
                <div className="st-field-group">
                  <label htmlFor={fieldId0 + '-field-359'} className="st-label">Default Profit %</label>
                  <input aria-label={"Default Profit %"} id={fieldId0 + '-field-359'} className="st-input" type="number" value={form.default_profit_pct} onChange={e => f('default_profit_pct', e.target.value)} />
                </div>
              </div>
              <div className="st-edit-actions">
                <button className="st-save-btn" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save Changes'}</button>
                <button className="st-cancel-btn" onClick={cancelEdit}>Cancel</button>
              </div>
            </div>
          ) : (
            <div className="st-fields-view">
              <div className="st-fv-row">
                <div className="st-fv-item">
                  <div className="st-fv-label">Reverse shipping / return</div>
                  <div className="st-fv-val">₹{platform.cr_charge}</div>
                </div>
                <div className="st-fv-item">
                  <div className="st-fv-label">CR %</div>
                  <div className="st-fv-val">{platform.cr_percentage}%</div>
                </div>
                <div className="st-fv-item highlight">
                  <div className="st-fv-label">Default AD %</div>
                  <div className="st-fv-val">{platform.default_ad_pct}%</div>
                </div>
                <div className="st-fv-item highlight">
                  <div className="st-fv-label">Default Profit %</div>
                  <div className="st-fv-val">{platform.default_profit_pct}%</div>
                </div>
              </div>
              <div className="st-card-actions">
                <button className="st-edit-btn" disabled={!canEdit} onClick={() => setEditing(true)}>Edit Platform</button>
                <button className={`st-toggle-btn ${platform.is_active ? 'deactivate' : 'activate'}`}
                  onClick={toggleActive} disabled={busy || !canEdit}>
                  {busy ? '…' : platform.is_active ? 'Deactivate' : 'Activate'}
                </button>
              </div>
            </div>
          )}

          {/* Tiers */}
          <div className="st-tiers-section">
            <div className="st-tiers-header">
              <span className="st-tiers-title">Fee Tiers</span>
              <button className="st-add-tier-btn" disabled={!canEdit} onClick={() => setAddTier(p => !p)}>+ Add Tier</button>
            </div>
            {tiers.length === 0 && !addTier && (
              <div className="st-tiers-empty">No tiers defined. Add a fee tier above.</div>
            )}
            {tiers.map(t => (
              <TierRow key={t.id} tier={t} platformId={platform.id}
                onUpdated={updated => setTiers(p => p.map(x => x.id === updated.id ? updated : x))}
                onDeleted={id => setTiers(p => p.filter(x => x.id !== id))}
                onError={onError} canEdit={canEdit}
              />
            ))}
            {addTier && (
              <div className="st-tier-row st-tier-edit">
                <input aria-label="Tier name (e.g. Standard)" className="st-tier-input" placeholder="Tier name (e.g. Standard)"
                  value={newTier.tier_name} onChange={e => setNewTier(p => ({ ...p, tier_name: e.target.value }))} />
                <select className="st-tier-input st-tier-mode"
                  value={newTier.mode || 'amt'}
                  onChange={e => setNewTier(p => ({ ...p, mode: e.target.value }))}>
                  <option value="amt">₹</option>
                  <option value="pct">%</option>
                </select>
                {(newTier.mode || 'amt') === 'pct'
                  ? <input aria-label="% of base" className="st-tier-input st-tier-fee" type="number" placeholder="% of base"
                      value={newTier.fee_pct} onChange={e => setNewTier(p => ({ ...p, fee_pct: e.target.value }))} />
                  : <input aria-label="Fee in ₹" className="st-tier-input st-tier-fee" type="number" placeholder="Fee in ₹"
                      value={newTier.fee} onChange={e => setNewTier(p => ({ ...p, fee: e.target.value }))} />
                }
                <button className="st-tier-save" onClick={handleTierAdded} disabled={busy}>{busy ? '…' : 'Add'}</button>
                <button className="st-tier-cancel" onClick={() => { setAddTier(false); setNewTier(TIER_DEFAULTS) }}>✕</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default function Settings() {
  const fieldId1 = useId()
  const { role, isAll } = useCompany()
  const canEdit = !isAll && ['owner', 'admin'].includes(role)
  const toastTimer = useRef(null)
  useEffect(() => () => clearTimeout(toastTimer.current), [])
  const [historyVersion, setHistoryVersion] = useState(0)
  const [loadError, setLoadError] = useState('')
  const [platforms,  setPlatforms]  = useState([])
  const [loading,    setLoading]    = useState(true)
  const [toast,      setToast]      = useState(null)
  const [showAdd,    setShowAdd]    = useState(false)
  const [busy,       setBusy]       = useState(false)
  const [newPlat,    setNewPlat]    = useState({ name: '', cr_charge: '0', cr_percentage: '0', default_ad_pct: '0', default_profit_pct: '20' })

  const showToast = (msg, type = 'success') => {
    clearTimeout(toastTimer.current)
    setToast({ msg, type })
    if (type !== 'error') {toastTimer.current = setTimeout(() => setToast(null), 6000)}
  }

  useEffect(() => {
    getPlatforms().then(setPlatforms).catch(e => setLoadError(errText(e, 'Could not load platforms'))).finally(() => setLoading(false))
  }, [])

  const handleUpdated = updated => {
    setPlatforms(p => p.map(x => x.id === updated.id ? updated : x))
    showToast('Defaults updated. They apply when overrides are omitted; existing saved prices and historical snapshots remain unchanged.')
  }

  const handleAdd = async () => {
    if (!newPlat.name.trim() || newPlat.cr_charge === '' || newPlat.cr_percentage === '') {showToast('Enter a platform name, reverse-shipping charge and return percentage.', 'error'); return}
    setBusy(true)
    try {
      const created = await createPlatform({
        name:               newPlat.name.trim(),
        cr_charge:          parseFloat(newPlat.cr_charge),
        cr_percentage:      parseFloat(newPlat.cr_percentage),
        default_ad_pct:     parseFloat(newPlat.default_ad_pct || 0),
        default_profit_pct: parseFloat(newPlat.default_profit_pct || 20),
        tiers:              [],
      })
      setPlatforms(p => [...p, created])
      setNewPlat({ name: '', cr_charge: '0', cr_percentage: '0', default_ad_pct: '0', default_profit_pct: '20' })
      setShowAdd(false)
      showToast('Platform created')
    } catch(e) {
      showToast(errText(e, 'Create failed'), 'error')
    } finally { setBusy(false) }
  }

  if (loadError) {return <div role="alert">{loadError} <button onClick={() => window.location.reload()}>Retry</button></div>}
  if (loading) {return <div className="st-loading"><div className="loader" /></div>}

  return (
    <div className="st-page">
      {toast && <Toast {...toast} onDismiss={() => setToast(null)} />}

      {/* Header */}
      <div className="st-header">
        <div>
          <h1 className="st-title">Settings</h1>
          <p className="st-sub">Manage platform defaults and fee tiers. Defaults apply when a calculation omits an override. Existing saved prices and historical snapshots remain fixed.</p>
        </div>
        <button className="st-add-btn" disabled={!canEdit} onClick={() => setShowAdd(p => !p)}>+ Add Platform</button>
      </div>

      {/* Add Platform form */}
      {showAdd && (
        <div className="st-add-card">
          <div className="st-add-title">New Platform</div>
          <div className="st-field-row">
            <div className="st-field-group">
              <label htmlFor={fieldId1 + '-field-510'} className="st-label">Name</label>
              <input aria-label={"Name"} id={fieldId1 + '-field-510'} className="st-input" placeholder="e.g. Meesho"
                value={newPlat.name} onChange={e => setNewPlat(p => ({ ...p, name: e.target.value }))} />
            </div>
            <div className="st-field-group">
              <label htmlFor={fieldId1 + '-field-515'} className="st-label">Reverse shipping / return (₹)</label>
              <input aria-label="Reverse shipping charge per return" id={fieldId1 + '-field-515'} className="st-input" type="number" min="0" step="0.01" placeholder="0"
                value={newPlat.cr_charge} onChange={e => setNewPlat(p => ({ ...p, cr_charge: e.target.value }))} />
            </div>
            <div className="st-field-group">
              <label htmlFor={fieldId1 + '-field-520'} className="st-label">CR %</label>
              <input aria-label={"CR %"} id={fieldId1 + '-field-520'} className="st-input" type="number" placeholder="0"
                value={newPlat.cr_percentage} onChange={e => setNewPlat(p => ({ ...p, cr_percentage: e.target.value }))} />
            </div>
            <div className="st-field-group">
              <label htmlFor={fieldId1 + '-field-525'} className="st-label">Default AD %</label>
              <input aria-label={"Default AD %"} id={fieldId1 + '-field-525'} className="st-input" type="number" placeholder="0"
                value={newPlat.default_ad_pct} onChange={e => setNewPlat(p => ({ ...p, default_ad_pct: e.target.value }))} />
            </div>
            <div className="st-field-group">
              <label htmlFor={fieldId1 + '-field-530'} className="st-label">Default Profit %</label>
              <input aria-label={"Default Profit %"} id={fieldId1 + '-field-530'} className="st-input" type="number" placeholder="20"
                value={newPlat.default_profit_pct} onChange={e => setNewPlat(p => ({ ...p, default_profit_pct: e.target.value }))} />
            </div>
          </div>
          <div className="st-edit-actions">
            <button className="st-save-btn" onClick={handleAdd} disabled={busy}>{busy ? 'Creating…' : 'Create Platform'}</button>
            <button className="st-cancel-btn" onClick={() => setShowAdd(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Platform section */}
      <div className="st-section">
        <div className="st-section-title">Platforms <span className="st-count">{platforms.length}</span></div>
        {platforms.length === 0
          ? <div className="st-empty">No platforms. Add one above.</div>
          : platforms.map(p => (
              <PlatformCard key={p.id} platform={p} canEdit={canEdit} onUpdated={handleUpdated}
                onError={msg => showToast(msg, 'error')} />
            ))
        }
      </div>

      {canEdit && <PricingRefresh onApplied={() => setHistoryVersion(v => v + 1)} />}
      <FinancialHistory refreshKey={historyVersion} />
      {!isAll && <CompanyManage />}
      {!isAll && <CompanyModules />}
    </div>
  )
}
