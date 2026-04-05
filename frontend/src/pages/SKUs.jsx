import { useState, useEffect, useCallback, useRef } from 'react'
import * as XLSX from 'xlsx'
import {
  getVendors, getCategories, getPlatforms,
  getMiscTotal, getSettings,
  getEntries, upsertBatch, deleteSku,
  updateCategory, deleteCategory
} from '../api/client'
import SmartCell from '../components/SmartCell'
import AddVendorModal from '../components/AddVendorModal'
import AddCategoryModal from '../components/AddCategoryModal'
import ManageCategoriesModal from '../components/ManageCategoriesModal'
import './SKUs.css'

// ─── Row status constants ─────────────────────────────────────────────────────
const STATUS = {
  NEW:    'new',
  DIRTY:  'dirty',
  SAVING: 'saving',
  SAVED:  'saved',
  ERROR:  'error',
}

// ─── GST options ──────────────────────────────────────────────────────────────
const GST_OPTIONS = [
  { value: '0',        label: '0%'      },
  { value: '3',        label: '3%'      },
  { value: '5',        label: '5%'      },
  { value: '18',       label: '18%'     },
  { value: '40',       label: '40%'     },
  { value: 'apparel',  label: 'Apparel' },
  { value: 'footwear', label: 'Footwear'},
]

function resolveGst(gstType, price) {
  const p = parseFloat(price) || 0
  if (gstType === 'apparel' || gstType === 'footwear') {
    return p <= 2500 ? 5 : 18
  }
  return parseFloat(gstType) || 0
}

// ─── Column groups ────────────────────────────────────────────────────────────
// Note: 'ad' removed from costBreakdown — AD is now per-platform
const COL_GROUPS = {
  skuDetails:    { label: 'SKU Details',    cols: ['vshort','vsku','category'] },
  costBreakdown: { label: 'Cost Breakdown', cols: ['pkg','log','addons','misc'] },
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
    id:           ++_id,
    skuId:        data.skuId        || null,
    status:       data.status       || STATUS.NEW,
    errorMsg:     data.errorMsg     || '',
    vendor:       data.vendor       || '',
    vendorId:     data.vendorId     || null,
    vshort:       data.vshort       || '',
    vsku:         data.vsku         || '',
    sku:          data.sku          || '',
    category:     data.category     || '',
    categoryId:   data.categoryId   || null,
    price:        data.price        || '',
    pkg:          data.pkg          || '',
    log:          data.log          || '',
    addons:       data.addons       || '',
    misc:         data.misc         || '',
    crPct:        data.crPct        || '',
    crAmt:        data.crAmt        || '',
    dmgPct:       data.dmgPct       || '',
    dmgAmt:       data.dmgAmt       || '',
    profPct:      data.profPct      || '',
    profAmt:      data.profAmt      || '',
    gstType:      data.gstType      || '5',
    gst:          data.gst          || '5',
    tiers:        data.tiers        || {},
    // Per-platform AD overrides: { [platformId]: { adPct: '', adAmt: '' } }
    // '' = inherit from platform.default_ad_pct
    platOverrides: data.platOverrides || {},
  }
}

// Convert backend row → frontend row
function backendRowToFrontend(r) {
  // Rebuild platOverrides from platform_configs returned by the API
  const platOverrides = {}
  if (r.platform_configs) {
    r.platform_configs.forEach(cfg => {
      platOverrides[cfg.platform_id] = {
        adPct: cfg.ad_pct  != null ? String(cfg.ad_pct)  : '',
        adAmt: '',  // always blank on load; computed on render
      }
    })
  }

  return newRow({
    skuId:      r.id,
    status:     STATUS.SAVED,
    vendor:     r.vendor_name   || '',
    vendorId:   r.vendor_id     || null,
    vshort:     r.vendor_short  || '',
    vsku:       r.vendor_sku    || '',
    sku:        r.shringar_sku  || '',
    category:   r.category_name || '',
    categoryId: r.category_id   || null,
    price:      r.price             != null ? String(r.price)             : '',
    pkg:        r.package           != null ? String(r.package)           : '',
    log:        r.logistics         != null ? String(r.logistics)         : '',
    addons:     r.addons            != null ? String(r.addons)            : '',
    misc:       r.misc_total        != null ? String(r.misc_total)        : '',
    crPct:      r.cr_percentage     != null ? String(r.cr_percentage)     : '',
    crAmt:      r.cr_cost           != null ? String(r.cr_cost)           : '',
    dmgPct:     r.damage_percentage != null ? String(r.damage_percentage) : '',
    dmgAmt:     r.damage_cost       != null ? String(r.damage_cost)       : '',
    profPct:    r.profit_percentage != null ? String(r.profit_percentage) : '',
    gstType:    '5',
    gst:        r.gst               != null ? String(r.gst)              : '5',
    platOverrides,
  })
}

// ─── Base compute (no AD — AD is per-platform) ────────────────────────────────
function compute(row, miscDef, profDef, platforms) {
  const p      = parseFloat(row.price)  || 0
  const pkg    = parseFloat(row.pkg)    || 0
  const log    = parseFloat(row.log)    || 0
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

  // Breakeven excludes AD (AD is per-platform now)
  const be = p + pkg + log + addons + misc + crAmt + dmgAmt

  let profPct, profAmt
  if (row.profAmt !== '') {
    profAmt = parseFloat(row.profAmt) || 0
    profPct = be > 0 ? (profAmt / be) * 100 : 0
  } else {
    profPct = row.profPct !== '' ? parseFloat(row.profPct) : profDef
    profAmt = be * profPct / 100
  }

  const bsNoGst = Math.round(be + profAmt)
  const gstRate = resolveGst(row.gstType || '5', row.price)
  const gstAmt  = Math.round(bsNoGst * gstRate / 100)
  const finalBS = bsNoGst + gstAmt

  return {
    crPct:   +crPct.toFixed(2),  crAmt:   +crAmt.toFixed(2),
    dmgPct:  +dmgPct.toFixed(2), dmgAmt:  +dmgAmt.toFixed(2),
    be:      +be.toFixed(2),
    profPct: +profPct.toFixed(2), profAmt: +profAmt.toFixed(2),
    bsNoGst, gstAmt, finalBS,
  }
}

// ─── Per-platform compute (uses platform-specific AD and CR) ─────────────────
function computePlatform(row, pl, base, miscDef) {
  if (!row.price) return { bs: null, adPct: 0, adAmt: 0, tierIdx: row.tiers[pl.id] ?? 0 }

  const price  = parseFloat(row.price)  || 0
  const pkg    = parseFloat(row.pkg)    || 0
  const log    = parseFloat(row.log)    || 0
  const addons = parseFloat(row.addons) || 0
  const misc   = row.misc !== '' ? parseFloat(row.misc) : miscDef

  // This platform's CR (uses its own cr_charge)
  const platCrAmt = pl.cr_charge * (base.crPct / 100)

  // Per-platform AD: override → platform default
  const override = row.platOverrides?.[pl.id] || {}
  let adPct, adAmt
  if (override.adAmt !== '' && override.adAmt !== undefined && override.adAmt !== null) {
    adAmt = parseFloat(override.adAmt) || 0
    adPct = price > 0 ? (adAmt / price) * 100 : 0
  } else if (override.adPct !== '' && override.adPct !== undefined) {
    adPct = parseFloat(override.adPct) || 0
    adAmt = price * adPct / 100
  } else {
    // Inherit platform default
    adPct = pl.default_ad_pct ?? 0
    adAmt = price * adPct / 100
  }

  const platBe = price + pkg + log + addons + misc + platCrAmt + base.dmgAmt + adAmt
  const profAmt = platBe * (base.profPct / 100)
  const bsNoGst = Math.round(platBe + profAmt)

  const gstRate = resolveGst(row.gstType || '5', row.price)
  const gstAmt  = Math.round(bsNoGst * gstRate / 100)

  const tierIdx = row.tiers[pl.id] ?? 0
  const tier    = pl.tiers?.[tierIdx]
  const bs      = bsNoGst + gstAmt + (tier?.fee || 0)

  return {
    adPct:   +adPct.toFixed(2),
    adAmt:   +adAmt.toFixed(2),
    platBe:  +platBe.toFixed(2),
    bs,
    tierIdx,
  }
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function SKUs() {
  const [vendors,     setVendors]     = useState([])
  const [categories,  setCategories]  = useState([])
  const [platforms,   setPlatforms]   = useState([])
  const [activePlats, setActivePlats] = useState([])
  const [miscDef,     setMiscDef]     = useState(12)
  const [profDef,     setProfDef]     = useState(20)
  const [rows,        setRows]        = useState(() => [newRow(), newRow(), newRow()])
  const [colVis,      setColVis]      = useState(loadVisibility)
  const [density,     setDensity]     = useState(() => localStorage.getItem('skuDensity') || 'normal')
  const [importOpen,      setImportOpen]      = useState(false)
  const [exportOpen,      setExportOpen]      = useState(false)
  const [manageCatOpen,   setManageCatOpen]   = useState(false)
  const [importRows,  setImportRows]  = useState([])
  const [showImportModal, setShowImportModal] = useState(false)
  const importRef  = useRef(null)
  const exportRef  = useRef(null)
  const fileInputRef = useRef(null)

  useEffect(() => {
    const handler = e => {
      if (importRef.current && !importRef.current.contains(e.target))
        setImportOpen(false)
      if (exportRef.current && !exportRef.current.contains(e.target))
        setExportOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])
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

  // ── Update row — marks dirty ───────────────────────────────────────────────
  const upd = useCallback((id, patch) =>
    setRows(prev => prev.map(r =>
      r.id === id ? { ...r, ...patch, status: STATUS.DIRTY } : r
    )), [])

  const addRow = () => setRows(p => [...p, newRow()])
  const delRow = async id => {
    const row = rows.find(r => r.id === id)
    if (row?.skuId) {
      try { await deleteSku(row.skuId) } catch(e) { console.error('Delete failed', e) }
    }
    setRows(p => p.filter(r => r.id !== id))
  }

  const handleTier = useCallback((rowId, plId, ti) =>
    setRows(prev => prev.map(r =>
      r.id === rowId ? { ...r, tiers: { ...r.tiers, [plId]: ti } } : r
    )), [])

  // ── Per-platform AD override handler ──────────────────────────────────────
  // field is 'adPct' or 'adAmt'; editing one clears the other (bidirectional)
  const handlePlatOverride = useCallback((rowId, plId, field, value) => {
    setRows(prev => prev.map(r => {
      if (r.id !== rowId) return r
      const prev0 = r.platOverrides[plId] || { adPct: '', adAmt: '' }
      const newOverride = field === 'adPct'
        ? { ...prev0, adPct: value, adAmt: '' }   // entering % clears ₹
        : { ...prev0, adAmt: value, adPct: '' }   // entering ₹ clears %
      return {
        ...r,
        status: STATUS.DIRTY,
        platOverrides: { ...r.platOverrides, [plId]: newOverride },
      }
    }))
  }, [])

  // ── Save logic ─────────────────────────────────────────────────────────────
  const saveRows = useCallback(async (rowsToSave) => {
    if (!rowsToSave.length) return
    setRows(prev => prev.map(r =>
      rowsToSave.find(s => s.id === r.id) ? { ...r, status: STATUS.SAVING } : r
    ))

    const payload = rowsToSave.map(row => {
      // Build platform_overrides — only send platforms with actual ad_pct overrides
      const platform_overrides = Object.entries(row.platOverrides)
        .filter(([, o]) => o.adPct !== '' || o.adAmt !== '')
        .map(([plId, o]) => {
          // Resolve the pct to send: if adAmt was entered, convert to pct
          let ad_pct = null
          if (o.adAmt !== '' && o.adAmt !== undefined) {
            const price = parseFloat(row.price) || 0
            const amt   = parseFloat(o.adAmt)   || 0
            ad_pct = price > 0 ? +(amt / price * 100).toFixed(4) : null
          } else if (o.adPct !== '' && o.adPct !== undefined) {
            ad_pct = parseFloat(o.adPct) ?? null
          }
          return { platform_id: parseInt(plId), ad_pct, profit_pct: null }
        })

      return {
        sku:               row.sku,
        vendor_sku:        row.vsku       || null,
        vendor_id:         row.vendorId   || null,
        category_id:       row.categoryId || null,
        price:             parseFloat(row.price),
        package:           parseFloat(row.pkg)    || 0,
        logistics:         parseFloat(row.log)    || 0,
        addons:            parseFloat(row.addons) || 0,
        misc_total:        row.misc   !== '' ? parseFloat(row.misc)   : null,
        cr_percentage:     row.crPct  !== '' ? parseFloat(row.crPct)  : null,
        cr_cost:           row.crAmt  !== '' ? parseFloat(row.crAmt)  : null,
        damage_percentage: row.dmgPct !== '' ? parseFloat(row.dmgPct) : null,
        damage_cost:       row.dmgAmt !== '' ? parseFloat(row.dmgAmt) : null,
        profit_percentage: row.profPct !== '' ? parseFloat(row.profPct) : null,
        gst:               resolveGst(row.gstType || '5', row.price),
        platform_overrides,
      }
    })

    try {
      const result = await upsertBatch(payload)
      const savedSkus = new Set(result.saved.map(r => r.shringar_sku))
      const errorMap  = {}
      result.errors.forEach(r => { errorMap[r.shringar_sku] = r.error })
      setRows(prev => prev.map(r => {
        const match = rowsToSave.find(s => s.id === r.id)
        if (!match) return r
        if (savedSkus.has(r.sku)) return { ...r, status: STATUS.SAVED, errorMsg: '' }
        if (errorMap[r.sku])      return { ...r, status: STATUS.ERROR, errorMsg: errorMap[r.sku] }
        return r
      }))
    } catch {
      setRows(prev => prev.map(r =>
        rowsToSave.find(s => s.id === r.id) ? { ...r, status: STATUS.DIRTY } : r
      ))
    }
  }, [])

  const saveAll = useCallback(() => {
    const dirty = rows.filter(r =>
      (r.status === STATUS.DIRTY || r.status === STATUS.NEW) && r.sku && r.price
    )
    saveRows(dirty)
  }, [rows, saveRows])

  // ── Debounce save: 2s after last change ────────────────────────────────────
  useEffect(() => {
    const timer = setTimeout(() => {
      const dirty = rows.filter(r =>
        (r.status === STATUS.DIRTY || r.status === STATUS.NEW) && r.sku && r.price
      )
      if (dirty.length > 0) saveRows(dirty)
    }, 2000)
    return () => clearTimeout(timer)
  }, [rows, saveRows])

  // ── Hard fallback: save every 30s ──────────────────────────────────────────
  useEffect(() => {
    const interval = setInterval(() => {
      setRows(current => {
        const dirty = current.filter(r =>
          (r.status === STATUS.DIRTY || r.status === STATUS.NEW) && r.sku && r.price
        )
        if (dirty.length > 0) saveRows(dirty)
        return current
      })
    }, 30000)
    return () => clearInterval(interval)
  }, [saveRows])

  // ── Warn on page close if unsaved ──────────────────────────────────────────
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

  const isSaving   = rows.some(r => r.status === STATUS.SAVING)
  const dirtyCount = rows.filter(r => r.status === STATUS.DIRTY && r.sku && r.price).length
  const allSaved   = rows.some(r => r.status === STATUS.SAVED) && dirtyCount === 0 && !isSaving

  if (loading) return (
    <div className="loader-page">
      <div className="loader" style={{ width:32, height:32 }}/>
    </div>
  )

  const setDens = d => { setDensity(d); localStorage.setItem('skuDensity', d) }

  const TMPL_HEADERS = [
    'Vendor','SKU Name','V.Short','Vendor SKU','Category',
    'Price ₹','Package ₹','Logistics ₹','Addons ₹','Misc ₹',
    'CR %','CR ₹','Damage %','Damage ₹','Profit %','Profit ₹','GST %'
  ]
  const TMPL_SAMPLE = ['Varni','FH','y','N6-WHITE','Jewellery Set',299,0,0,0,0,10,'',5,'',20,'',5]

  const downloadXLSX = () => {
    const ws = XLSX.utils.aoa_to_sheet([TMPL_HEADERS, TMPL_SAMPLE])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'SKU Template')
    XLSX.writeFile(wb, 'casper_sku_template.xlsx')
  }

  const downloadCSV = () => {
    const headers = TMPL_HEADERS.join(',')
    const sample  = TMPL_SAMPLE.join(',')
    const csv  = headers + '\n' + sample
    const blob = new Blob([csv], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = 'casper_sku_template.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleFileImport = e => {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const wb  = XLSX.read(ev.target.result, { type: 'array' })
      const ws  = wb.Sheets[wb.SheetNames[0]]
      const raw = XLSX.utils.sheet_to_json(ws, { defval: '' })
      // Skip sample row if vendor matches our template sample
      const rows = (raw[0]?.['Vendor'] === 'Varni' ? raw.slice(1) : raw)
        .filter(r => r['SKU Name'] || r['Vendor SKU'])
        .map(r => ({
          vendor:  String(r['Vendor']       || ''),
          sku:     String(r['SKU Name']     || ''),
          vshort:  String(r['V.Short']      || ''),
          vsku:    String(r['Vendor SKU']   || ''),
          category:String(r['Category']     || ''),
          price:   String(r['Price ₹']      || ''),
          pkg:     String(r['Package ₹']    || ''),
          log:     String(r['Logistics ₹']  || ''),
          addons:  String(r['Addons ₹']     || ''),
          misc:    String(r['Misc ₹']       || ''),
          crPct:   String(r['CR %']         || ''),
          crAmt:   String(r['CR ₹']         || ''),
          dmgPct:  String(r['Damage %']     || ''),
          dmgAmt:  String(r['Damage ₹']     || ''),
          profPct: String(r['Profit %']     || ''),
          profAmt: String(r['Profit ₹']     || ''),
          gst:     String(r['GST %']        || '5'),
        }))
      setImportRows(rows)
      setShowImportModal(true)
    }
    reader.readAsArrayBuffer(file)
    e.target.value = ''
  }

  const confirmImport = () => {
    setRows(prev => [...prev, ...importRows.map(r => newRow({ ...r, status: STATUS.DIRTY }))])
    setShowImportModal(false)
    setImportRows([])
  }

  const updImportRow = (i, field, val) =>
    setImportRows(prev => { const u = [...prev]; u[i] = { ...u[i], [field]: val }; return u })

  // ── Export helpers ─────────────────────────────────────────────────────────
  const buildExportData = () => {
    const platHeaders = activePlats.map(pl => `${pl.name} BS`)
    const headers = [
      'Vendor','SKU','V.Short','Vendor SKU','Category',
      'Price ₹','Package ₹','Logistics ₹','Addons ₹','Misc ₹',
      'CR %','CR ₹','Dmg %','Dmg ₹','Breakeven',
      'Profit %','Profit ₹','BS w/o GST','GST %','Final BS',
      ...platHeaders
    ]
    const data = rows.map(row => {
      const base = compute(row, miscDef, profDef, activePlats)
      const platBSes = activePlats.map(pl => {
        const res = computePlatform(row, pl, base, miscDef)
        return res.bs ?? ''
      })
      return [
        row.vendor, row.sku, row.vshort, row.vsku, row.category,
        row.price, row.pkg, row.log, row.addons, row.misc,
        base.crPct, base.crAmt, base.dmgPct, base.dmgAmt, base.be,
        base.profPct, base.profAmt, base.bsNoGst,
        resolveGst(row.gstType || '5', row.price),
        base.finalBS,
        ...platBSes
      ]
    })
    return { headers, data }
  }

  const exportXLSX = () => {
    const { headers, data } = buildExportData()
    const ws = XLSX.utils.aoa_to_sheet([headers, ...data])
    // Bold header row
    const range = XLSX.utils.decode_range(ws['!ref'])
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r: 0, c })]
      if (cell) cell.s = { font: { bold: true } }
    }
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'SKUs')
    XLSX.writeFile(wb, `casper_skus_${new Date().toISOString().slice(0,10)}.xlsx`)
  }

  const exportCSV = () => {
    const { headers, data } = buildExportData()
    const escape = v => (v === null || v === undefined) ? '' : String(v).includes(',') ? `"${v}"` : String(v)
    const csv = [headers, ...data].map(row => row.map(escape).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `casper_skus_${new Date().toISOString().slice(0,10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className={`entries-page density-${density}`}>

      {/* ── Header ── */}
      <div className="page-header">
        <div>
          <h1 className="page-title">SKUs</h1>
          <p className="page-subtitle">{rows.length} rows</p>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <span className="save-status">
            {isSaving && <span className="save-saving">⟳ Saving...</span>}
            {!isSaving && dirtyCount > 0 && (
              <span className="save-dirty">● {dirtyCount} unsaved</span>
            )}
            {allSaved && <span className="save-saved">✓ All saved</span>}
          </span>
          <div className="density-btn">
            {['compact','normal','spacious'].map(d => (
              <button key={d} className={`density-opt${density===d?' active':''}`}
                onClick={() => setDens(d)}>
                {d === 'compact' ? 'S' : d === 'normal' ? 'M' : 'L'}
              </button>
            ))}
          </div>
          <div className="import-dd" ref={importRef}>
            <button className="btn btn-ghost" onClick={() => setImportOpen(p => !p)}>
              ↓ Import ▾
            </button>
            {importOpen && (
              <div className="import-dd-menu">
                <button className="import-dd-item" onClick={() => { downloadXLSX(); setImportOpen(false) }}>📥 Download Template (.xlsx)</button>
                <button className="import-dd-item" onClick={() => { downloadCSV(); setImportOpen(false) }}>📥 Download Template (.csv)</button>
                <div className="import-dd-sep" />
                <button className="import-dd-item" onClick={() => { fileInputRef.current.click(); setImportOpen(false) }}>📂 Import from file...</button>
                <input ref={fileInputRef} type="file" accept=".xlsx,.csv" style={{display:'none'}} onChange={handleFileImport} />
              </div>
            )}
          </div>
          <div className="import-dd" ref={exportRef}>
            <button className="btn btn-ghost" onClick={() => setExportOpen(p => !p)}>
              ↑ Export ▾
            </button>
            {exportOpen && (
              <div className="import-dd-menu">
                <button className="import-dd-item" onClick={() => { exportXLSX(); setExportOpen(false) }}>📤 Export as .xlsx</button>
                <button className="import-dd-item" onClick={() => { exportCSV(); setExportOpen(false) }}>📤 Export as .csv</button>
              </div>
            )}
          </div>
          <button className="btn btn-accent" onClick={saveAll} disabled={isSaving || dirtyCount === 0}>
            {isSaving
              ? <><span className="loader" style={{ width:12, height:12, borderWidth:2 }}/> Saving</>
              : '💾 Save All'
            }
          </button>
          <button className="btn btn-primary" onClick={addRow}>+ Add Row</button>
        </div>
      </div>

      {/* ── Settings bar ── */}
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
              <div className="shine"/>
              <div className="inner"/>
              <span>{pl.name}</span>
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
            <div className="shine"/>
            <div className="inner"/>
            <span>{colVis[key] ? '✓' : '○'} {group.label}</span>
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
              {/* SKU group header */}
              <th className="gh gh-sku"
                colSpan={2 + (vis('vshort')?1:0) + (vis('vsku')?1:0) + (vis('category')?1:0)}>
                SKU
              </th>
              {/* Unit Economics group header (no AD column) */}
              <th className="gh gh-ue"
                colSpan={1+(vis('pkg')?1:0)+(vis('log')?1:0)+(vis('addons')?1:0)+(vis('misc')?1:0)+(vis('crpct')?1:0)+(vis('cramt')?1:0)+(vis('dmgpct')?1:0)+(vis('dmgamt')?1:0)}>
                Unit Economics
              </th>
              {/* Profitability group header */}
              <th className="gh gh-prof"
                colSpan={1+(vis('profpct')?1:0)+(vis('profamt')?1:0)+(vis('bsnogst')?1:0)}>
                Profitability
              </th>
              {vis('gst') && <th className="gh gh-tax">Tax</th>}
              <th className="gh gh-bs">Bank Settlement</th>
              {/* Platform columns — each shows AD input + tier + BS */}
              {activePlats.map(pl => (
                <th key={pl.id} className="gh gh-plat">
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:4 }}>
                    <span>{pl.name}</span>
                    <span style={{ fontSize:10, color:'var(--text-3)', fontWeight:400 }}>
                      AD {pl.default_ad_pct ?? 0}%
                    </span>
                    <button className="gh-x"
                      onClick={() => setActivePlats(p => p.filter(x => x.id !== pl.id))}>✕</button>
                  </div>
                </th>
              ))}
              <th className="gh" style={{ minWidth:28 }}/>
              <th className="gh" style={{ minWidth:28 }}/>
            </tr>

            {/* Sub-headers row */}
            <tr>
              <th className="sh sh-sku w-vendor sticky-col-hdr">Vendor</th>
              <th className="sh sh-sku w-sku sticky-col-hdr" style={{left:'var(--vendor-w,110px)'}}>SKU</th>
              {vis('vshort')   && <th className="sh sh-sku w-vshort">V.Short</th>}
              {vis('vsku')     && <th className="sh sh-sku w-vsku">Vendor SKU</th>}
              {vis('category') && <th className="sh sh-sku w-cat">Category</th>}
              <th className="sh sh-ue w-price">Price ₹</th>
              {vis('pkg')    && <th className="sh sh-ue w-pkg">Package</th>}
              {vis('log')    && <th className="sh sh-ue w-log">Logistics</th>}
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
              {vis('gst') && <th className="sh sh-tax w-gst">GST</th>}
              <th className="sh sh-bs w-finalbs">Final BS</th>
              {activePlats.map(pl => (
                <th key={pl.id} className="sh sh-plat w-plat-ad">
                  <span style={{ fontSize:10 }}>AD% / ₹ · Tier · BS</span>
                </th>
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
                  <td className="ec ec-smart w-vendor sh-sku sticky-col">
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

                  {/* SKU code */}
                  <td className="ec w-sku sh-sku sticky-col" style={{left:'var(--vendor-w,110px)'}}>
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
                        onManage={() => setManageCatOpen(true)}
                      />
                    </td>
                  )}

                  {/* Price */}
                  <td className="ec w-price sh-ue">
                    <input className="ec-input right mono" type="number" value={row.price}
                      placeholder="0"
                      onChange={e => {
                        const newPrice = e.target.value
                        const newGst = resolveGst(row.gstType || '5', newPrice)
                        upd(row.id, { price: newPrice, gst: String(newGst) })
                      }} />
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

                  {/* Breakeven (base, without AD) */}
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

                  {/* GST dropdown */}
                  {vis('gst') && (
                    <td className="ec w-gst sh-tax">
                      <select
                        className="ec-input gst-select"
                        value={row.gstType || '5'}
                        onChange={e => {
                          const newType = e.target.value
                          const newGst = resolveGst(newType, row.price)
                          upd(row.id, { gstType: newType, gst: String(newGst) })
                        }}>
                        {GST_OPTIONS.map(o => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </td>
                  )}

                  {/* Final BS (base, using first platform's default AD as reference) */}
                  <td className="ec ec-auto ec-gold w-finalbs sh-bs">
                    {row.price ? `₹${c.finalBS}` : '—'}
                  </td>

                  {/* Platform columns — AD ↔ ₹ inputs + tier + BS ── */}
                  {activePlats.map(pl => {
                    const plc     = computePlatform(row, pl, c, miscDef)
                    const override = row.platOverrides?.[pl.id] || {}
                    return (
                      <td key={pl.id} className="ec ec-plat w-plat-ad">
                        <div className="plat-cell-a">
                          {/* % input with inline label */}
                          <div className="plat-field">
                            <span className="plat-field-lbl">%</span>
                            <input
                              type="number"
                              className="plat-field-inp"
                              value={override.adPct ?? ''}
                              placeholder={pl.default_ad_pct ?? 0}
                              onChange={e => handlePlatOverride(row.id, pl.id, 'adPct', e.target.value)}
                            />
                          </div>
                          {/* ₹ input with inline label */}
                          <div className="plat-field">
                            <span className="plat-field-lbl">₹</span>
                            <input
                              type="number"
                              className="plat-field-inp"
                              value={override.adAmt ?? ''}
                              placeholder={plc.adAmt ?? 0}
                              onChange={e => handlePlatOverride(row.id, pl.id, 'adAmt', e.target.value)}
                            />
                          </div>
                          {/* Tier */}
                          <select className="plat-tier-s" value={plc.tierIdx}
                            onChange={e => handleTier(row.id, pl.id, parseInt(e.target.value))}>
                            {pl.tiers?.map((t, i) => (
                              <option key={i} value={i}>
                                {t.tier_name === 'None' ? '0' : t.tier_name}
                              </option>
                            ))}
                          </select>
                          {/* BS */}
                          <span className={`plat-bs-s ${plc.bs ? 'has-val' : ''}`}>
                            {plc.bs ? `₹${plc.bs}` : '—'}
                          </span>
                        </div>
                      </td>
                    )
                  })}

                  {/* Row status */}
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

                  {/* Delete row */}
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
              onPlatOverride={handlePlatOverride}
              onNewVendor={name => { setPendingRowId(row.id); setVendorModal(name) }}
              onNewCat={name => { setPendingRowId(row.id); setCategoryModal(name) }}
            />
          )
        })}
        <button className="btn btn-accent"
          style={{ margin:'12px', width:'calc(100% - 24px)' }}
          onClick={addRow}>
          + Add Row
        </button>
      </div>

      {/* Import Modal */}
      {showImportModal && (
        <div className="imp-backdrop">
          <div className="imp-modal">
            <div className="imp-hdr">
              <span>Import Preview — <strong>{importRows.length}</strong> rows</span>
              <div className="imp-hdr-btns">
                <button className="btn btn-ghost" onClick={() => setShowImportModal(false)}>Cancel</button>
                <button className="btn btn-accent" onClick={confirmImport}>✓ Import {importRows.length} rows</button>
              </div>
            </div>
            <div className="imp-body">
              <table className="imp-tbl">
                <thead><tr>
                  {['Vendor','SKU Name','V.Short','Vendor SKU','Category',
                    'Price ₹','Pkg ₹','Log ₹','Addons ₹','Misc ₹',
                    'CR %','CR ₹','Dmg %','Dmg ₹','Prof %','Prof ₹','GST %'].map(h =>
                    <th key={h}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {importRows.map((row, i) => (
                    <tr key={i}>
                      {['vendor','sku','vshort','vsku','category'].map(f => (
                        <td key={f}><input className="imp-inp" value={row[f]}
                          onChange={e => updImportRow(i, f, e.target.value)} /></td>
                      ))}
                      {['price','pkg','log','addons','misc'].map(f => (
                        <td key={f}><input className="imp-inp imp-num" type="number" value={row[f]}
                          onChange={e => updImportRow(i, f, e.target.value)} /></td>
                      ))}
                      <td><input className="imp-inp imp-num" type="number" value={row.crPct}
                        disabled={row.crAmt !== '' && row.crPct === ''}
                        onChange={e => { updImportRow(i,'crPct',e.target.value); updImportRow(i,'crAmt','') }} /></td>
                      <td><input className="imp-inp imp-num" type="number" value={row.crAmt}
                        disabled={row.crPct !== ''}
                        onChange={e => { updImportRow(i,'crAmt',e.target.value); updImportRow(i,'crPct','') }} /></td>
                      <td><input className="imp-inp imp-num" type="number" value={row.dmgPct}
                        disabled={row.dmgAmt !== '' && row.dmgPct === ''}
                        onChange={e => { updImportRow(i,'dmgPct',e.target.value); updImportRow(i,'dmgAmt','') }} /></td>
                      <td><input className="imp-inp imp-num" type="number" value={row.dmgAmt}
                        disabled={row.dmgPct !== ''}
                        onChange={e => { updImportRow(i,'dmgAmt',e.target.value); updImportRow(i,'dmgPct','') }} /></td>
                      <td><input className="imp-inp imp-num" type="number" value={row.profPct}
                        disabled={row.profAmt !== '' && row.profPct === ''}
                        onChange={e => { updImportRow(i,'profPct',e.target.value); updImportRow(i,'profAmt','') }} /></td>
                      <td><input className="imp-inp imp-num" type="number" value={row.profAmt}
                        disabled={row.profPct !== ''}
                        onChange={e => { updImportRow(i,'profAmt',e.target.value); updImportRow(i,'profPct','') }} /></td>
                      <td>
                        <select className="imp-inp" value={row.gst}
                          onChange={e => updImportRow(i,'gst',e.target.value)}>
                          {[0,5,12,18,28].map(g => <option key={g} value={g}>{g}%</option>)}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {manageCatOpen && (
        <ManageCategoriesModal
          categories={categories}
          rows={rows}
          onClose={() => setManageCatOpen(false)}
          onUpdate={async (id, name) => {
            await updateCategory(id, { name })
            setCategories(p => p.map(c => c.id === id ? { ...c, name } : c))
          }}
          onDelete={async id => {
            await deleteCategory(id)
            setCategories(p => p.filter(c => c.id !== id))
          }}
        />
      )}

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
  activePlats, platforms, onUpd, onDel, onTier, onPlatOverride, onNewVendor, onNewCat }) {
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
            <div className="m-field"><label>SKU</label>
              <input className="m-input mono" value={row.sku} placeholder="SHJ-JS-VRI-N6"
                onChange={e => onUpd(row.id,{sku:e.target.value.toUpperCase()})}/>
            </div>
          </div>
          <div className="m-section">Unit Economics</div>
          <div className="m-grid">
            {[['Price','price'],['Package','pkg'],['Logistics','log'],
              ['Addons','addons']].map(([l,f])=>(
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
              <input className="m-input mono right" readOnly value={row.price?`₹${c.be}`:''} placeholder="—"/>
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
              <input className="m-input mono right" readOnly value={row.price?`₹${c.bsNoGst}`:''} placeholder="—"/>
            </div>
            <div className="m-field"><label>GST Type</label>
              <select className="m-input" value={row.gstType || '5'}
                onChange={e => {
                  const newType = e.target.value
                  const newGst  = resolveGst(newType, row.price)
                  onUpd(row.id, { gstType: newType, gst: String(newGst) })
                }}>
                {GST_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div className="m-field">
              <label style={{color:'var(--accent)'}}>Final BS</label>
              <input className="m-input mono right" readOnly
                value={row.price?`₹${c.finalBS}`:''} placeholder="—"
                style={{color:'var(--accent)',fontWeight:600}}/>
            </div>
          </div>
          {activePlats.length > 0 && <>
            <div className="m-section">Platform Settlements</div>
            <div className="m-plat-grid">
              {activePlats.map(pl => {
                const plc = computePlatform(row, pl, c, miscDef)
                const override = row.platOverrides?.[pl.id] || {}
                return (
                  <div key={pl.id} className="m-plat-card">
                    <div className="m-plat-name">
                      {pl.name}
                      <span style={{ fontSize:10, color:'var(--text-3)', marginLeft:4 }}>
                        AD {pl.default_ad_pct ?? 0}%
                      </span>
                    </div>
                    {/* AD override inputs */}
                    <div className="m-plat-ad">
                      <input type="number" className="m-plat-tier" style={{ width:'45%' }}
                        value={override.adPct ?? ''} placeholder={`${pl.default_ad_pct ?? 0}%`}
                        onChange={e => onPlatOverride(row.id, pl.id, 'adPct', e.target.value)}/>
                      <input type="number" className="m-plat-tier" style={{ width:'45%' }}
                        value={override.adAmt ?? ''} placeholder={`₹${plc.adAmt}`}
                        onChange={e => onPlatOverride(row.id, pl.id, 'adAmt', e.target.value)}/>
                    </div>
                    <select className="m-plat-tier" value={plc.tierIdx}
                      onChange={e=>onTier(row.id,pl.id,parseInt(e.target.value))}>
                      {pl.tiers?.map((t,i)=>(
                        <option key={i} value={i}>{t.tier_name}</option>
                      ))}
                    </select>
                    <div className={`m-plat-bs ${plc.bs?'has':''}`}>
                      {plc.bs?`₹${plc.bs}`:'—'}
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
