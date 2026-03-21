import { useState, useEffect, useCallback } from 'react'
import {
  getVendors, getCategories, getPlatforms,
  getMiscTotal, getSettings,
  getEntries, upsertBatch
} from '../api/client'
import SmartCell from '../components/SmartCell'
import AddVendorModal from '../components/AddVendorModal'
import AddCategoryModal from '../components/AddCategoryModal'
import './Entries.css'

// ─── Row status ───────────────────────────────────────────────────────────────
const STATUS = {
  NEW:    'new',
  DIRTY:  'dirty',
  SAVING: 'saving',
  SAVED:  'saved',
  ERROR:  'error',
}

// ─── Column groups ────────────────────────────────────────────────────────────
const COL_GROUPS = {
  skuDetails:    { label: 'SKU Details',    cols: ['vshort','vsku','category'] },
  costBreakdown: { label: 'Cost Breakdown', cols: ['pkg','log','ad','addons','misc'] },
  calculations:  { label: 'Calculations',   cols: ['crpct','cramt','dmgpct','dmgamt','profpct','profamt','bsnogst','gst'] },
}
const DEFAULT_VISIBILITY = { skuDetails: true, costBreakdown: true, calculations: true }
const LS_KEY = 'casper_col_visibility'

function loadVisibility() {
  try {
    const saved = localStorage.getItem(LS_KEY)
    return saved ? JSON.parse(saved) : DEFAULT_VISIBILITY
  } catch { return DEFAULT_VISIBILITY }
}
function saveVisibility(v) { localStorage.setItem(LS_KEY, JSON.stringify(v)) }

// ─── Row factory ──────────────────────────────────────────────────────────────
let _id = 0
function newRow(data = {}) {
  return {
    id:         ++_id,
    skuId:      data.skuId      || null,
    status:     data.status     || STATUS.NEW,
    errorMsg:   data.errorMsg   || '',
    vendor:     data.vendor     || '',
    vendorId:   data.vendorId   || null,
    vshort:     data.vshort     || '',
    vsku:       data.vsku       || '',
    sku:        data.sku        || '',
    category:   data.category   || '',
    categoryId: data.categoryId || null,
    price:      data.price      || '',
    pkg:        data.pkg        || '',
    log:        data.log        || '',
    ad:         data.ad         || '',
    addons:     data.addons     || '',
    misc:       data.misc       || '',
    crPct:      data.crPct      || '',
    crAmt:      data.crAmt      || '',
    dmgPct:     data.dmgPct     || '',
    dmgAmt:     data.dmgAmt     || '',
    profPct:    data.profPct    || '',
    profAmt:    data.profAmt    || '',
    gst:        data.gst        || '',
    tiers:      data.tiers      || {},
  }
}

// Convert backend row → frontend row
function backendRowToFrontend(r) {
  return newRow({
    skuId:      r.id,
    status:     STATUS.SAVED,
    vendor:     r.vendor_name   || '',
    vendorId:   r.vendor_id     || null,
    vshort:     r.vendor_short  || '',
    sku:        r.shringar_sku  || '',
    category:   r.category_name || '',
    categoryId: r.category_id   || null,
    price:      r.price             != null ? String(r.price)             : '',
    pkg:        r.package           != null ? String(r.package)           : '',
    log:        r.logistics         != null ? String(r.logistics)         : '',
    ad:         r.ad                != null ? String(r.ad)                : '',
    addons:     r.addons            != null ? String(r.addons)            : '',
    misc:       r.misc_total        != null ? String(r.misc_total)        : '',
    crPct:      r.cr_percentage     != null ? String(r.cr_percentage)     : '',
    crAmt:      r.cr_cost           != null ? String(r.cr_cost)           : '',
    dmgPct:     r.damage_percentage != null ? String(r.damage_percentage) : '',
    dmgAmt:     r.damage_cost       != null ? String(r.damage_cost)       : '',
    gst:        r.gst               != null ? String(r.gst)               : '',
  })
}

// ─── Compute ──────────────────────────────────────────────────────────────────
function compute(row, miscDef, profDef, platforms) {
  const p      = parseFloat(row.price)  || 0
  const pkg    = parseFloat(row.pkg)    || 0
  const log    = parseFloat(row.log)    || 0
  const ad     = parseFloat(row.ad)     || 0
  const addons = parseFloat(row.addons) || 0
  const misc   = row.misc !== '' ? parseFloat(row.misc) : miscDef
  const crCharge = platforms[0]?.cr_charge || 160

  let crPct, crAmt
  if (row.crAmt !== '') {
    crAmt = parseFloat(row.crAmt) || 0
    crPct = crCharge > 0 ? (crAmt / crCharge) * 100 : 0
  } else {
    crPct = row.crPct !== '' ? parseFloat(row.crPct) : 10
    crAmt = crCharge * crPct / 100
  }

  let dmgPct, dmgAmt
  if (row.dmgAmt !== '') {
    dmgAmt = parseFloat(row.dmgAmt) || 0
    dmgPct = p > 0 ? (dmgAmt / p) * 100 : 0
  } else {
    dmgPct = row.dmgPct !== '' ? parseFloat(row.dmgPct) : 15
    dmgAmt = p * dmgPct / 100
  }

  const be = p + pkg + log + ad + addons + misc + crAmt + dmgAmt

  let profPct, profAmt
  if (row.profAmt !== '') {
    profAmt = parseFloat(row.profAmt) || 0
    profPct = be > 0 ? (profAmt / be) * 100 : 0
  } else {
    profPct = row.profPct !== '' ? parseFloat(row.profPct) : profDef
    profAmt = be * profPct / 100
  }

  const bsNoGst = Math.round(be + profAmt)
  const gst     = parseFloat(row.gst) || 0
  const finalBS = bsNoGst + gst

  return {
    crPct:   +crPct.toFixed(2),  crAmt:   +crAmt.toFixed(2),
    dmgPct:  +dmgPct.toFixed(2), dmgAmt:  +dmgAmt.toFixed(2),
    be:      +be.toFixed(2),
    profPct: +profPct.toFixed(2), profAmt: +profAmt.toFixed(2),
    bsNoGst, finalBS,
  }
}

function platBS(row, pl, miscDef, profDef, platforms) {
  if (!row.price) return { bs: null, tierIdx: row.tiers[pl.id] ?? 0 }
  const tierIdx = row.tiers[pl.id] ?? 0
  const tier    = pl.tiers?.[tierIdx]
  if (!tier) return { bs: null, tierIdx }
  const c      = compute(row, miscDef, profDef, platforms)
  const cr     = pl.cr_charge * (c.crPct / 100)
  const p      = parseFloat(row.price)  || 0
  const pkg    = parseFloat(row.pkg)    || 0
  const log    = parseFloat(row.log)    || 0
  const ad     = parseFloat(row.ad)     || 0
  const addons = parseFloat(row.addons) || 0
  const misc   = row.misc !== '' ? parseFloat(row.misc) : miscDef
  const be     = p + pkg + log + ad + addons + misc + cr + c.dmgAmt
  const bsNoGst = Math.round(be + be * (c.profPct / 100))
  const gst    = parseFloat(row.gst) || 0
  const bs     = bsNoGst + gst + (tier.fee || 0)
  return { bs, tierIdx }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function Entries() {
  const [vendors,     setVendors]     = useState([])
  const [categories,  setCategories]  = useState([])
  const [platforms,   setPlatforms]   = useState([])
  const [activePlats, setActivePlats] = useState([])
  const [miscDef,     setMiscDef]     = useState(12)
  const [profDef,     setProfDef]     = useState(20)
  const [rows,        setRows]        = useState(() => [newRow(), newRow(), newRow()])
  const [colVis,      setColVis]      = useState(loadVisibility)
  const [vendorModal,   setVendorModal]   = useState(null)
  const [categoryModal, setCategoryModal] = useState(null)
  const [pendingRowId,  setPendingRowId]  = useState(null)
  const [loading, setLoading] = useState(true)

  // ── Load data on mount ─────────────────────────────────────────────────────
  useEffect(() => {
    Promise.all([
      getVendors(), getCategories(), getPlatforms(),
      getMiscTotal(), getSettings(), getEntries()
    ]).then(([v, c, p, misc, settings, entries]) => {
      setVendors(v.filter(x => x.is_active))
      setCategories(c.filter(x => x.is_active))
      const ap = p.filter(x => x.is_active)
      setPlatforms(ap)
      setActivePlats(ap)
      setMiscDef(misc?.total ?? 12)
      if (entries.length > 0) {
        setRows(entries.map(backendRowToFrontend))
      }
    }).finally(() => setLoading(false))
  }, [])

  // ── Row update — marks dirty ───────────────────────────────────────────────
  const upd = useCallback((id, patch) =>
    setRows(prev => prev.map(r =>
      r.id === id ? { ...r, ...patch, status: STATUS.DIRTY } : r
    )), [])

  const addRow = () => setRows(p => [...p, newRow()])
  const delRow = id  => setRows(p => p.filter(r => r.id !== id))

  const handleTier = useCallback((rowId, plId, ti) =>
    setRows(prev => prev.map(r =>
      r.id === rowId ? { ...r, tiers: { ...r.tiers, [plId]: ti } } : r
    )), [])

  // ── Save logic ─────────────────────────────────────────────────────────────
  const saveRows = useCallback(async (rowsToSave) => {
    if (!rowsToSave.length) return

    // Mark as saving
    setRows(prev => prev.map(r =>
      rowsToSave.find(s => s.id === r.id)
        ? { ...r, status: STATUS.SAVING } : r
    ))

    const payload = rowsToSave.map(row => ({
      shringar_sku:      row.sku,
      vendor_id:         row.vendorId   || null,
      category_id:       row.categoryId || null,
      price:             parseFloat(row.price),
      package:           parseFloat(row.pkg)    || 0,
      logistics:         parseFloat(row.log)    || 0,
      ad:                parseFloat(row.ad)     || 0,
      addons:            parseFloat(row.addons) || 0,
      misc_total:        row.misc   !== '' ? parseFloat(row.misc)   : null,
      cr_percentage:     row.crPct  !== '' ? parseFloat(row.crPct)  : null,
      cr_cost:           row.crAmt  !== '' ? parseFloat(row.crAmt)  : null,
      damage_percentage: row.dmgPct !== '' ? parseFloat(row.dmgPct) : null,
      damage_cost:       row.dmgAmt !== '' ? parseFloat(row.dmgAmt) : null,
      profit_percentage: row.profPct !== '' ? parseFloat(row.profPct) : null,
      gst:               parseFloat(row.gst) || 0,
    }))

    try {
      const result = await upsertBatch(payload)
      const savedSkus = new Set(result.saved.map(r => r.shringar_sku))
      const errorMap  = {}
      result.errors.forEach(r => { errorMap[r.shringar_sku] = r.error })

      setRows(prev => prev.map(r => {
        const match = rowsToSave.find(s => s.id === r.id)
        if (!match) return r
        if (savedSkus.has(r.sku)) return { ...r, status: STATUS.SAVED,  errorMsg: '' }
        if (errorMap[r.sku])      return { ...r, status: STATUS.ERROR,  errorMsg: errorMap[r.sku] }
        return r
      }))
    } catch {
      // Network error — revert to dirty
      setRows(prev => prev.map(r =>
        rowsToSave.find(s => s.id === r.id)
          ? { ...r, status: STATUS.DIRTY } : r
      ))
    }
  }, [])

  const saveAll = useCallback(() => {
    const dirty = rows.filter(r =>
      (r.status === STATUS.DIRTY || r.status === STATUS.NEW) &&
      r.sku && r.price
    )
    saveRows(dirty)
  }, [rows, saveRows])

  // ── Auto-save every 30 seconds ─────────────────────────────────────────────
  useEffect(() => {
    const interval = setInterval(() => {
      setRows(current => {
        const dirty = current.filter(r =>
          (r.status === STATUS.DIRTY || r.status === STATUS.NEW) &&
          r.sku && r.price
        )
        if (dirty.length > 0) saveRows(dirty)
        return current
      })
    }, 30000)
    return () => clearInterval(interval)
  }, [saveRows])

  // ── Warn on page close if unsaved ─────────────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      const dirty = rows.some(r => r.status === STATUS.DIRTY && r.sku && r.price)
      if (dirty) { e.preventDefault(); e.returnValue = '' }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [rows])

  // ── Column visibility ──────────────────────────────────────────────────────
  const toggleGroup = (key) => {
    const next = { ...colVis, [key]: !colVis[key] }
    setColVis(next); saveVisibility(next)
  }
  const resetVisibility = () => {
    setColVis(DEFAULT_VISIBILITY); saveVisibility(DEFAULT_VISIBILITY)
  }
  const vis = (col) => {
    for (const [key, group] of Object.entries(COL_GROUPS)) {
      if (group.cols.includes(col)) return colVis[key] !== false
    }
    return true
  }

  const vendorOpts = vendors.map(v => ({ label: v.name, sublabel: v.short_code }))
  const catOpts    = categories.map(c => ({ label: c.name }))

  const handleVendorSaved = v => {
    setVendors(p => [...p, v])
    if (pendingRowId) upd(pendingRowId, { vendor:v.name, vendorId:v.id, vshort:v.short_code })
    setVendorModal(null); setPendingRowId(null)
  }
  const handleCatSaved = c => {
    setCategories(p => [...p, c])
    if (pendingRowId) upd(pendingRowId, { category:c.name, categoryId:c.id })
    setCategoryModal(null); setPendingRowId(null)
  }

  // ── Derived save state ─────────────────────────────────────────────────────
  const isSaving  = rows.some(r => r.status === STATUS.SAVING)
  const dirtyCount = rows.filter(r => r.status === STATUS.DIRTY && r.sku && r.price).length
  const allSaved  = rows.some(r => r.status === STATUS.SAVED) && dirtyCount === 0 && !isSaving

  if (loading) return (
    <div className="loader-page">
      <div className="loader" style={{ width:32, height:32 }}/>
    </div>
  )

  return (
    <div className="entries-page">

      {/* ── Header ── */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Entries</h1>
          <p className="page-subtitle">{rows.length} rows</p>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          {/* Save status */}
          <span className="save-status">
            {isSaving && <span className="save-saving">⟳ Saving...</span>}
            {!isSaving && dirtyCount > 0 && (
              <span className="save-dirty">● {dirtyCount} unsaved</span>
            )}
            {allSaved && <span className="save-saved">✓ All saved</span>}
          </span>
          <button className="btn btn-ghost">Import Excel</button>
          <button className="btn btn-ghost">Export</button>
          <button className="btn btn-gold" onClick={saveAll} disabled={isSaving || dirtyCount === 0}>
            {isSaving
              ? <><span className="loader" style={{ width:12, height:12, borderWidth:2 }}/> Saving</>
              : '💾 Save All'
            }
          </button>
          <button className="btn btn-ghost" onClick={addRow}>+ Add Row</button>
        </div>
      </div>

      {/* ── Global settings bar ── */}
      <div className="e-bar">
        <div className="e-bar-item">
          <label>Global Profit %</label>
          <input type="number" value={profDef} min={0} max={100}
            onChange={e => setProfDef(parseFloat(e.target.value)||20)} />
        </div>
        <div className="e-bar-item">
          <label>Default Misc ₹</label>
          <input type="number" value={miscDef} min={0}
            onChange={e => setMiscDef(parseFloat(e.target.value)||0)} />
        </div>
        <div className="e-bar-sep"/>
        <label className="e-bar-label">Platforms:</label>
        <div className="e-chips">
          {platforms.map(pl => (
            <button key={pl.id}
              className={`e-chip ${activePlats.find(p=>p.id===pl.id)?'on':''}`}
              onClick={() => setActivePlats(prev =>
                prev.find(p=>p.id===pl.id)
                  ? prev.filter(p=>p.id!==pl.id)
                  : [...prev, pl])}>
              {pl.name}
            </button>
          ))}
        </div>
      </div>

      {/* ── Column visibility ── */}
      <div className="col-toggle-bar">
        <span className="col-toggle-label">Columns:</span>
        {Object.entries(COL_GROUPS).map(([key, group]) => (
          <button key={key}
            className={`col-toggle-btn ${colVis[key] ? 'on' : 'off'}`}
            onClick={() => toggleGroup(key)}>
            <span>{colVis[key] ? '✓' : '○'}</span>
            {group.label}
          </button>
        ))}
        <div className="col-toggle-sep"/>
        <button className="col-reset" onClick={resetVisibility}>↺ Reset</button>
      </div>

      {/* ── Desktop Table ── */}
      <div className="e-scroll">
        <table className="e-tbl">
          <thead>
            <tr>
              <th className="gh gh-sku"
                colSpan={2 + (vis('vshort')?1:0) + (vis('vsku')?1:0) + (vis('category')?1:0)}>
                SKU
              </th>
              <th className="gh gh-ue"
                colSpan={1+(vis('pkg')?1:0)+(vis('log')?1:0)+(vis('ad')?1:0)+(vis('addons')?1:0)+(vis('misc')?1:0)+(vis('crpct')?1:0)+(vis('cramt')?1:0)+(vis('dmgpct')?1:0)+(vis('dmgamt')?1:0)}>
                Unit Economics
              </th>
              <th className="gh gh-prof"
                colSpan={1+(vis('profpct')?1:0)+(vis('profamt')?1:0)+(vis('bsnogst')?1:0)}>
                Profitability
              </th>
              {vis('gst') && <th className="gh gh-tax">Tax</th>}
              <th className="gh gh-bs">Bank Settlement</th>
              {activePlats.map(pl => (
                <th key={pl.id} className="gh gh-plat">
                  {pl.name}
                  <button className="gh-x"
                    onClick={() => setActivePlats(p => p.filter(x => x.id !== pl.id))}>✕</button>
                </th>
              ))}
              <th className="gh" style={{ minWidth:28 }}/>
              <th className="gh" style={{ minWidth:28 }}/>
            </tr>
            <tr>
              <th className="sh sh-sku w-vendor">Vendor</th>
              <th className="sh sh-sku w-sku">Shringar SKU</th>
              {vis('vshort')   && <th className="sh sh-sku w-vshort">V.Short</th>}
              {vis('vsku')     && <th className="sh sh-sku w-vsku">Vendor SKU</th>}
              {vis('category') && <th className="sh sh-sku w-cat">Category</th>}
              <th className="sh sh-ue w-price">Price ₹</th>
              {vis('pkg')    && <th className="sh sh-ue w-pkg">Package</th>}
              {vis('log')    && <th className="sh sh-ue w-log">Logistics</th>}
              {vis('ad')     && <th className="sh sh-ue w-ad">Ad</th>}
              {vis('addons') && <th className="sh sh-ue w-addons">Addons</th>}
              {vis('misc')   && <th className="sh sh-ue w-misc">Misc</th>}
              {vis('crpct')  && <th className="sh sh-ue w-crpct">CR %</th>}
              {vis('cramt')  && <th className="sh sh-ue w-cramt">CR ₹</th>}
              {vis('dmgpct') && <th className="sh sh-ue w-dmgpct">Dmg %</th>}
              {vis('dmgamt') && <th className="sh sh-ue w-dmgamt">Dmg ₹</th>}
              <th className="sh sh-prof w-be">Breakeven</th>
              {vis('profpct') && <th className="sh sh-prof w-profpct">Profit %</th>}
              {vis('profamt') && <th className="sh sh-prof w-profamt">Profit ₹</th>}
              {vis('bsnogst') && <th className="sh sh-prof w-bsnogst">BS w/o GST</th>}
              {vis('gst')     && <th className="sh sh-tax w-gst">GST ₹</th>}
              <th className="sh sh-bs w-finalbs">Final BS</th>
              {activePlats.map(pl => (
                <th key={pl.id} className="sh sh-plat w-plat">{pl.name}</th>
              ))}
              <th className="sh" style={{ minWidth:28 }}/>
              <th className="sh" style={{ minWidth:28 }}/>
            </tr>
          </thead>

          <tbody>
            {rows.map(row => {
              const c = compute(row, miscDef, profDef, platforms)
              return (
                <tr key={row.id} className={`e-row ${row.status === STATUS.ERROR ? 'row-error' : ''}`}>

                  {/* Vendor */}
                  <td className="ec ec-smart w-vendor sh-sku">
                    <SmartCell
                      value={row.vendor} options={vendorOpts} placeholder="Vendor"
                      onChange={v => upd(row.id, { vendor:v, vendorId:null })}
                      onSelect={opt => {
                        const vnd = vendors.find(v=>v.name===opt.label)
                        upd(row.id, { vendor:opt.label, vendorId:vnd?.id||null, vshort:vnd?.short_code||'' })
                      }}
                      onAddNew={name => { setPendingRowId(row.id); setVendorModal(name) }}
                      addNewLabel="Add as new vendor"
                    />
                  </td>

                  {/* Shringar SKU */}
                  <td className="ec w-sku sh-sku">
                    <input className="ec-input mono" value={row.sku} placeholder="SHJ-JS-VRI-N6"
                      onChange={e => upd(row.id, { sku:e.target.value.toUpperCase() })} />
                  </td>

                  {vis('vshort') && (
                    <td className="ec w-vshort sh-sku">
                      <input className="ec-input mono" value={row.vshort} placeholder="VRI"
                        onChange={e => upd(row.id, { vshort:e.target.value.toUpperCase() })} />
                    </td>
                  )}
                  {vis('vsku') && (
                    <td className="ec w-vsku sh-sku">
                      <input className="ec-input mono" value={row.vsku} placeholder="N6-WHITE"
                        onChange={e => upd(row.id, { vsku:e.target.value })} />
                    </td>
                  )}
                  {vis('category') && (
                    <td className="ec ec-smart w-cat sh-sku">
                      <SmartCell
                        value={row.category} options={catOpts} placeholder="Category"
                        onChange={v => upd(row.id, { category:v, categoryId:null })}
                        onSelect={opt => {
                          const cat = categories.find(c=>c.name===opt.label)
                          upd(row.id, { category:opt.label, categoryId:cat?.id||null })
                        }}
                        onAddNew={name => { setPendingRowId(row.id); setCategoryModal(name) }}
                        addNewLabel="Add as new category"
                      />
                    </td>
                  )}

                  {/* Price */}
                  <td className="ec w-price sh-ue">
                    <input className="ec-input right mono" type="number" value={row.price}
                      placeholder="0" onChange={e => upd(row.id, { price:e.target.value })} />
                  </td>

                  {vis('pkg') && (
                    <td className="ec w-pkg sh-ue">
                      <input className="ec-input right mono" type="number" value={row.pkg}
                        placeholder="0" onChange={e => upd(row.id, { pkg:e.target.value })} />
                    </td>
                  )}
                  {vis('log') && (
                    <td className="ec w-log sh-ue">
                      <input className="ec-input right mono" type="number" value={row.log}
                        placeholder="0" onChange={e => upd(row.id, { log:e.target.value })} />
                    </td>
                  )}
                  {vis('ad') && (
                    <td className="ec w-ad sh-ue">
                      <input className="ec-input right mono" type="number" value={row.ad}
                        placeholder="0" onChange={e => upd(row.id, { ad:e.target.value })} />
                    </td>
                  )}
                  {vis('addons') && (
                    <td className="ec w-addons sh-ue">
                      <input className="ec-input right mono" type="number" value={row.addons}
                        placeholder="0" onChange={e => upd(row.id, { addons:e.target.value })} />
                    </td>
                  )}
                  {vis('misc') && (
                    <td className="ec w-misc sh-ue">
                      <input className="ec-input right mono" type="number" value={row.misc}
                        placeholder={miscDef} onChange={e => upd(row.id, { misc:e.target.value })} />
                    </td>
                  )}
                  {vis('crpct') && (
                    <td className="ec w-crpct sh-ue">
                      <input className="ec-input right mono" type="number" value={row.crPct}
                        placeholder={c.crPct}
                        onChange={e => upd(row.id, { crPct:e.target.value, crAmt:'' })} />
                    </td>
                  )}
                  {vis('cramt') && (
                    <td className="ec w-cramt sh-ue">
                      <input className="ec-input right mono" type="number" value={row.crAmt}
                        placeholder={c.crAmt}
                        onChange={e => upd(row.id, { crAmt:e.target.value, crPct:'' })} />
                    </td>
                  )}
                  {vis('dmgpct') && (
                    <td className="ec w-dmgpct sh-ue">
                      <input className="ec-input right mono" type="number" value={row.dmgPct}
                        placeholder={c.dmgPct}
                        onChange={e => upd(row.id, { dmgPct:e.target.value, dmgAmt:'' })} />
                    </td>
                  )}
                  {vis('dmgamt') && (
                    <td className="ec w-dmgamt sh-ue">
                      <input className="ec-input right mono" type="number" value={row.dmgAmt}
                        placeholder={c.dmgAmt}
                        onChange={e => upd(row.id, { dmgAmt:e.target.value, dmgPct:'' })} />
                    </td>
                  )}

                  {/* Breakeven */}
                  <td className="ec ec-auto w-be sh-prof">
                    {row.price ? `₹${c.be}` : '—'}
                  </td>
                  {vis('profpct') && (
                    <td className="ec w-profpct sh-prof">
                      <input className="ec-input right mono" type="number" value={row.profPct}
                        placeholder={c.profPct}
                        onChange={e => upd(row.id, { profPct:e.target.value, profAmt:'' })} />
                    </td>
                  )}
                  {vis('profamt') && (
                    <td className="ec w-profamt sh-prof">
                      <input className="ec-input right mono" type="number" value={row.profAmt}
                        placeholder={c.profAmt}
                        onChange={e => upd(row.id, { profAmt:e.target.value, profPct:'' })} />
                    </td>
                  )}
                  {vis('bsnogst') && (
                    <td className="ec ec-auto w-bsnogst sh-prof">
                      {row.price ? `₹${c.bsNoGst}` : '—'}
                    </td>
                  )}

                  {vis('gst') && (
                    <td className="ec w-gst sh-tax">
                      <input className="ec-input right mono" type="number" value={row.gst}
                        placeholder="0" onChange={e => upd(row.id, { gst:e.target.value })} />
                    </td>
                  )}

                  {/* Final BS */}
                  <td className="ec ec-auto ec-gold w-finalbs sh-bs">
                    {row.price ? `₹${c.finalBS}` : '—'}
                  </td>

                  {/* Platforms */}
                  {activePlats.map(pl => {
                    const { bs, tierIdx } = platBS(row, pl, miscDef, profDef, platforms)
                    return (
                      <td key={pl.id} className="ec ec-plat w-plat">
                        <div className="plat-cell">
                          <select className="plat-tier" value={tierIdx}
                            onChange={e => handleTier(row.id, pl.id, parseInt(e.target.value))}>
                            {pl.tiers?.map((t,i) => (
                              <option key={i} value={i}>{t.tier_name}</option>
                            ))}
                          </select>
                          <span className={`plat-bs ${bs ? 'has-val' : ''}`}>
                            {bs ? `₹${bs}` : '—'}
                          </span>
                        </div>
                      </td>
                    )
                  })}

                  {/* Status dot */}
                  <td className="ec-status">
                    {row.status === STATUS.SAVING && (
                      <span className="loader" style={{ width:10, height:10, borderWidth:1.5 }}/>
                    )}
                    {row.status === STATUS.SAVED  && <span className="dot-saved">✓</span>}
                    {row.status === STATUS.DIRTY  && <span className="dot-dirty">●</span>}
                    {row.status === STATUS.NEW    && <span className="dot-new">○</span>}
                    {row.status === STATUS.ERROR  && (
                      <span className="dot-error" title={row.errorMsg}>✗</span>
                    )}
                  </td>

                  {/* Delete */}
                  <td className="ec-del">
                    <button onClick={() => delRow(row.id)} className="del-btn">×</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="e-addrow" onClick={addRow}>+ Add row</div>

      {/* ── Mobile cards ── */}
      <div className="e-mobile">
        {rows.map(row => {
          const c = compute(row, miscDef, profDef, platforms)
          return (
            <MobileCard key={row.id} row={row} calc={c}
              vendorOpts={vendorOpts} catOpts={catOpts}
              miscDef={miscDef} profDef={profDef}
              activePlats={activePlats} platforms={platforms}
              onUpd={upd} onDel={delRow} onTier={handleTier}
              onNewVendor={name => { setPendingRowId(row.id); setVendorModal(name) }}
              onNewCat={name => { setPendingRowId(row.id); setCategoryModal(name) }}
            />
          )
        })}
        <button className="btn btn-gold"
          style={{ margin:'12px', width:'calc(100% - 24px)' }}
          onClick={addRow}>
          + Add Row
        </button>
      </div>

      {/* Modals */}
      {vendorModal && (
        <AddVendorModal name={vendorModal} onSave={handleVendorSaved}
          onClose={() => { setVendorModal(null); setPendingRowId(null) }} />
      )}
      {categoryModal && (
        <AddCategoryModal name={categoryModal} onSave={handleCatSaved}
          onClose={() => { setCategoryModal(null); setPendingRowId(null) }} />
      )}
    </div>
  )
}

// ─── Mobile card ──────────────────────────────────────────────────────────────
function MobileCard({ row, calc:c, vendorOpts, catOpts, miscDef, profDef,
  activePlats, platforms, onUpd, onDel, onTier, onNewVendor, onNewCat }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="m-card">
      <div className="m-card-hdr" onClick={() => setOpen(o => !o)}>
        <div>
          <div className="m-sku">{row.sku || 'New SKU'}</div>
          <div className="m-sub">
            {row.vendor || 'No vendor'} · {row.price ? `BE ₹${c.be}` : 'Enter price'}
          </div>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          {row.price && <span className="m-bs">₹{c.finalBS}</span>}
          <span className="m-arr">{open ? '▲' : '▼'}</span>
        </div>
      </div>
      {open && (
        <div className="m-body">
          <div className="m-section">SKU</div>
          <div className="m-grid">
            <div className="m-field"><label>Vendor</label>
              <SmartCell value={row.vendor} options={vendorOpts} placeholder="Vendor"
                onChange={v => onUpd(row.id,{vendor:v})}
                onSelect={opt => onUpd(row.id,{vendor:opt.label,vshort:opt.sublabel||''})}
                onAddNew={onNewVendor} addNewLabel="Add vendor"/>
            </div>
            <div className="m-field"><label>V.Short</label>
              <input className="m-input mono" value={row.vshort} placeholder="VRI"
                onChange={e => onUpd(row.id,{vshort:e.target.value.toUpperCase()})}/>
            </div>
            <div className="m-field"><label>Vendor SKU</label>
              <input className="m-input mono" value={row.vsku} placeholder="N6-WHITE"
                onChange={e => onUpd(row.id,{vsku:e.target.value})}/>
            </div>
            <div className="m-field"><label>Shringar SKU</label>
              <input className="m-input mono" value={row.sku} placeholder="SHJ-JS-VRI-N6"
                onChange={e => onUpd(row.id,{sku:e.target.value.toUpperCase()})}/>
            </div>
          </div>
          <div className="m-section">Unit Economics</div>
          <div className="m-grid">
            {[['Price','price'],['Package','pkg'],['Logistics','log'],
              ['Ad','ad'],['Addons','addons']].map(([l,f])=>(
              <div key={f} className="m-field"><label>{l}</label>
                <input className="m-input mono right" type="number" value={row[f]}
                  placeholder="0" onChange={e=>onUpd(row.id,{[f]:e.target.value})}/>
              </div>
            ))}
            <div className="m-field"><label>Misc ₹</label>
              <input className="m-input mono right" type="number" value={row.misc}
                placeholder={miscDef} onChange={e=>onUpd(row.id,{misc:e.target.value})}/>
            </div>
            <div className="m-field"><label>CR %</label>
              <input className="m-input mono right" type="number" value={row.crPct}
                placeholder={c.crPct} onChange={e=>onUpd(row.id,{crPct:e.target.value,crAmt:''})}/>
            </div>
            <div className="m-field"><label>CR ₹</label>
              <input className="m-input mono right" type="number" value={row.crAmt}
                placeholder={c.crAmt} onChange={e=>onUpd(row.id,{crAmt:e.target.value,crPct:''})}/>
            </div>
            <div className="m-field"><label>Dmg %</label>
              <input className="m-input mono right" type="number" value={row.dmgPct}
                placeholder={c.dmgPct} onChange={e=>onUpd(row.id,{dmgPct:e.target.value,dmgAmt:''})}/>
            </div>
            <div className="m-field"><label>Dmg ₹</label>
              <input className="m-input mono right" type="number" value={row.dmgAmt}
                placeholder={c.dmgAmt} onChange={e=>onUpd(row.id,{dmgAmt:e.target.value,dmgPct:''})}/>
            </div>
          </div>
          <div className="m-section">Profitability</div>
          <div className="m-grid">
            <div className="m-field"><label>Breakeven</label>
              <input className="m-input mono right" readOnly
                value={row.price?`₹${c.be}`:''} placeholder="—"/>
            </div>
            <div className="m-field"><label>Profit %</label>
              <input className="m-input mono right" type="number" value={row.profPct}
                placeholder={c.profPct} onChange={e=>onUpd(row.id,{profPct:e.target.value,profAmt:''})}/>
            </div>
            <div className="m-field"><label>Profit ₹</label>
              <input className="m-input mono right" type="number" value={row.profAmt}
                placeholder={c.profAmt} onChange={e=>onUpd(row.id,{profAmt:e.target.value,profPct:''})}/>
            </div>
            <div className="m-field"><label>BS w/o GST</label>
              <input className="m-input mono right" readOnly
                value={row.price?`₹${c.bsNoGst}`:''} placeholder="—"/>
            </div>
            <div className="m-field"><label>GST ₹</label>
              <input className="m-input mono right" type="number" value={row.gst}
                placeholder="0" onChange={e=>onUpd(row.id,{gst:e.target.value})}/>
            </div>
            <div className="m-field">
              <label style={{color:'var(--gold)'}}>Final BS</label>
              <input className="m-input mono right" readOnly
                value={row.price?`₹${c.finalBS}`:''} placeholder="—"
                style={{color:'var(--gold)',fontWeight:600}}/>
            </div>
          </div>
          {activePlats.length > 0 && <>
            <div className="m-section">Platform Settlements</div>
            <div className="m-plat-grid">
              {activePlats.map(pl => {
                const {bs,tierIdx} = platBS(row,pl,miscDef,profDef,platforms)
                return (
                  <div key={pl.id} className="m-plat-card">
                    <div className="m-plat-name">{pl.name}</div>
                    <select className="m-plat-tier" value={tierIdx}
                      onChange={e=>onTier(row.id,pl.id,parseInt(e.target.value))}>
                      {pl.tiers?.map((t,i)=>(
                        <option key={i} value={i}>{t.tier_name}</option>
                      ))}
                    </select>
                    <div className={`m-plat-bs ${bs?'has':''}`}>
                      {bs?`₹${bs}`:'—'}
                    </div>
                  </div>
                )
              })}
            </div>
          </>}
          <button className="btn btn-danger btn-sm" style={{marginTop:12}}
            onClick={()=>onDel(row.id)}>Delete Row</button>
        </div>
      )}
    </div>
  )
}