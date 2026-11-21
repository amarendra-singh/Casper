import { moneyRound } from '../lib/money'
import { useState, useEffect, useCallback, useMemo, useRef, useId } from 'react'
import { Link } from 'react-router-dom'
// xlsx (~430 kB) is lazy-loaded inside the import/export handlers so it stays
// out of the initial SKUs bundle — only fetched when the user actually uses it.
import {
  getVendors, getCategories, getPlatforms,
  getMiscTotal, getSettings,
  getEntries, upsertBatch, deleteSku,
  updateCategory, deleteCategory, getUnmatchedSkus,
  createVendor, createCategory
} from '../api/client'
import { csvCell, rowFingerprint } from '../lib/format'
import { useCompany } from '../context/CompanyContext'
import SmartCell from '../components/SmartCell'
import AddVendorModal from '../components/AddVendorModal'
import AddCategoryModal from '../components/AddCategoryModal'
import ManageCategoriesModal from '../components/ManageCategoriesModal'
import BidirectionalPctAmount from '../components/BidirectionalPctAmount'
import AddTierQuickModal from '../components/AddTierQuickModal'
import UploadAdReportModal from '../components/UploadAdReportModal'
import ConfirmDialog from '../components/ConfirmDialog'
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
  { value: '',         label: 'Set GST' },
  { value: '0',        label: '0%'      },
  { value: '3',        label: '3%'      },
  { value: '5',        label: '5%'      },
  { value: '18',       label: '18%'     },
  { value: '40',       label: '40%'     },
  { value: 'apparel',  label: 'Apparel' },
  { value: 'footwear', label: 'Footwear'},
]

export function resolveGst(gstType, price) {
  const p = parseFloat(price) || 0
  if (gstType === 'apparel' || gstType === 'footwear') {
    return p <= 2500 ? 5 : 18
  }
  return parseFloat(gstType) || 0
}

// ─── Safe number → string (never scientific notation) ────────────────────────
function numStr(v) {
  if (v == null || v === '') {return ''}
  const n = parseFloat(v)
  if (isNaN(n)) {return ''}
  // toFixed(6) never produces sci notation; strip trailing zeros
  return n.toFixed(6).replace(/\.?0+$/, '') || '0'
}

/** Like numStr but capped at 2 decimals — for percentages and money values
 *  shown in narrow inputs. Avoids 9.163636-style stale precision. */
function numStr2(v) {
  if (v == null || v === '') {return ''}
  const n = parseFloat(v)
  if (isNaN(n)) {return ''}
  return n.toFixed(2).replace(/\.?0+$/, '') || '0'
}

// ─── Column groups ────────────────────────────────────────────────────────────
// Note: 'ad' removed from costBreakdown — AD is now per-platform
const COL_GROUPS = {
  skuDetails:    { label: 'SKU Details',    cols: ['series','vshort','vsku','category'] },
  costBreakdown: { label: 'Cost Breakdown', cols: ['pkg','log','addons','misc'] },
  calculations:  { label: 'Calculations',   cols: ['crpct','cramt','dmgpct','dmgamt','profpct','profamt','bsnogst','gst'] },
}
const DEFAULT_VISIBILITY = { skuDetails: true, costBreakdown: true, calculations: true }
// Inventory view is a catalog lens — only SKU details, no cost/calc columns.
const INVENTORY_VISIBILITY = { skuDetails: true, costBreakdown: false, calculations: false }
const LS_KEY = 'casper_col_visibility'
const LS_KEY_INV = 'casper_col_visibility_inv'

function loadVisibility(viewMode) {
  const key = viewMode === 'inventory' ? LS_KEY_INV : LS_KEY
  const defaults = viewMode === 'inventory' ? INVENTORY_VISIBILITY : DEFAULT_VISIBILITY
  try {
    const saved = localStorage.getItem(key)
    return saved ? JSON.parse(saved) : defaults
  } catch { return defaults }
}
function saveVisibility(v, viewMode) {
  const key = viewMode === 'inventory' ? LS_KEY_INV : LS_KEY
  localStorage.setItem(key, JSON.stringify(v))
}

// ─── Excel-style rectangular selection ────────────────────────────────────────
// The numeric cells that take part in range selection, in the SAME left-to-right
// order they render (cells carry the `selc` class). A hidden column drops out of
// both the DOM and this list, so a cell's column index stays aligned either way.
// `clear` is the paired field to blank when this one is set (% ↔ ₹ pairs).
const SELCOL_SPEC = [
  { field: 'price',   vis: null },
  { field: 'pkg',     vis: 'pkg' },
  { field: 'log',     vis: 'log' },
  { field: 'addons',  vis: 'addons' },
  { field: 'misc',    vis: 'misc' },
  { field: 'crPct',   vis: 'crpct',   clear: 'crAmt' },
  { field: 'crAmt',   vis: 'cramt',   clear: 'crPct' },
  { field: 'dmgPct',  vis: 'dmgpct',  clear: 'dmgAmt' },
  { field: 'dmgAmt',  vis: 'dmgamt',  clear: 'dmgPct' },
  { field: 'profPct', vis: 'profpct', clear: 'profAmt' },
  { field: 'profAmt', vis: 'profamt', clear: 'profPct' },
]
const selRect = sel => sel && ({
  r0: Math.min(sel.a.r, sel.f.r), r1: Math.max(sel.a.r, sel.f.r),
  c0: Math.min(sel.a.c, sel.f.c), c1: Math.max(sel.a.c, sel.f.c),
})

// ─── Row factory ──────────────────────────────────────────────────────────────
let _id = 0
function newRow(data = {}) {
  return {
    id:           ++_id,
    skuId:        data.skuId        || null,
    isActive:     data.isActive     ?? true,
    status:       data.status       || STATUS.NEW,
    errorMsg:     data.errorMsg     || '',
    vendor:       data.vendor       || '',
    vendorId:     data.vendorId     || null,
    companyId:    data.companyId    || null,
    companyName:  data.companyName  || '',
    companyColor: data.companyColor || '',
    vshort:       data.vshort       || '',
    hsnCodeId:    data.hsnCodeId || null,
    baseCrCharge: data.baseCrCharge,
    basePlatformId: data.basePlatformId,
    vsku:         data.vsku         || '',
    series:       data.series       || '',
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
    gstType:      data.gstType      ?? '',
    gst:          data.gst          ?? '',
    tiers:        data.tiers        || {},
    // Per-platform AD overrides: { [platformId]: { adPct: '', adAmt: '' } }
    // '' = inherit from platform.default_ad_pct
    platOverrides: data.platOverrides || {},
    // Per-platform SKU name aliases: { [platformId]: string }
    platAliases: data.platAliases || {},
  }
}

// Convert backend row → frontend row
function backendRowToFrontend(r, resolvedOnly = false) {
  resolvedOnly = resolvedOnly || r.base_reference_valid === false
  // Rebuild platOverrides and platAliases from platform_configs returned by the API
  const platOverrides = {}
  const platAliases   = {}
  if (r.platform_configs) {
    r.platform_configs.forEach(cfg => {
      platOverrides[cfg.platform_id] = {
        adPct: cfg.ad_pct  != null ? numStr2(cfg.ad_pct) : '',
        adAmt: '',  // always blank on load; computed on render
        reverseShippingCharge: cfg.reverse_shipping_charge != null ? numStr2(cfg.reverse_shipping_charge) : '',
      }
      if (cfg.platform_sku_name) {platAliases[cfg.platform_id] = cfg.platform_sku_name}
    })
  }

  return newRow({
    skuId:      r.id,
    isActive:   r.is_active ?? true,
    hsnCodeId:  r.hsn_code_id,
    baseCrCharge: r.base_cr_charge,
    basePlatformId: r.base_platform_id,
    status:     STATUS.SAVED,
    // Owning company — only sent when the scope spans several companies, and used
    // to mark the row so you can see whose record you are editing.
    companyId:    r.company_id    || null,
    companyName:  r.company_name  || '',
    companyColor: r.company_color || '',
    vendor:     r.vendor_name   || '',
    vendorId:   r.vendor_id     || null,
    vshort:     r.vendor_short  || '',
    vsku:       r.vendor_sku    || '',
    series:     r.series        || '',
    sku:        r.shringar_sku  || '',
    category:   r.category_name || '',
    categoryId: r.category_id   || null,
    price:      numStr(r.price),
    pkg:        numStr(r.package),
    log:        numStr(r.logistics),
    addons:     numStr(r.addons),
    misc:       numStr(resolvedOnly ? r.misc_total : r.misc_total_override),
    crPct:      numStr2(r.cr_percentage),
    crAmt:      numStr2(resolvedOnly ? r.cr_cost : r.cr_cost_override),
    dmgPct:     numStr2(r.damage_percentage),
    dmgAmt:     numStr2(resolvedOnly ? r.damage_cost : r.damage_cost_override),
    profPct:    numStr2(r.profit_percentage),
    // gstType is what save() recomputes `gst` from, so it MUST round-trip the
    // stored rate. Hardcoding '5' here silently reset every edited row to 5%.
    gstType:    r.gst_rate != null ? numStr(r.gst_rate) : (r.gst != null ? numStr(r.gst) : ''),
    gst:        r.gst_rate != null ? numStr(r.gst_rate) : (r.gst != null ? numStr(r.gst) : ''),
    platOverrides,
    platAliases,
  })
}

// ─── Base compute (no AD — AD is per-platform) ────────────────────────────────
export function compute(row, miscDef, profDef, platforms, damageDef = 15) {
  if (row.companyId) {platforms = platforms.filter(p => !p.company_id || p.company_id === row.companyId)}
  const p      = parseFloat(row.price)  || 0
  const pkg    = parseFloat(row.pkg)    || 0
  const log    = parseFloat(row.log)    || 0
  const addons = parseFloat(row.addons) || 0
  const misc   = row.misc !== '' ? parseFloat(row.misc) : miscDef
  const basePlatformId = row.basePlatformId ?? platforms[0]?.id
  const baseShippingOverride = row.platOverrides?.[basePlatformId]?.reverseShippingCharge
  const crCharge = baseShippingOverride !== '' && baseShippingOverride != null
    ? Number(baseShippingOverride) : (row.baseCrCharge ?? platforms[0]?.cr_charge ?? 0)

  let crPct, crAmt
  if (row.crAmt !== '') {
    crAmt = parseFloat(row.crAmt) || 0
    crPct = crCharge > 0 ? (crAmt / crCharge) * 100 : 0
  } else {
    crPct = row.crPct !== '' ? parseFloat(row.crPct) : (platforms[0]?.cr_percentage ?? 20)
    crAmt = moneyRound(crCharge * crPct / 100)
  }

  let dmgPct, dmgAmt
  if (row.dmgAmt !== '') {
    dmgAmt = parseFloat(row.dmgAmt) || 0
    dmgPct = p > 0 ? (dmgAmt / p) * 100 : 0
  } else {
    dmgPct = row.dmgPct !== '' ? parseFloat(row.dmgPct) : damageDef
    dmgAmt = moneyRound(p * dmgPct / 100)
  }

  // Breakeven excludes AD (AD is per-platform now)
  const be = moneyRound(p + pkg + log + addons + misc + crAmt + dmgAmt)

  // GST resolved early so we can derive the with-GST companion values
  const gstRate = resolveGst(row.gstType, row.price)
  const beGst   = be * (1 + gstRate / 100)

  let profPct, profAmt
  if (row.profAmt !== '') {
    profAmt = parseFloat(row.profAmt) || 0
    profPct = be > 0 ? (profAmt / be) * 100 : 0
  } else {
    profPct = row.profPct !== '' ? parseFloat(row.profPct) : profDef
    profAmt = moneyRound(be * profPct / 100)
  }
  const profAmtGst = beGst * profPct / 100

  // Target Pre-GST is rounded to a whole rupee (logic.md §3 worked example);
  // GST is then computed on that integer base.
  const bsNoGst = moneyRound(be + moneyRound(profAmt), 0)
  const gstAmt  = moneyRound(bsNoGst * gstRate / 100)
  const finalBS = moneyRound(bsNoGst + gstAmt)

  return {
    crPct:   +crPct.toFixed(2),  crAmt:   +crAmt.toFixed(2),
    dmgPct:  +dmgPct.toFixed(2), dmgAmt:  +dmgAmt.toFixed(2),
    be:      +be.toFixed(2),     beGst:   +beGst.toFixed(2),
    profPct: +profPct.toFixed(2), profAmt: +profAmt.toFixed(2),
    profAmtGst: +profAmtGst.toFixed(2),
    bsNoGst, gstAmt, finalBS,
  }
}

// ─── Per-platform compute (uses platform-specific AD and CR) ─────────────────
export function computePlatform(row, pl, base, miscDef) {
  if (!row.price || (row.companyId && pl.company_id && row.companyId !== pl.company_id)) {return { bs: null, adPct: 0, adAmt: 0, tierIdx: row.tiers[pl.id] ?? 0 }}

  const price  = parseFloat(row.price)  || 0
  const pkg    = parseFloat(row.pkg)    || 0
  const log    = parseFloat(row.log)    || 0
  const addons = parseFloat(row.addons) || 0
  const misc   = row.misc !== '' ? parseFloat(row.misc) : miscDef

  // Per-platform AD: override → platform default
  const override = row.platOverrides?.[pl.id] || {}
  const reverseShippingCharge = override.reverseShippingCharge !== '' && override.reverseShippingCharge != null
    ? Number(override.reverseShippingCharge) : pl.cr_charge
  const platCrAmt = reverseShippingCharge * (base.crPct / 100)
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
  const bsNoGst = +((platBe + profAmt).toFixed(2))

  const gstRate = resolveGst(row.gstType, row.price)
  const gstAmt  = moneyRound(bsNoGst * gstRate / 100)

  const tierIdx = row.tiers[pl.id] ?? 0
  const tier    = pl.tiers?.[tierIdx]
  // Phase 5: dual-mode tier fee — % takes precedence over ₹ when set.
  // Anchor for % mode = baseAfterGst (bsNoGst + gstAmt).
  const baseAfterGst = bsNoGst + gstAmt
  const tierAmt = tier?.fee_pct != null
    ? baseAfterGst * tier.fee_pct / 100
    : (tier?.fee || 0)
  const bs      = +((baseAfterGst + tierAmt).toFixed(2))

  return {
    adPct:   +adPct.toFixed(2),
    adAmt:   +adAmt.toFixed(2),
    platBe:  +platBe.toFixed(2),
    bs,
    tierIdx,
  }
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function SKUs({ viewMode = 'ue', pageTitle = 'SKUs' }) {
  const fieldId0 = useId()
  // upsert-batch writes to exactly one company (see api docstring), but rows in
  // this grid can come from several companies once All Companies is selected —
  // so autosave has no single target and must not fire silently.
  const { isAll, role } = useCompany()
  const readOnly = isAll || role === "viewer"
  const [actionError, setActionError] = useState("")
  const [vendors,     setVendors]     = useState([])
  const [categories,  setCategories]  = useState([])
  const [platforms,   setPlatforms]   = useState([])
  const [activePlats, setActivePlats] = useState([])
  const [miscDef,     setMiscDef]     = useState(0)
  const [miscSource, setMiscSource] = useState(0)
  const [damageDef, setDamageDef] = useState(15)
  const [profDef,     setProfDef]     = useState(20)
  const [rows,        setRows]        = useState(() => [newRow(), newRow(), newRow()])
  const [unmatched,   setUnmatched]   = useState([])
  const [showHidden,  setShowHidden]  = useState(false)
  // Ordering + company filter. Default SKU-asc; id-desc order looked arbitrary.
  const [sortKey,   setSortKey]   = useState('sku')
  const [sortDir,   setSortDir]   = useState('asc')
  const [coFilter,  setCoFilter]  = useState(null)   // company_id, or null = all
  // Snapshot of the last bulk edit so it can be reversed in one click.
  const [lastBulk,  setLastBulk]  = useState(null)   // snapshot for undoing a bulk fill
  const [pendingBulk, setPendingBulk] = useState(null)   // category awaiting confirmation
  const [colVis,      setColVis]      = useState(() => loadVisibility(viewMode))
  const [density,     setDensity]     = useState(() => localStorage.getItem('skuDensity') || 'normal')
  const [importOpen,      setImportOpen]      = useState(false)
  const [exportOpen,      setExportOpen]      = useState(false)
  const [manageCatOpen,   setManageCatOpen]   = useState(false)
  const [importRows,  setImportRows]  = useState([])
  const [showImportModal, setShowImportModal] = useState(false)
  const [importing,   setImporting]   = useState(false)
  // Excel-style rectangular selection: {a:anchor, f:focus} in {r,c} grid coords.
  const [sel,       setSel]       = useState(null)
  // Excel's two modes: a cell is SELECTED (the grid owns the keyboard) until you
  // enter EDIT mode. Without this the focused <input> swallows every arrow key —
  // and on type=number, Up/Down silently change the value instead of navigating.
  const [editing,   setEditing]   = useState(null)   // {r,c} while editing a cell
  const [bulkValue, setBulkValue] = useState('')
  const dragRef     = useRef(null)
  const clipRef     = useRef(null)   // 2D array copied from a selection
  const orderRef    = useRef([])     // row ids in render order — maps r -> row.id
  // Offscreen textarea that holds focus while a cell is selected. Browsers fire
  // copy/paste/cut ONLY when focus sits in an editable element — with focus on
  // <body> those events never fire at all, so the grid could never see Ctrl+C/V.
  const clipBoxRef  = useRef(null)
  const importRef  = useRef(null)
  const exportRef  = useRef(null)
  const fileInputRef = useRef(null)

  useEffect(() => {
    const handler = e => {
      if (importRef.current && !importRef.current.contains(e.target))
        {setImportOpen(false)}
      if (exportRef.current && !exportRef.current.contains(e.target))
        {setExportOpen(false)}
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])
  const [vendorModal,   setVendorModal]   = useState(null)
  const [categoryModal, setCategoryModal] = useState(null)
  // Phase 5 — quick-add tier modal triggered from per-platform tier dropdown
  // shape: { platform, rowId } | null
  const [tierQuickAdd, setTierQuickAdd] = useState(null)
  // Phase 6 — ad-report upload modal scoped to a platform
  const [adReportPlat, setAdReportPlat] = useState(null)
  const [pendingRowId,  setPendingRowId]  = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const inFlight = useRef(new Set())

  // ── Load data on mount ─────────────────────────────────────────────────────
  useEffect(() => {
    Promise.all([
      getVendors(), getCategories(), getPlatforms(),
      isAll ? Promise.resolve({ total: 0 }) : getMiscTotal(), getSettings(), getEntries({ include_inactive: true })
    ]).then(([v, c, p, misc, settings, entries]) => {
      setVendors(v.filter(x => x.is_active))
      setCategories(c.filter(x => x.is_active))
      const ap = p.filter(x => x.is_active)
      setPlatforms(ap)
      setActivePlats(ap)
      setMiscDef(misc?.total ?? 0)
      setMiscSource(misc?.total ?? 0)
      setDamageDef(Number(settings.find(s => s.key === 'damage_percent')?.value ?? 15))
      if (entries.length > 0) {
        setRows(entries.map(r => backendRowToFrontend(r, isAll)))
      }
    }).catch(() => setLoadError('Could not load the catalog. Reload to retry.')).finally(() => setLoading(false))
  }, [isAll])

  // ── Update row — marks dirty ───────────────────────────────────────────────
  const upd = useCallback((id, patch) =>
    setRows(prev => prev.map(r =>
      r.id === id ? { ...r, ...patch, status: STATUS.DIRTY } : r
    )), [])

  // Companies present in the loaded rows, with their colour and count. Empty in
  // single-company mode (the backend omits company fields there), which is what
  // keeps the legend from taking space when it would say the same thing on every row.
  const companyLegend = (() => {
    const by = new Map()
    rows.forEach(r => {
      if (!r.companyId) {return}
      const e = by.get(r.companyId) || { id: r.companyId, name: r.companyName, color: r.companyColor, count: 0 }
      e.count += 1
      by.set(r.companyId, e)
    })
    return [...by.values()].sort((a, b) => b.count - a.count)
  })()

  // Rows currently shown that have no category. 71 of 72 SKUs arrived without one
  // (upload matching and hidden-SKU quick-add never asked), so filling them one at
  // a time is not realistic.
  const uncategorised = rows.filter(r =>
    (!coFilter || !r.companyId || r.companyId === coFilter) && !r.categoryId && r.sku)

  // Two steps: the select arms the confirmation, the dialog performs it. Keeps the
  // browser's own confirm box (and its "localhost:5173 says" chrome) out of the app.
  const askBulkCategory = (catId) => {
    const cat = categories.find(c => c.id === Number(catId))
    if (cat && uncategorised.length) {setPendingBulk(cat)}
  }

  const applyBulkCategory = (cat) => {
    setPendingBulk(null)
    if (!cat || !uncategorised.length) {return}
    const ids = new Set(uncategorised.map(r => r.id))

    // Snapshot exactly what is about to change, so the action is reversible. A bulk
    // edit across 71 rows is not something to make someone unpick by hand.
    const before = rows.filter(r => ids.has(r.id))
      .map(r => ({ id: r.id, category: r.category, categoryId: r.categoryId, status: r.status }))

    // Category defaults are deliberately NOT applied here — they would overwrite
    // prices and cost inputs across every affected row. This sets the category only.
    setRows(prev => prev.map(r => ids.has(r.id)
      ? { ...r, category: cat.name, categoryId: cat.id, bulkHold: true, status: STATUS.DIRTY }
      : r))
    setLastBulk({ count: ids.size, catName: cat.name, before })
  }

  const undoBulk = () => {
    if (!lastBulk) {return}
    const prevById = new Map(lastBulk.before.map(p => [p.id, p]))
    setRows(prev => prev.map(r => prevById.has(r.id) ? { ...r, ...prevById.get(r.id), bulkHold: false } : r))
    setLastBulk(null)
  }

  const addRow = () => { if (!readOnly) {setRows(p => [...p, newRow()])} }

  // Hidden SKUs: names seen in uploads that have no cost match yet.
  const loadUnmatched = useCallback(() => {
    getUnmatchedSkus().then(setUnmatched).catch(() => setUnmatched([]))
  }, [])
  useEffect(() => { loadUnmatched() }, [loadUnmatched])

  const addHiddenSku = (name) => {
    // Prepend a dirty row pre-filled with the upload name so future uploads match.
    setRows(p => [newRow({ sku: name, status: STATUS.DIRTY }), ...p])
    setUnmatched(p => p.filter(u => u.platform_sku_name !== name))
    setShowHidden(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const delRow = useCallback(async id => {
    if (readOnly) {return}
    const row = rows.find(r => r.id === id)
    if (row?.skuId) {
      if (inFlight.current.has(id)) {return}
      try { await deleteSku(row.skuId) } catch {
        setActionError('Delete failed. The row is still present. Please retry.')
        return
      }
    }
    setRows(p => p.filter(r => r.id !== id))
  }, [rows, readOnly])

  const handleTier = useCallback((rowId, plId, ti) =>
    setRows(prev => prev.map(r =>
      r.id === rowId ? { ...r, tiers: { ...r.tiers, [plId]: ti } } : r
    )), [])

  // ── Per-platform AD override handler ──────────────────────────────────────
  // AD fields are bidirectional; reverse shipping is an independent override.
  const handlePlatOverride = useCallback((rowId, plId, field, value) => {
    setRows(prev => prev.map(r => {
      if (r.id !== rowId) {return r}
      const prev0 = r.platOverrides[plId] || { adPct: '', adAmt: '' }
      const newOverride = field === 'adPct'
        ? { ...prev0, adPct: value, adAmt: '' }   // entering % clears ₹
        : { ...prev0, adAmt: value, adPct: '' } // entering ₹ clears %
      return {
        ...r,
        status: STATUS.DIRTY,
        platOverrides: { ...r.platOverrides, [plId]: newOverride },
      }
    }))
  }, [])

  // ── Platform alias handlers ────────────────────────────────────────────────

  const handleAlias = useCallback((rowId, plId, value) => {
    setRows(prev => prev.map(r =>
      r.id === rowId
        ? { ...r, status: STATUS.DIRTY, platAliases: { ...r.platAliases, [plId]: value } }
        : r
    ))
  }, [])

  // ── Save logic ─────────────────────────────────────────────────────────────
  const saveRows = useCallback(async (rowsToSave) => {
    rowsToSave = rowsToSave.filter(row => !inFlight.current.has(row.id))
    if (!rowsToSave.length) {return}
    if (readOnly) {
      // The server refuses this write (a batch has one company, 'all' has none to
      // pick), so failing fast here — with a message — beats a 400 that used to
      // get swallowed and silently re-queued by autosave every 2s forever.
      setRows(prev => prev.map(r =>
        rowsToSave.find(s => s.id === r.id)
          ? { ...r, status: STATUS.ERROR, errorMsg: 'Switch to one company to save — All Companies is view-only here.' }
          : r
      ))
      return
    }
    rowsToSave.forEach(row => inFlight.current.add(row.id))
    setRows(prev => prev.map(r =>
      rowsToSave.find(s => s.id === r.id) ? { ...r, status: STATUS.SAVING } : r
    ))

    const payload = rowsToSave.map(row => {
      const preview = compute(row, miscDef, profDef, platforms, damageDef)
      // Build platform_overrides — include AD, reverse shipping, and aliases.
      const overrideMap = {}
      // AD overrides
      Object.entries(row.platOverrides || {}).forEach(([plId, o]) => {
        let ad_pct = null
        if (o.adAmt !== '' && o.adAmt !== undefined) {
          const price = parseFloat(row.price) || 0
          const amt   = parseFloat(o.adAmt)   || 0
          ad_pct = price > 0 ? +(amt / price * 100).toFixed(4) : null
        } else if (o.adPct !== '' && o.adPct !== undefined) {
          ad_pct = parseFloat(o.adPct) ?? null
        }
        overrideMap[plId] = {
          platform_id: parseInt(plId), ad_pct, profit_pct: null,
          platform_sku_name: null,
        }
      })
      // Aliases — merge into overrideMap
      Object.entries(row.platAliases || {}).forEach(([plId, alias]) => {
        if (overrideMap[plId]) {
          overrideMap[plId].platform_sku_name = alias
        } else {
          overrideMap[plId] = { platform_id: parseInt(plId), ad_pct: null, profit_pct: null,
            platform_sku_name: alias }
        }
      })
      const platform_overrides = Object.values(overrideMap)

      return {
        sku_id:            row.skuId || null,
        hsn_code_id:        row.hsnCodeId || null,
        sku:               row.sku,
        vendor_sku:        row.vsku       || null,
        series:            row.series     || null,
        vendor_id:         row.vendorId   || null,
        category_id:       row.categoryId || null,
        price:             parseFloat(row.price),
        package:           parseFloat(row.pkg)    || 0,
        logistics:         parseFloat(row.log)    || 0,
        addons:            parseFloat(row.addons) || 0,
        misc_total:        row.misc !== '' ? parseFloat(row.misc) : (miscDef === miscSource ? null : miscDef),
        cr_percentage:     row.crPct  !== '' ? parseFloat(row.crPct)  : null,
        cr_cost:           row.crAmt  !== '' ? parseFloat(row.crAmt)  : null,
        damage_percentage: row.dmgPct !== '' ? parseFloat(row.dmgPct) : null,
        damage_cost:       row.dmgAmt !== '' ? parseFloat(row.dmgAmt) : null,
        profit_percentage: row.profAmt !== '' && preview.be > 0 ? Number(row.profAmt) / preview.be * 100 : (row.profPct !== '' ? Number(row.profPct) : profDef),
        gst:               row.gstType === '' ? null : resolveGst(row.gstType, row.price),
        platform_overrides,
      }
    })

    try {
      const result = await upsertBatch(payload)
      const savedSkus = new Map(result.saved.map(r => [r.shringar_sku, r.sku_id]))
      const errorMap  = {}
      result.errors.forEach(r => { errorMap[r.shringar_sku] = r.error })
      setRows(prev => prev.map(r => {
        const match = rowsToSave.find(s => s.id === r.id)
        if (!match) {return r}
        const current = rowFingerprint(r) === rowFingerprint(match)
        if (savedSkus.has(match.sku)) {return { ...r, skuId: savedSkus.get(match.sku), bulkHold: false,
          status: current ? STATUS.SAVED : STATUS.DIRTY, errorMsg: '' }}
        if (errorMap[match.sku]) {return { ...r, status: current ? STATUS.ERROR : STATUS.DIRTY, errorMsg: errorMap[match.sku] }}
        return r
      }))
    } catch {
      setRows(prev => prev.map(r => {
        const sent = rowsToSave.find(s => s.id === r.id)
        return sent ? { ...r, status: rowFingerprint(r) === rowFingerprint(sent) ? STATUS.ERROR : STATUS.DIRTY,
          errorMsg: 'Save failed. Use Save All to retry.' } : r
      }))
    } finally {
      rowsToSave.forEach(row => inFlight.current.delete(row.id))
    }
  }, [readOnly, miscDef, miscSource, profDef, platforms, damageDef])

  const saveAll = useCallback(() => {
    const dirty = rows.filter(r =>
      (r.status === STATUS.DIRTY || r.status === STATUS.NEW || r.status === STATUS.ERROR) && r.sku && r.price
    )
    saveRows(dirty)
    // Once saved, the in-memory snapshot no longer represents "not yet written",
    // so offering Undo would be misleading.
    setLastBulk(null)
  }, [rows, saveRows])

  // ── Debounce save: 2s after last change ────────────────────────────────────
  useEffect(() => {
    const timer = setTimeout(() => {
      const dirty = rows.filter(r =>
        !r.bulkHold && (r.status === STATUS.DIRTY || r.status === STATUS.NEW) && r.sku && r.price
      )
      if (dirty.length > 0) {saveRows(dirty)}
    }, 2000)
    return () => clearTimeout(timer)
  }, [rows, saveRows])

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
    setColVis(next); saveVisibility(next, viewMode)
  }
  const resetVisibility = () => {
    const defaults = viewMode === 'inventory' ? INVENTORY_VISIBILITY : DEFAULT_VISIBILITY
    setColVis(defaults); saveVisibility(defaults, viewMode)
  }
  const vis = useCallback((col) => {
    for (const [key, group] of Object.entries(COL_GROUPS)) {
      if (group.cols.includes(col)) {return colVis[key] !== false}
    }
    return true
  }, [colVis])

  // ── Excel-style rectangular selection ──────────────────────────────────────
  // Visible selectable columns, in render order. A cell's column index is its
  // position among the `.selc` cells in its row, so this list stays in step.
  const selCols = SELCOL_SPEC.filter(s => !s.vis || vis(s.vis))

  const cellFromEvent = e => {
    const td = e.target.closest?.('td.selc')
    if (!td) {return null}
    const tr = td.closest('tr[data-r]')
    if (!tr) {return null}
    const cells = [...tr.querySelectorAll('td.selc')]
    const c = cells.indexOf(td)
    if (c < 0) {return null}
    return { r: Number(tr.dataset.r), c }
  }

  /** Resolve a cell from viewport coords — works mid-drag, unlike mouseover,
   *  which the input swallows once it starts its own text-selection drag. */
  const cellFromPoint = (x, y) => {
    const td = document.elementFromPoint(x, y)?.closest?.('td.selc')
    if (!td) {return null}
    const tr = td.closest('tr[data-r]')
    if (!tr) {return null}
    const c = [...tr.querySelectorAll('td.selc')].indexOf(td)
    return c < 0 ? null : { r: Number(tr.dataset.r), c }
  }

  /** The input for a grid coordinate, used to focus a cell in edit mode. */
  const inputAt = (r, c) => {
    const tr = document.querySelector(`.e-tbl tbody tr[data-r="${r}"]`)
    const td = tr && [...tr.querySelectorAll('td.selc')][c]
    return td?.querySelector('input') || null
  }

  const onGridMouseDown = e => {
    const cell = cellFromEvent(e)
    if (!cell) { setSel(null); setEditing(null); return }
    // Already editing this exact cell? leave the caret alone.
    if (editing && editing.r === cell.r && editing.c === cell.c) {return}
    // Select, don't edit — preventDefault keeps the input from taking focus so
    // the grid keeps the keyboard (arrows navigate instead of nudging numbers).
    // Focus parks on the offscreen clip box so Ctrl+C/V/X still reach us.
    e.preventDefault()
    setEditing(null)
    clipBoxRef.current?.focus({ preventScroll: true })
    if (e.shiftKey && sel) { setSel({ a: sel.a, f: cell }); return }
    setSel({ a: cell, f: cell })
    dragRef.current = { anchor: cell, x: e.clientX, y: e.clientY, active: false }
  }

  /** Double-click opens the cell for editing, exactly like a spreadsheet. */
  const onGridDoubleClick = e => {
    const cell = cellFromEvent(e)
    if (cell) { setSel({ a: cell, f: cell }); setEditing(cell) }
  }

  // Focus (and select) the input whenever we enter edit mode.
  useEffect(() => {
    if (!editing) {return}
    const el = inputAt(editing.r, editing.c)
    if (el) { el.focus(); el.select?.() }
  }, [editing])

  useEffect(() => {
    const move = e => {
      const d = dragRef.current
      if (!d) {return}
      if (!d.active) {
        if (Math.abs(e.clientX - d.x) < 4 && Math.abs(e.clientY - d.y) < 4) {return}
        d.active = true
        // Hand the drag over to range-selection: drop the input's text caret
        // and its half-started selection so the browser stops fighting us.
        clipBoxRef.current?.focus({ preventScroll: true })
        window.getSelection()?.removeAllRanges()
        document.querySelector('.e-tbl tbody')?.classList.add('range-dragging')
      }
      const cell = cellFromPoint(e.clientX, e.clientY)
      if (cell) {setSel({ a: d.anchor, f: cell })}
      e.preventDefault()
    }
    const up = () => {
      dragRef.current = null
      document.querySelector('.e-tbl tbody')?.classList.remove('range-dragging')
    }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
    return () => {
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', up)
    }
  }, [])

  // Paint the selection straight onto the DOM. The cells live in several
  // components (incl. BidirectionalPctAmount), so class-by-render would mean
  // threading coords through all of them for no gain.
  useEffect(() => {
    const tbody = document.querySelector('.e-tbl tbody')
    if (!tbody) {return}
    tbody.querySelectorAll('td.cell-sel, td.cell-active')
      .forEach(td => td.classList.remove('cell-sel', 'cell-active'))
    const rect = selRect(sel)
    if (!rect) {return}
    for (let r = rect.r0; r <= rect.r1; r++) {
      const tr = tbody.querySelector(`tr[data-r="${r}"]`)
      if (!tr) {continue}
      const cells = [...tr.querySelectorAll('td.selc')]
      for (let c = rect.c0; c <= rect.c1; c++) {
        cells[c]?.classList.add('cell-sel')
      }
    }
    const anchorTr = tbody.querySelector(`tr[data-r="${sel.a.r}"]`)
    ;[...(anchorTr?.querySelectorAll('td.selc') || [])][sel.a.c]?.classList.add('cell-active')
  })

  const selCount = (() => {
    const rect = selRect(sel)
    return rect ? (rect.r1 - rect.r0 + 1) * (rect.c1 - rect.c0 + 1) : 0
  })()

  /** Write `value` into one grid coordinate, honouring % ↔ ₹ pairing. */
  const writeCell = (r, c, value, patchAcc) => {
    const id = orderRef.current[r]
    const col = selCols[c]
    if (id == null || !col) {return}
    const patch = { [col.field]: value }
    if (col.clear) {patch[col.clear] = ''}
    patchAcc.set(id, { ...(patchAcc.get(id) || {}), ...patch })
  }
  const commitPatches = patchAcc => {
    patchAcc.forEach((patch, id) => upd(id, patch))
  }

  const applyToSelection = value => {
    const rect = selRect(sel)
    if (!rect) {return}
    const acc = new Map()
    for (let r = rect.r0; r <= rect.r1; r++)
      {for (let c = rect.c0; c <= rect.c1; c++) {writeCell(r, c, value, acc)}}
    commitPatches(acc)
  }

  const fillDown = () => {
    const rect = selRect(sel)
    if (!rect || rect.r1 === rect.r0) {return}
    const acc = new Map()
    for (let c = rect.c0; c <= rect.c1; c++) {
      const topId = orderRef.current[rect.r0]
      const col = selCols[c]
      if (topId == null || !col) {continue}
      const srcRow = rows.find(x => x.id === topId)
      const v = srcRow?.[col.field] ?? ''
      for (let r = rect.r0 + 1; r <= rect.r1; r++) {writeCell(r, c, v, acc)}
    }
    commitPatches(acc)
  }

  /** Selection as TSV — the format spreadsheets exchange on the clipboard. */
  const selectionToTsv = () => {
    const rect = selRect(sel)
    if (!rect) {return ''}
    const out = []
    for (let r = rect.r0; r <= rect.r1; r++) {
      const line = []
      for (let c = rect.c0; c <= rect.c1; c++) {
        const id = orderRef.current[r]
        const col = selCols[c]
        line.push(String(rows.find(x => x.id === id)?.[col?.field] ?? ''))
      }
      out.push(line.join('\t'))
    }
    return out.join('\n')
  }
  const tsvToBlock = text => text.replace(/\r/g, '').replace(/\n+$/, '')
    .split('\n').map(l => l.split('\t'))

  const copySelection = () => {
    const tsv = selectionToTsv()
    if (!tsv) {return}
    clipRef.current = tsvToBlock(tsv)
    navigator.clipboard?.writeText(tsv).catch(() => {})
  }

  /** Write a TSV block into the grid, anchored at the selection's top-left. */
  const pasteBlock = block => {
    const rect = selRect(sel)
    if (!rect || !block?.length) {return}
    const acc = new Map()
    // One value fills the whole selection; a block tiles from the top-left —
    // exactly how a spreadsheet paste behaves.
    if (block.length === 1 && block[0].length === 1) {
      for (let r = rect.r0; r <= rect.r1; r++)
        {for (let c = rect.c0; c <= rect.c1; c++) {writeCell(r, c, block[0][0], acc)}}
    } else {
      block.forEach((line, dr) => line.forEach((v, dc) =>
        writeCell(rect.r0 + dr, rect.c0 + dc, v, acc)))
    }
    commitPatches(acc)
  }

  const pasteSelection = async () => {
    let block = clipRef.current
    try {
      const text = await navigator.clipboard?.readText()
      if (text) {block = tsvToBlock(text)}      // prefer the real clipboard (Excel)
    } catch { /* clipboard blocked — fall back to the last in-app copy */ }
    pasteBlock(block)
  }

  // Native clipboard events — this is what makes Ctrl+C / Ctrl+V interop with
  // Excel itself, rather than only with values copied inside the app.
  useEffect(() => {
    if (!sel) {return}
    // While a cell is being edited the real input owns the clipboard, so these
    // must stand aside. Otherwise the grid handles it — including a single cell.
    const onCopy = e => {
      if (editing) {return}
      const tsv = selectionToTsv()
      if (!tsv) {return}
      e.preventDefault()
      e.clipboardData.setData('text/plain', tsv)
      clipRef.current = tsvToBlock(tsv)
    }
    const onCut = e => {
      if (editing) {return}
      const tsv = selectionToTsv()
      if (!tsv) {return}
      e.preventDefault()
      e.clipboardData.setData('text/plain', tsv)
      clipRef.current = tsvToBlock(tsv)
      applyToSelection('')
    }
    const onPaste = e => {
      if (editing) {return}
      const text = e.clipboardData?.getData('text/plain')
      if (!text) {return}
      e.preventDefault()
      pasteBlock(tsvToBlock(text))
    }
    document.addEventListener('copy', onCopy)
    document.addEventListener('cut', onCut)
    document.addEventListener('paste', onPaste)
    return () => {
      document.removeEventListener('copy', onCopy)
      document.removeEventListener('cut', onCut)
      document.removeEventListener('paste', onPaste)
    }
  })

  // Keyboard engine. In EDIT mode the input keeps every key except Esc/Enter.
  // In SELECT mode the grid owns the keyboard: arrows navigate, Shift+arrow
  // extends, Ctrl+arrow jumps to the edge, and any printable key starts editing.
  // Ctrl+C / Ctrl+V live on the native copy/paste events so they talk to Excel.
  useEffect(() => {
    if (!sel) {return}
    const onKey = e => {
      const meta = e.ctrlKey || e.metaKey
      const maxR = orderRef.current.length - 1
      const maxC = selCols.length - 1

      if (editing) {
        if (e.key === 'Escape') {
          e.preventDefault(); setEditing(null)
          clipBoxRef.current?.focus({ preventScroll: true })
        } else if (e.key === 'Enter') {
          e.preventDefault(); setEditing(null)
          clipBoxRef.current?.focus({ preventScroll: true })
          const r = Math.min(maxR, sel.f.r + 1), c = sel.f.c
          setSel({ a: { r, c }, f: { r, c } })
        }
        return
      }

      const move = (dr, dc, extend) => {
        e.preventDefault()
        let { r, c } = sel.f
        if (meta) {                      // Ctrl+arrow → jump to the edge
          if (dr) {r = dr > 0 ? maxR : 0}
          if (dc) {c = dc > 0 ? maxC : 0}
        } else {
          r = Math.max(0, Math.min(maxR, r + dr))
          c = Math.max(0, Math.min(maxC, c + dc))
        }
        setSel(s => extend ? { a: s.a, f: { r, c } } : { a: { r, c }, f: { r, c } })
        requestAnimationFrame(() =>
          inputAt(r, c)?.closest('td')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }))
      }

      switch (e.key) {
        case 'ArrowUp':    return move(-1, 0, e.shiftKey)
        case 'ArrowDown':  return move( 1, 0, e.shiftKey)
        case 'ArrowLeft':  return move( 0,-1, e.shiftKey)
        case 'ArrowRight': return move( 0, 1, e.shiftKey)
        case 'Tab':        return move( 0, e.shiftKey ? -1 : 1, false)
        case 'Enter':
        case 'F2':         e.preventDefault(); setEditing(sel.f); return
        case 'Escape':     setSel(null); return
        case 'Delete':
        case 'Backspace':  e.preventDefault(); applyToSelection(''); return
        default: break
      }
      if (meta && e.key.toLowerCase() === 'd') { e.preventDefault(); fillDown(); return }
      // Copy / cut: stage the TSV in the focus holder and select it, so the
      // browser has something to copy. An empty textarea with no selection
      // fires no copy event at all — which is why Ctrl+C did nothing before.
      if (meta && (e.key.toLowerCase() === 'c' || e.key.toLowerCase() === 'x')) {
        const tsv = selectionToTsv()
        const box = clipBoxRef.current
        if (!tsv || !box) {return}
        box.value = tsv
        box.select()
        clipRef.current = tsvToBlock(tsv)
        const cutting = e.key.toLowerCase() === 'x'
        // Let the native copy/cut run first, then tidy up.
        setTimeout(() => { box.value = ''; if (cutting) {applyToSelection('')} }, 0)
        return
      }
      // Type-to-edit: a printable key replaces the cell and drops into edit mode.
      if (!meta && !e.altKey && e.key.length === 1) {
        e.preventDefault()
        const id = orderRef.current[sel.f.r]
        const col = selCols[sel.f.c]
        if (id != null && col) {
          upd(id, { [col.field]: e.key, ...(col.clear ? { [col.clear]: '' } : {}) })
          setEditing(sel.f)
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  // Inventory view is a catalog lens: hide per-platform (AD/tier/BS) columns.
  // viewPlats drives the table render; activePlats stays for exports (all plats).
  const showPlats = viewMode !== 'inventory'
  const viewPlats = useMemo(() => showPlats ? activePlats : [], [showPlats, activePlats])


  // Memoised so the row list can skip re-rendering when only the cell selection
  // moves — a fresh array every render would defeat that memo.
  const vendorOpts = useMemo(() => vendors.map(v => ({ label: v.name, sublabel: v.short_code })), [vendors])
  const catOpts    = useMemo(() => categories.map(c => ({ label: c.name })), [categories])
  const seriesOpts = useMemo(
    () => [...new Set(rows.map(r => r.series).filter(Boolean))].map(s => ({ label: s })), [rows])

  const handleVendorSaved = v => {
    setVendors(p => [...p, v])
    if (pendingRowId) {upd(pendingRowId, { vendor:v.name, vendorId:v.id, vshort:v.short_code })}
    setVendorModal(null); setPendingRowId(null)
  }
  const handleCatSaved = c => {
    setCategories(p => [...p, c])
    if (pendingRowId) {
      const row = rows.find(r => r.id === pendingRowId)
      const defaults = row ? applyCategoryDefaults(row, c) : {}
      upd(pendingRowId, { category:c.name, categoryId:c.id, ...defaults })
    }
    setCategoryModal(null); setPendingRowId(null)
  }

  /** Cascade category defaults onto a SKU row — only fills empty fields. */
  const applyCategoryDefaults = useCallback((row, cat) => {
    if (!cat) {return {}}
    const patch = {}
    if (cat.default_cr_pct != null && (row.crPct ?? '') === '' && (row.crAmt ?? '') === '') {
      patch.crPct = String(cat.default_cr_pct)
    }
    if (cat.default_damage_pct != null && (row.dmgPct ?? '') === '' && (row.dmgAmt ?? '') === '') {
      patch.dmgPct = String(cat.default_damage_pct)
    }
    if (cat.default_profit_pct != null && (row.profPct ?? '') === '' && (row.profAmt ?? '') === '') {
      patch.profPct = String(cat.default_profit_pct)
    }
    return patch
  }, [])

  const isSaving   = rows.some(r => r.status === STATUS.SAVING)
  const dirtyCount = rows.filter(r => r.status === STATUS.DIRTY && r.sku && r.price).length
  const awaitingPriceCount = rows.filter(r => r.skuId && !r.price).length
  const allSaved   = rows.some(r => r.status === STATUS.SAVED) && dirtyCount === 0 && !isSaving

  // Row list is memoised on the data that actually shapes it. Selection state
  // is deliberately excluded: the highlight is painted directly onto the DOM,
  // so moving the cursor must not re-render every row (measured at ~130ms per
  // keypress on a 95-row grid before this).
  const tbodyRows = useMemo(() => {
              // Order before grouping. Default is SKU name with numeric-aware
              // compare, so N5 · N8 · N9 · N10 reads naturally — the old id-desc
              // order looked arbitrary on screen.
              const cmp = (a, b) => {
                const dir = sortDir === 'asc' ? 1 : -1
                if (sortKey === 'sku')
                  {return dir * String(a.sku || '').localeCompare(String(b.sku || ''), undefined, { numeric: true })}
                if (sortKey === 'company')
                  {return dir * String(a.companyName || '').localeCompare(String(b.companyName || ''))}
                const n = k => parseFloat(a[k]) || 0, m = k => parseFloat(b[k]) || 0
                return dir * (n(sortKey) - m(sortKey))
              }
              const visibleRows = (coFilter
                ? rows.filter(r => !r.companyId || r.companyId === coFilter)
                : rows).slice().sort(cmp)

              // Group rows by series — ungrouped rows go under ''
              const groups = {}
              visibleRows.forEach(row => {
                const key = row.series || ''
                if (!groups[key]) {groups[key] = []}
                groups[key].push(row)
              })
              // Named series first (sorted), then ungrouped at end
              const keys = [
                ...Object.keys(groups).filter(k => k).sort((a,b) => a.toLowerCase().localeCompare(b.toLowerCase())),
                ...(groups[''] ? [''] : [])
              ]


              // Flat render order — `r` is the grid row coordinate used by the
              // rectangular selection, so it must match what the user sees.
              const orderedRows = keys.flatMap(k => groups[k])
              orderRef.current = orderedRows.map(x => x.id)

              return orderedRows.map((row, r) => {
                  const c = compute(row, miscDef, profDef, platforms, damageDef)
                  // Light divider where a new series starts — groups read at a
                  // glance without a heavy title row.
                  const seriesStart = row.series && row.series !== orderedRows[r - 1]?.series
                  return (
                <tr key={row.id} data-r={r}
                    className={`e-row ${row.status === STATUS.ERROR ? 'row-error' : ''}${row.companyColor ? ' co-rail' : ''}${seriesStart ? ' series-start' : ''}`}
                    // Owning-company mark: a coloured left rail. Costs no column
                    // width, and reads peripherally — one odd colour stands out.
                    style={row.companyColor ? { '--co-mark': row.companyColor } : undefined}
                    title={row.companyName ? `Company: ${row.companyName}` : undefined}>

                  {/* Vendor */}
                  <td className="ec ec-smart w-vendor sh-sku sticky-col">
                    <SmartCell readOnly={readOnly}
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
                  <td className="ec w-sku sh-sku sticky-col" style={{left:90}}>
                    <div className="ec-sizer-wrap">
                      <span className="ec-sizer mono">{row.sku || 'SHJ-JS-VRI-N6'}</span>
                      <input aria-label={`${row.sku || "New SKU"} SKU code`} className="ec-input mono" size={1} value={row.sku} placeholder="e.g. SKU-001"
                        onChange={e => upd(row.id, { sku:e.target.value.toUpperCase() })} />
                    </div>
                    {row.skuId && <Link className="ec-profile-link" to={`/product/catalogue/${row.skuId}`}
                      title={`Open product profile for ${row.sku}`}>Product profile ↗</Link>}
                    {row.skuId && !row.isActive && <span className="ec-inactive-label">Inactive</span>}
                    {/* Platform alias chips */}
                    {activePlats.some(pl => row.platAliases?.[pl.id]) && (
                      <div className="sku-alias-chips">
                        {activePlats.map(pl => {
                          const alias = row.platAliases?.[pl.id]
                          if (!alias) {return null}
                          return (
                            <span key={pl.id} className="sku-alias-chip" title={`${pl.name}: ${alias}`}>
                              <span className="sku-alias-chip-plat">{pl.name[0]}</span>
                              <span className="sku-alias-chip-val">{alias}</span>
                            </span>
                          )
                        })}
                      </div>
                    )}
                  </td>

                  {vis('series') && (
                    <td className="ec ec-smart w-series sh-sku">
                      <SmartCell readOnly={readOnly}
                        value={row.series} options={seriesOpts} placeholder="Series"
                        onChange={v => upd(row.id, { series: v })}
                        onSelect={opt => upd(row.id, { series: opt.label })}
                      />
                    </td>
                  )}
                  {vis('vshort') && (
                    <td className="ec w-vshort sh-sku">
                      <div className="ec-sizer-wrap">
                        <span className="ec-sizer mono">{row.vshort || 'VRI'}</span>
                        <input aria-label={`${row.sku || "New SKU"} vendor short code`} className="ec-input mono" size={1} value={row.vshort} placeholder="e.g. ABC"
                          onChange={e => upd(row.id, { vshort:e.target.value.toUpperCase() })} />
                      </div>
                    </td>
                  )}
                  {vis('vsku') && (
                    <td className="ec w-vsku sh-sku">
                      <div className="ec-sizer-wrap">
                        <span className="ec-sizer mono">{row.vsku || 'N6-WHITE'}</span>
                        <input aria-label={`${row.sku || "New SKU"} vendor SKU`} className="ec-input mono" size={1} value={row.vsku} placeholder="e.g. STYLE-01"
                          onChange={e => upd(row.id, { vsku:e.target.value })} />
                      </div>
                    </td>
                  )}
                  {vis('category') && (
                    <td className="ec ec-smart w-cat sh-sku">
                      <SmartCell readOnly={readOnly}
                        value={row.category} options={catOpts} placeholder="Category"
                        onChange={v => upd(row.id, { category:v, categoryId:null })}
                        onSelect={opt => {
                          const cat = categories.find(c=>c.name===opt.label)
                          const defaults = applyCategoryDefaults(row, cat)
                          upd(row.id, { category:opt.label, categoryId:cat?.id||null, ...defaults })
                        }}
                        onAddNew={name => { setPendingRowId(row.id); setCategoryModal(name) }}
                        addNewLabel="Add as new category"
                        onManage={() => setManageCatOpen(true)}
                      />
                    </td>
                  )}

                  {/* Price */}
                  <td className="ec w-price sh-ue selc">
                    <div className="ec-sizer-wrap">
                      <span className="ec-sizer mono">{row.price || '0'}</span>
                      <input aria-label={`${row.sku || "New SKU"} price in rupees`} className="ec-input right mono" type="number" size={1} value={row.price}
                        placeholder="—"
                        onChange={e => {
                          const newPrice = e.target.value
                          const newGst = row.gstType === '' ? '' : resolveGst(row.gstType, newPrice)
                          upd(row.id, { price: newPrice, gst: String(newGst) })
                        }} />
                    </div>
                  </td>

                  {vis('pkg') && (
                    <td className="ec w-pkg sh-ue selc">
                      <div className="ec-sizer-wrap">
                        <span className="ec-sizer mono">{row.pkg || '0'}</span>
                        <input aria-label={`${row.sku || "New SKU"} packaging in rupees`} className="ec-input right mono" type="number" size={1} value={row.pkg}
                          placeholder="0" onChange={e => upd(row.id, { pkg:e.target.value })} />
                      </div>
                    </td>
                  )}
                  {vis('log') && (
                    <td className="ec w-log sh-ue selc">
                      <div className="ec-sizer-wrap">
                        <span className="ec-sizer mono">{row.log || '0'}</span>
                        <input aria-label={`${row.sku || "New SKU"} logistics in rupees`} className="ec-input right mono" type="number" size={1} value={row.log}
                          placeholder="0" onChange={e => upd(row.id, { log:e.target.value })} />
                      </div>
                    </td>
                  )}
                  {vis('addons') && (
                    <td className="ec w-addons sh-ue selc">
                      <div className="ec-sizer-wrap">
                        <span className="ec-sizer mono">{row.addons || '0'}</span>
                        <input aria-label={`${row.sku || "New SKU"} addons in rupees`} className="ec-input right mono" type="number" size={1} value={row.addons}
                          placeholder="0" onChange={e => upd(row.id, { addons:e.target.value })} />
                      </div>
                    </td>
                  )}
                  {vis('misc') && (
                    <td className="ec w-misc sh-ue selc">
                      <div className="ec-sizer-wrap">
                        <span className="ec-sizer mono">{row.misc || String(miscDef)}</span>
                        <input aria-label={`${row.sku || "New SKU"} miscellaneous cost in rupees`} className="ec-input right mono" type="number" size={1} value={row.misc}
                          placeholder={miscDef} onChange={e => upd(row.id, { misc:e.target.value })} />
                      </div>
                    </td>
                  )}
                  {/* CR — bidirectional % ↔ ₹ pair (anchor: Platform.cr_charge) */}
                  <BidirectionalPctAmount
                    pctKey="crPct" amtKey="crAmt"
                    pctValue={row.crPct} amtValue={row.crAmt}
                    pctComputed={row.price ? numStr(c.crPct) : '—'} amtComputed={row.price ? numStr(c.crAmt) : '—'}
                    onUpd={changes => upd(row.id, changes)}
                    pctVisible={vis('crpct')} amtVisible={vis('cramt')}
                    pctClassName="w-crpct selc" amtClassName="w-cramt selc"
                    shadeClassName="sh-ue"
                  />
                  {/* Damage — bidirectional % ↔ ₹ pair (anchor: Price) */}
                  <BidirectionalPctAmount
                    pctKey="dmgPct" amtKey="dmgAmt"
                    pctValue={row.dmgPct} amtValue={row.dmgAmt}
                    pctComputed={row.price ? numStr(c.dmgPct) : '—'} amtComputed={row.price ? numStr(c.dmgAmt) : '—'}
                    onUpd={changes => upd(row.id, changes)}
                    pctVisible={vis('dmgpct')} amtVisible={vis('dmgamt')}
                    pctClassName="w-dmgpct selc" amtClassName="w-dmgamt selc"
                    shadeClassName="sh-ue"
                  />

                  {/* Breakeven (no GST, base — without AD) */}
                  <td className="ec ec-auto w-be sh-prof">
                    {row.price ? `₹${c.be}` : '—'}
                  </td>
                  {/* GST dropdown — placed between Breakeven and Breakeven (GST)
                      so user can change rate and see immediate impact on with-GST values. */}
                  {vis('gst') && (
                    <td className="ec w-gst sh-tax">
                      <select
                        className="ec-input gst-select"
                        aria-label="GST rate"
                        value={row.gstType}
                        disabled={!row.price}
                        title={!row.price ? 'Set GST in the Catalogue product details' : undefined}
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
                  {/* Breakeven (with GST) — derived */}
                  <td className="ec ec-auto w-be sh-prof">
                    {row.price ? `₹${c.beGst}` : '—'}
                  </td>
                  {/* Profit — bidirectional % ↔ ₹ pair (anchor: Breakeven no-GST) */}
                  <BidirectionalPctAmount
                    pctKey="profPct" amtKey="profAmt"
                    pctValue={row.profPct} amtValue={row.profAmt}
                    pctComputed={row.price ? numStr(c.profPct) : '—'} amtComputed={row.price ? numStr(c.profAmt) : '—'}
                    onUpd={changes => upd(row.id, changes)}
                    pctVisible={vis('profpct')} amtVisible={vis('profamt')}
                    pctClassName="w-profpct selc" amtClassName="w-profamt selc"
                    shadeClassName="sh-prof"
                  />
                  {vis('bsnogst') && (
                    <td className="ec ec-auto w-bsnogst sh-bs">
                      {row.price ? `₹${c.bsNoGst}` : '—'}
                    </td>
                  )}

                  {/* Target Post-GST (= Final BS) — derived */}
                  <td className="ec ec-auto ec-gold w-finalbs sh-bs">
                    {row.price ? `₹${c.finalBS}` : '—'}
                  </td>

                  {/* Platform columns — AD ↔ ₹ inputs + tier | BS (separate col) ── */}
                  {viewPlats.map(pl => {
                    const plc      = computePlatform(row, pl, c, miscDef)
                    const override = row.platOverrides?.[pl.id] || {}
                    const alias    = row.platAliases?.[pl.id] || ''
                    return ([
                      <td key={`${pl.id}-ad`} className="ec ec-plat w-plat-ad">
                        <div className="plat-cell-a">
                          {/* % input — placeholder shows back-computed % when ₹ is set */}
                          <div className="plat-field">
                            <span className="plat-field-lbl">%</span>
                            <input aria-label={`${row.sku || "New SKU"} ${pl.name} advertising percentage`}
                              type="number"
                              className="plat-field-inp"
                              value={override.adPct ?? ''}
                              placeholder={plc.adPct ?? (pl.default_ad_pct ?? 0)}
                              onChange={e => handlePlatOverride(row.id, pl.id, 'adPct', e.target.value)}
                            />
                          </div>
                          {/* ₹ input — placeholder shows derived ₹ when % is set */}
                          <div className="plat-field">
                            <span className="plat-field-lbl">₹</span>
                            <input aria-label={`${row.sku || "New SKU"} ${pl.name} advertising amount in rupees`}
                              type="number"
                              className="plat-field-inp"
                              value={override.adAmt ?? ''}
                              placeholder={row.price ? (plc.adAmt ?? 0) : '—'}
                              onChange={e => handlePlatOverride(row.id, pl.id, 'adAmt', e.target.value)}
                            />
                          </div>
                          {/* Alias — always visible; dim placeholder when empty, gold border when set */}
                          <div className="plat-alias-row">
                            <input aria-label={alias ? `${pl.name} alias: ${alias}` : `Map this SKU's name on ${pl.name}`}
                              className={`plat-alias-inp${alias ? ' has-value' : ''}`}
                              placeholder={`${pl.name} SKU name…`}
                              value={alias}
                              onChange={e => handleAlias(row.id, pl.id, e.target.value)}
                              title={alias ? `${pl.name} alias: ${alias}` : `Map this SKU's name on ${pl.name}`}
                            />
                          </div>
                        </div>
                      </td>,
                      <td key={`${pl.id}-tier`} className="ec ec-plat w-plat-tier">
                        <select className="plat-tier-s" aria-label="Platform tier" value={plc.tierIdx}
                          onChange={e => {
                            const v = e.target.value
                            if (v === '__add__') {
                              setTierQuickAdd({ platform: pl, rowId: row.id })
                            } else {
                              handleTier(row.id, pl.id, parseInt(v))
                            }
                          }}>
                          {pl.tiers?.map((t, i) => (
                            <option key={i} value={i}>
                              {t.tier_name === 'None' ? '0' : t.tier_name}
                              {t.fee_pct != null ? ` (${t.fee_pct}%)` : (t.fee ? ` (₹${t.fee})` : '')}
                            </option>
                          ))}
                          <option value="__add__">+ Add tier…</option>
                        </select>
                      </td>,
                      <td key={`${pl.id}-bs`} className="ec ec-auto ec-gold w-plat-bs">
                        {plc.bs ? `₹${plc.bs}` : '—'}
                      </td>
                    ])
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
                    <button aria-label={`Delete ${row.sku || "row"}`} onClick={() => delRow(row.id)} className="del-btn">×</button>
                  </td>
                </tr>
                  )
              })
  }, [rows, platforms, activePlats, readOnly, viewPlats, miscDef, profDef, damageDef, categories, vendors,
      coFilter, sortKey, sortDir, vis, vendorOpts, catOpts, seriesOpts,
      upd, delRow, handleTier, handlePlatOverride, handleAlias, applyCategoryDefaults])

  if (loading) {return (
    <div className="loader-page">
      <div className="loader" style={{ width:32, height:32 }}/>
    </div>
  )}

  const setDens = d => { setDensity(d); localStorage.setItem('skuDensity', d) }

  const TMPL_HEADERS = [
    'SKU Code','Vendor','Category','Vendor SKU','V.Short','Series',
    'Product Cost ₹','Packaging ₹','Logistics ₹','Add-ons ₹','Misc ₹',
    'CR %','Damage %','Profit %','GST %','HSN Code'
  ]
  // Leave rate/misc cells blank to inherit global/platform defaults.
  const TMPL_SAMPLE = ['e.g. SKU-001','Varni','Jewellery Set','STYLE-01','','Necklace',299,10,15,0,'',10,15,20,5,7117]

  const downloadXLSX = async () => {
    const XLSX = await import('xlsx')
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
    if (!file) {return}
    const reader = new FileReader()
    reader.onload = async ev => {
      const XLSX = await import('xlsx')
      const csv = file.name.toLowerCase().endsWith('.csv')
      const input = csv ? new TextDecoder('utf-8').decode(ev.target.result) : ev.target.result
      const wb = XLSX.read(input, { type: csv ? 'string' : 'array' })
      const ws  = wb.Sheets[wb.SheetNames[0]]
      const raw = XLSX.utils.sheet_to_json(ws, { defval: '' })
      // Tolerant header matching: ignore case, spaces, ₹/%/punctuation. Accepts
      // both the current template (SKU Code / Product Cost ₹ / Add-ons ₹ / HSN)
      // and older headers (SKU Name / Price ₹ / Addons ₹) via aliases.
      const norm = s => String(s).toLowerCase().replace(/[₹%().\s_-]/g, '')
      const pick = (obj, ...names) => {
        const wanted = names.map(norm)
        for (const k of Object.keys(obj)) {if (wanted.includes(norm(k))) {return obj[k]}}
        return ''
      }
      const rows = raw
        .map(r => ({
          sku:     String(pick(r, 'SKU Code', 'SKU Name', 'SKU') || '').trim(),
          vendor:  String(pick(r, 'Vendor') || '').trim(),
          category:String(pick(r, 'Category') || '').trim(),
          vsku:    String(pick(r, 'Vendor SKU') || '').trim(),
          vshort:  String(pick(r, 'V.Short', 'VShort', 'Short Code') || '').trim(),
          series:  String(pick(r, 'Series') || '').trim(),
          price:   String(pick(r, 'Product Cost ₹', 'Product Cost', 'Price ₹', 'Cost') || ''),
          pkg:     String(pick(r, 'Packaging ₹', 'Package ₹', 'Packaging') || ''),
          log:     String(pick(r, 'Inbound Logistics ₹', 'Logistics ₹', 'Logistics') || ''),
          addons:  String(pick(r, 'Add-ons ₹', 'Addons ₹', 'Addons') || ''),
          misc:    String(pick(r, 'Misc ₹', 'Misc') || ''),
          crPct:   String(pick(r, 'CR %', 'CR') || ''),
          crAmt:   String(pick(r, 'CR ₹') || ''),
          dmgPct:  String(pick(r, 'Damage %', 'Damage') || ''),
          dmgAmt:  String(pick(r, 'Damage ₹') || ''),
          profPct: String(pick(r, 'Profit %', 'Profit') || ''),
          profAmt: String(pick(r, 'Profit ₹') || ''),
          gst:     String(pick(r, 'GST %', 'GST') || '').replace('%','').trim(),
          hsn:     String(pick(r, 'HSN Code', 'HSN') || '').trim(),
        }))
        // Keep rows with a real SKU/vendor-sku; drop the template's example row.
        .filter(r => (r.sku || r.vsku) && !/^e\.g\./i.test(r.sku) && norm(r.sku) !== 'sku001')
      setImportRows(rows)
      setShowImportModal(true)
    }
    reader.readAsArrayBuffer(file)
    e.target.value = ''
  }

  const confirmImport = async () => {
    setImporting(true)
    try {
      // Auto-create any vendor/category names not already in the active company,
      // then resolve every imported row's name -> id (the grid saves by id).
      const vByName = new Map(vendors.map(v => [v.name.trim().toLowerCase(), v]))
      const cByName = new Map(categories.map(c => [c.name.trim().toLowerCase(), c]))

      const newVendorNames = [...new Set(importRows.map(r => r.vendor).filter(Boolean))]
        .filter(n => !vByName.has(n.trim().toLowerCase()))
      const newCatNames = [...new Set(importRows.map(r => r.category).filter(Boolean))]
        .filter(n => !cByName.has(n.trim().toLowerCase()))

      for (const name of newVendorNames) {
        const short = (name.trim().split(/\s+/).slice(0, 3).map(w => w[0]).join('') || name.slice(0, 3))
          .toUpperCase()
        const v = await createVendor({ name: name.trim(), short_code: short })
        vByName.set(name.trim().toLowerCase(), v)
      }
      for (const name of newCatNames) {
        const c = await createCategory({ name: name.trim() })
        cByName.set(name.trim().toLowerCase(), c)
      }
      if (newVendorNames.length) {setVendors(await getVendors())}
      if (newCatNames.length)    {setCategories(await getCategories())}

      const mapped = importRows.map(r => {
        const v = r.vendor   ? vByName.get(r.vendor.trim().toLowerCase())   : null
        const c = r.category ? cByName.get(r.category.trim().toLowerCase()) : null
        return newRow({
          ...r,
          vendorId:   v?.id || null,
          vshort:     r.vshort || v?.short_code || '',
          categoryId: c?.id || null,
          gstType:    r.gst,
          status:     STATUS.DIRTY,
        })
      })
      setRows(prev => [...prev, ...mapped])
      setShowImportModal(false)
      setImportRows([])
    } finally {
      setImporting(false)
    }
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
      const base = compute(row, miscDef, profDef, activePlats, damageDef)
      const platBSes = activePlats.map(pl => {
        const res = computePlatform(row, pl, base, miscDef)
        return res.bs ?? ''
      })
      return [
        row.vendor, row.sku, row.vshort, row.vsku, row.category,
        row.price, row.pkg, row.log, row.addons, row.misc,
        base.crPct, base.crAmt, base.dmgPct, base.dmgAmt, base.be,
        base.profPct, base.profAmt, base.bsNoGst,
        resolveGst(row.gstType, row.price),
        base.finalBS,
        ...platBSes
      ]
    })
    return { headers, data }
  }

  const exportXLSX = async () => {
    const XLSX = await import('xlsx')
    const { headers, data } = buildExportData()
    const ws = XLSX.utils.aoa_to_sheet([headers, ...data])
    // Bold header row
    const range = XLSX.utils.decode_range(ws['!ref'])
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r: 0, c })]
      if (cell) {cell.s = { font: { bold: true } }}
    }
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'SKUs')
    XLSX.writeFile(wb, `casper_skus_${new Date().toISOString().slice(0,10)}.xlsx`)
  }

  const exportCSV = () => {
    const { headers, data } = buildExportData()
    const escape = csvCell
    const csv = [headers, ...data].map(row => row.map(escape).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `casper_skus_${new Date().toISOString().slice(0,10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (loadError) {return <div role="alert">{loadError} <button onClick={() => window.location.reload()}>Reload</button></div>}

  return (
    <div className={`entries-page density-${density}`}>
      {actionError && <div role="alert">{actionError} <button onClick={() => setActionError('')}>Dismiss</button></div>}
      {readOnly && <div role="status">{isAll ? 'All Companies is a read-only catalog. Select one company to edit.' : 'Your company role permits viewing this catalog.'}</div>}

      {/* ── Header ── */}
      <div className="page-header">
        <div>
          <h1 className="page-title">{pageTitle}</h1>
          <p className="page-subtitle">
            {viewMode === "inventory" && <>Product catalog and costs · </>}{rows.length} rows
            {awaitingPriceCount > 0 && <> · {awaitingPriceCount} awaiting price</>}
            {/* The hidden-SKU notice used to be its own full-width band. It is a
                count plus an action, so it belongs on the subtitle line. */}
            {unmatched.length > 0 && (
              <button className="sku-hidden-pill" onClick={() => setShowHidden(s => !s)}
                title="SKUs seen in uploads with no pricing — excluded from P&L">
                {unmatched.length} hidden
                <span className="sku-hidden-pill-cta">{showHidden ? 'Hide' : 'Review'}</span>
              </button>
            )}
          </p>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <span className="save-status">
            {isAll ? (
              <span className="save-dirty" title="Edits typed here are not sent — switch the company switcher to one company to save.">
                View-only in All Companies
              </span>
            ) : (
              <>
                {isSaving && <span className="save-saving">⟳ Saving...</span>}
                {!isSaving && dirtyCount > 0 && (
                  <span className="save-dirty">● {dirtyCount} unsaved</span>
                )}
                {allSaved && <span className="save-saved">✓ All saved</span>}
              </>
            )}
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
            <button className="btn btn-ghost" disabled={readOnly} onClick={() => setImportOpen(p => !p)}>
              ↓ Import ▾
            </button>
            {importOpen && (
              <div className="import-dd-menu">
                <button className="import-dd-item" onClick={() => { downloadXLSX(); setImportOpen(false) }}>📥 Download Template (.xlsx)</button>
                <button className="import-dd-item" onClick={() => { downloadCSV(); setImportOpen(false) }}>📥 Download Template (.csv)</button>
                <div className="import-dd-sep" />
                <button className="import-dd-item" onClick={() => { fileInputRef.current.click(); setImportOpen(false) }}>📂 Import from file...</button>
                <input aria-label={"SKU import file"} ref={fileInputRef} type="file" accept=".xlsx,.csv" style={{display:'none'}} onChange={handleFileImport} />
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
          <button className="btn btn-accent" onClick={saveAll} disabled={readOnly || isSaving || dirtyCount === 0}>
            {isSaving
              ? <><span className="loader" style={{ width:12, height:12, borderWidth:2 }}/> Saving</>
              : 'Save All'
            }
          </button>
          <button className="btn btn-primary" disabled={readOnly} onClick={addRow}>+ Add Row</button>
        </div>
      </div>

      {/* Only the LIST takes space, and only while open — the trigger lives in the header. */}
      {showHidden && unmatched.length > 0 && (
        <div className="sku-hidden-banner">
          <div className="sku-hidden-list">
            {unmatched.map(u => (
              <div key={u.platform_sku_name} className="sku-hidden-row">
                <span className="sku-hidden-name">{u.platform_sku_name}</span>
                <span className="sku-hidden-meta">{u.units} units · {u.reports} report{u.reports !== 1 ? 's' : ''}</span>
                <button className="btn btn-ghost btn-sm" onClick={() => addHiddenSku(u.platform_sku_name)}>+ Add</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Settings bar (hidden in inventory catalog view) ── */}
      {viewMode !== 'inventory' && <div className="e-bar">
        <div className="e-bar-item">
          <label htmlFor={fieldId0 + '-field-1703'}>Global Profit %</label>
          <input id={fieldId0 + '-field-1703'} type="number" value={profDef} min={0} max={100} aria-label="Global profit percent"
            onChange={e => setProfDef(parseFloat(e.target.value)||20)} />
        </div>
        <div className="e-bar-item">
          <label htmlFor={fieldId0 + '-field-1708'}>Default Misc ₹</label>
          <input id={fieldId0 + '-field-1708'} type="number" value={miscDef} min={0} aria-label="Default misc cost in rupees"
            onChange={e => setMiscDef(parseFloat(e.target.value)||0)} />
        </div>
        <div className="e-bar-sep"/>
        <span className="e-bar-label">Platforms:</span>
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

        {/* Company legend + filter (consolidated mode only). The coloured dot is the
            key to the row rails — a colour with no legend tells you nothing — and
            clicking it filters, so legend and filter are one control, not two rows. */}
        {companyLegend.length > 1 && (
          <>
            <div className="e-bar-sep"/>
            <span className="e-bar-label">Companies:</span>
            <div className="e-chips">
              <button className={`co-legend${coFilter === null ? ' on' : ''}`}
                onClick={() => setCoFilter(null)}>
                All<span className="co-legend-n">{rows.length}</span>
              </button>
              {companyLegend.map(c => (
                <button key={c.id}
                  className={`co-legend${coFilter === c.id ? ' on' : ''}`}
                  onClick={() => setCoFilter(coFilter === c.id ? null : c.id)}
                  title={`Show only ${c.name}`}>
                  <span className="co-legend-dot" style={{ background: c.color }} />
                  {c.name}<span className="co-legend-n">{c.count}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {/* Bulk-fill categories. Only offered while there is something to fill, so it
            disappears once the gap is closed rather than sitting there forever. */}
        {uncategorised.length > 0 && categories.length > 0 && (
          <>
            <div className="e-bar-sep"/>
            <label className="e-bar-label">{uncategorised.length} without category:</label>
            <select className="e-sort" value="" onChange={e => { askBulkCategory(e.target.value); e.target.value = '' }}
              aria-label={`Set a category on ${uncategorised.length} SKUs that have none`}>
              <option value="">Set category…</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </>
        )}

        <div className="e-bar-sep"/>
        <label htmlFor={fieldId0 + '-field-1769'} className="e-bar-label">Sort:</label>
        <select id={fieldId0 + '-field-1769'} className="e-sort" value={`${sortKey}:${sortDir}`}
          onChange={e => { const [k, d] = e.target.value.split(':'); setSortKey(k); setSortDir(d) }}
          aria-label="Sort SKUs">
          <option value="sku:asc">SKU A→Z</option>
          <option value="sku:desc">SKU Z→A</option>
          <option value="price:desc">Price high→low</option>
          <option value="price:asc">Price low→high</option>
          {companyLegend.length > 1 && <option value="company:asc">Company</option>}
        </select>

        {/* Columns live on the SAME row as platforms — this used to be a second
            full-width band, and stacked bands push the data below the fold. */}
        <div className="e-bar-sep"/>
        <span className="e-bar-label">Columns:</span>
        <div className="e-chips">
          {Object.entries(COL_GROUPS).map(([key, group]) => (
            <button key={key}
              className={`col-toggle-btn ${colVis[key] ? 'on' : 'off'}`}
              onClick={() => toggleGroup(key)}>
              <div className="shine"/>
              <div className="inner"/>
              <span>{colVis[key] ? '✓' : '○'} {group.label}</span>
            </button>
          ))}
          <button className="col-reset" onClick={resetVisibility} title="Reset columns">↺</button>
        </div>
      </div>}

      {/* Offscreen focus holder. Keeping focus in an editable element is the
          only way the browser will deliver copy/paste/cut to the grid while a
          cell is merely selected rather than being edited. */}
      <textarea disabled={readOnly} ref={clipBoxRef} className="grid-clipbox" aria-hidden="true"
        tabIndex={-1} defaultValue="" />

      {/* ── Desktop Table ── */}
      <fieldset disabled={readOnly} className="grid-fieldset"><div className="e-scroll" role="presentation" onMouseDown={e => { if (e.target.closest("tbody")) { onGridMouseDown(e) } }} onDoubleClick={e => { if (e.target.closest("tbody")) { onGridDoubleClick(e) } }}>
        <table className="e-tbl">
          <thead>
            <tr>
              {/* SKU group header */}
              <th className="gh gh-sku"
                colSpan={2 + (vis('series')?1:0) + (vis('vshort')?1:0) + (vis('vsku')?1:0) + (vis('category')?1:0)}>
                SKU
              </th>
              {/* Unit Economics group header (no AD column) */}
              <th className="gh gh-ue"
                colSpan={1+(vis('pkg')?1:0)+(vis('log')?1:0)+(vis('addons')?1:0)+(vis('misc')?1:0)+(vis('crpct')?1:0)+(vis('cramt')?1:0)+(vis('dmgpct')?1:0)+(vis('dmgamt')?1:0)}>
                Unit Economics
              </th>
              {/* Profitability group header — Breakeven + GST + Breakeven (GST) + Profit % + Profit ₹ */}
              <th className="gh gh-prof"
                colSpan={2 + (vis('gst')?1:0) + (vis('profpct')?1:0) + (vis('profamt')?1:0)}>
                Profitability
              </th>
              {/* Bank Settlement group — Target Pre-GST + Target Post-GST */}
              <th className="gh gh-bs"
                colSpan={(vis('bsnogst')?1:0) + 1}>
                Bank Settlement
              </th>
              {/* Platform columns — AD inputs + tier | AD ₹ | BS (3 cols each) */}
              {viewPlats.map(pl => (
                <th key={pl.id} className="gh gh-plat" colSpan={3}>
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:4 }}>
                    <span>{pl.name}</span>
                    <span style={{ fontSize:10, color:'var(--text-3)', fontWeight:400 }}>
                      AD {pl.default_ad_pct ?? 0}%
                    </span>
                    <button
                      className="gh-upload-btn"
                      title="Upload ad report (CSV / XLSX)"
                      onClick={() => setAdReportPlat(pl)}>
                      ↑ Upload Ad
                    </button>
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
              <th className="sh sh-sku w-sku sticky-col-hdr" style={{left:90}}>SKU</th>
              {vis('series')   && <th className="sh sh-sku w-series">Series</th>}
              {vis('vshort')   && <th className="sh sh-sku w-vshort">V.Short</th>}
              {vis('vsku')     && <th className="sh sh-sku w-vsku">Vendor SKU</th>}
              {vis('category') && <th className="sh sh-sku w-cat">Category</th>}
              <th className="sh sh-ue w-price">Price ₹</th>
              {vis('pkg')    && <th className="sh sh-ue w-pkg">Package</th>}
              {vis('log')    && <th className="sh sh-ue w-log">Logistics</th>}
              {vis('addons') && <th className="sh sh-ue w-addons">Addons</th>}
              {vis('misc')   && <th className="sh sh-ue w-misc">Misc</th>}
              {vis('crpct')  && <th className="sh sh-ue w-crpct" title="Courier return cost — expected return rate %">Return %</th>}
              {vis('cramt')  && <th className="sh sh-ue w-cramt" title="Expected return reserve per SKU. Reverse-shipping charge × Return %, unless amount is overridden.">Return ₹</th>}
              {vis('dmgpct') && <th className="sh sh-ue w-dmgpct">Dmg %</th>}
              {vis('dmgamt') && <th className="sh sh-ue w-dmgamt">Dmg ₹</th>}
              <th className="sh sh-prof w-be">Breakeven</th>
              {vis('gst') && <th className="sh sh-tax w-gst">GST</th>}
              <th className="sh sh-prof w-be">Breakeven (GST)</th>
              {vis('profpct') && <th className="sh sh-prof w-profpct">Profit %</th>}
              {vis('profamt') && <th className="sh sh-prof w-profamt">Profit ₹</th>}
              {vis('bsnogst') && <th className="sh sh-bs w-bsnogst">Target Pre-GST</th>}
              <th className="sh sh-bs w-finalbs">Target Post-GST</th>
              {viewPlats.map(pl => ([
                <th key={`${pl.id}-ad`} className="sh sh-plat w-plat-ad">AD% / ₹</th>,
                <th key={`${pl.id}-tier`} className="sh sh-plat w-plat-tier">Tier</th>,
                <th key={`${pl.id}-bs`} className="sh sh-bs w-plat-bs">BS</th>
              ]))}
              <th className="sh" style={{ minWidth:28 }}/>
              <th className="sh" style={{ minWidth:28 }}/>
            </tr>
          </thead>

          <tbody>
              {tbodyRows}
          </tbody>
        </table>
      </div>

      </fieldset>
      {!readOnly && <button className="e-addrow" onClick={addRow}>+ Add row</button>}

      <ConfirmDialog
        open={!!pendingBulk}
        title="Set category in bulk"
        confirmLabel={`Set on ${uncategorised.length} SKU${uncategorised.length !== 1 ? 's' : ''}`}
        onCancel={() => setPendingBulk(null)}
        onConfirm={() => applyBulkCategory(pendingBulk)}>
        Set <strong>{pendingBulk?.name}</strong> on the{' '}
        <strong>{uncategorised.length}</strong> SKU{uncategorised.length !== 1 ? 's' : ''} that
        currently have no category
        {coFilter && companyLegend.find(c => c.id === coFilter) &&
          <> in <strong>{companyLegend.find(c => c.id === coFilter).name}</strong></>}.
        <span className="cd-note">
          Rows that already have a category are left untouched, and cost defaults are
          not applied. Nothing is written until you press Save All — and you can undo
          straight afterwards.
        </span>
      </ConfirmDialog>

      {/* Undo for the bulk fill. Floating, so it costs no layout space, and it
          stays until acted on rather than timing out — losing the only way back
          from a 71-row edit because a toast expired would be worse than useless. */}
      {lastBulk && (
        <div className="bulk-undo" role="status">
          <span>
            Set <strong>{lastBulk.catName}</strong> on {lastBulk.count} SKU{lastBulk.count !== 1 ? 's' : ''}
            <span className="bulk-undo-hint"> · not saved yet</span>
          </span>
          <button className="bulk-undo-btn" onClick={undoBulk}>Undo</button>
          <button className="bulk-undo-x" onClick={() => setLastBulk(null)} aria-label="Dismiss">×</button>
        </div>
      )}

      {/* Range toolbar — only once a real range is selected, so single-cell
          editing is never interrupted by a floating bar. */}
      {selCount > 1 && (
        <div className="range-bar" role="status">
          <span className="range-bar-n">{selCount} cells</span>
          <input
            className="range-bar-inp"
            type="number"
            value={bulkValue}
            placeholder="value"
            aria-label="Value to apply to selected cells"
            onChange={e => setBulkValue(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { applyToSelection(bulkValue); setBulkValue('') } }}
          />
          <button className="range-bar-btn primary"
            onClick={() => { applyToSelection(bulkValue); setBulkValue('') }}>Apply</button>
          <button className="range-bar-btn" onClick={fillDown} title="Ctrl+D">Fill down</button>
          <button className="range-bar-btn" onClick={copySelection} title="Ctrl+C">Copy</button>
          <button className="range-bar-btn" onClick={pasteSelection} title="Ctrl+V">Paste</button>
          <button className="range-bar-btn danger" onClick={() => applyToSelection('')} title="Delete">Clear</button>
          <button className="bulk-undo-x" onClick={() => setSel(null)} aria-label="Dismiss selection">×</button>
        </div>
      )}

      {/* ── Mobile cards ── */}
      <fieldset disabled={readOnly} className="grid-fieldset e-mobile">
        {rows.map(row => {
          const c = compute(row, miscDef, profDef, platforms, damageDef)
          return (
            <MobileCard readOnly={readOnly} key={row.id} row={row} calc={c}
              vendorOpts={vendorOpts} catOpts={catOpts}
              miscDef={miscDef} profDef={profDef}
              activePlats={viewPlats} platforms={platforms}
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
      </fieldset>

      {/* Import Modal */}
      <ConfirmDialog open={showImportModal} title={`Import Preview — ${importRows.length} rows`}
        dialogRole="dialog" className="import-dialog" confirmLabel={importing ? 'Importing…' : `Import ${importRows.length} rows`}
        confirmDisabled={importing || importRows.length === 0}
        onConfirm={confirmImport} onCancel={() => !importing && setShowImportModal(false)}>
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
                        <td key={f}><input aria-label={`Import row ${i + 1} ${f}`} className="imp-inp" value={row[f]}
                          onChange={e => updImportRow(i, f, e.target.value)} /></td>
                      ))}
                      {['price','pkg','log','addons','misc'].map(f => (
                        <td key={f}><input aria-label={`Import row ${i + 1} ${f}`} className="imp-inp imp-num" type="number" value={row[f]}
                          onChange={e => updImportRow(i, f, e.target.value)} /></td>
                      ))}
                      <td><input aria-label={`${row.sku || "New SKU"} return rate percentage`} className="imp-inp imp-num" type="number" value={row.crPct}
                        disabled={row.crAmt !== '' && row.crPct === ''}
                        onChange={e => { updImportRow(i,'crPct',e.target.value); updImportRow(i,'crAmt','') }} /></td>
                      <td><input aria-label={`${row.sku || "New SKU"} return cost in rupees`} className="imp-inp imp-num" type="number" value={row.crAmt}
                        disabled={row.crPct !== ''}
                        onChange={e => { updImportRow(i,'crAmt',e.target.value); updImportRow(i,'crPct','') }} /></td>
                      <td><input aria-label={`${row.sku || "New SKU"} damage rate percentage`} className="imp-inp imp-num" type="number" value={row.dmgPct}
                        disabled={row.dmgAmt !== '' && row.dmgPct === ''}
                        onChange={e => { updImportRow(i,'dmgPct',e.target.value); updImportRow(i,'dmgAmt','') }} /></td>
                      <td><input aria-label={`${row.sku || "New SKU"} damage cost in rupees`} className="imp-inp imp-num" type="number" value={row.dmgAmt}
                        disabled={row.dmgPct !== ''}
                        onChange={e => { updImportRow(i,'dmgAmt',e.target.value); updImportRow(i,'dmgPct','') }} /></td>
                      <td><input aria-label={`${row.sku || "New SKU"} profit percentage`} className="imp-inp imp-num" type="number" value={row.profPct}
                        disabled={row.profAmt !== '' && row.profPct === ''}
                        onChange={e => { updImportRow(i,'profPct',e.target.value); updImportRow(i,'profAmt','') }} /></td>
                      <td><input aria-label={`${row.sku || "New SKU"} profit in rupees`} className="imp-inp imp-num" type="number" value={row.profAmt}
                        disabled={row.profPct !== ''}
                        onChange={e => { updImportRow(i,'profAmt',e.target.value); updImportRow(i,'profPct','') }} /></td>
                      <td>
                        <select className="imp-inp" aria-label="GST rate" value={row.gst}
                          onChange={e => updImportRow(i,'gst',e.target.value)}>
                          {[0,5,12,18,28].map(g => <option key={g} value={g}>{g}%</option>)}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
      </ConfirmDialog>



      {manageCatOpen && (
        <ManageCategoriesModal
          categories={categories}
          rows={rows}
          onClose={() => setManageCatOpen(false)}
          onUpdate={async (id, patch) => {
            // patch may include: name, default_cr_pct, default_damage_pct, default_profit_pct
            await updateCategory(id, patch)
            setCategories(p => p.map(c => c.id === id ? { ...c, ...patch } : c))
          }}
          onDelete={async id => {
            await deleteCategory(id)
            setCategories(p => p.filter(c => c.id !== id))
          }}
        />
      )}

      {/* Phase 6 — Ad report upload modal (per platform) */}
      {adReportPlat && (
        <UploadAdReportModal
          platform={adReportPlat}
          rows={rows}
          onClose={() => setAdReportPlat(null)}
          onApply={(updates) => {
            // updates: [{ rowId, adAmt }]
            const platId = adReportPlat.id
            setRows(prev => prev.map(r => {
              const u = updates.find(x => x.rowId === r.id)
              if (!u) {return r}
              const prevOverride = r.platOverrides?.[platId] || {}
              return {
                ...r,
                status: STATUS.DIRTY,
                platOverrides: {
                  ...r.platOverrides,
                  [platId]: { ...prevOverride, adAmt: String(u.adAmt), adPct: '' },
                },
              }
            }))
            setAdReportPlat(null)
          }}
        />
      )}

      {/* Quick-add tier modal — invoked from per-platform tier dropdown */}
      {tierQuickAdd && (
        <AddTierQuickModal
          platform={tierQuickAdd.platform}
          onClose={() => setTierQuickAdd(null)}
          onSaved={(newTier) => {
            // 1. Append the new tier to the platform's tier list (in state)
            setPlatforms(prev => prev.map(p =>
              p.id === tierQuickAdd.platform.id
                ? { ...p, tiers: [...(p.tiers || []), newTier] }
                : p
            ))
            setActivePlats(prev => prev.map(p =>
              p.id === tierQuickAdd.platform.id
                ? { ...p, tiers: [...(p.tiers || []), newTier] }
                : p
            ))
            // 2. Auto-select the new tier on the row that triggered it
            //    (its index = old length, since we just appended).
            const newIdx = (tierQuickAdd.platform.tiers?.length || 0)
            handleTier(tierQuickAdd.rowId, tierQuickAdd.platform.id, newIdx)
            setTierQuickAdd(null)
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
function MobileCard({ row, calc:c, vendorOpts, miscDef,
  activePlats, onUpd, onDel, onTier, onPlatOverride, onNewVendor, readOnly }) {
  const fieldId1 = useId()
  const [open, setOpen] = useState(false)
  return (
    <div className="m-card">
      <div onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (() => setOpen(o => !o))(e) } }} role="button" tabIndex={0} aria-expanded={open} className="m-card-hdr" onClick={() => setOpen(o => !o)}>
        <div>
          <div className="m-sku">{row.sku || 'New SKU'}
            {row.skuId && <Link className="ec-profile-link" to={`/product/catalogue/${row.skuId}`}>Product profile ↗</Link>}
            {row.skuId && !row.isActive && <span className="ec-inactive-label">Inactive</span>}
          </div>
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
            <div className="m-field"><label htmlFor={fieldId1 + '-field-2136'}>Vendor</label>
              <SmartCell id={fieldId1 + '-field-2136'} readOnly={readOnly} value={row.vendor} options={vendorOpts} placeholder="Vendor"
                onChange={v => onUpd(row.id,{vendor:v})}
                onSelect={opt => onUpd(row.id,{vendor:opt.label,vshort:opt.sublabel||''})}
                onAddNew={onNewVendor} addNewLabel="Add vendor"/>
            </div>
            <div className="m-field"><label htmlFor={fieldId1 + '-field-2142'}>V.Short</label>
              <input id={fieldId1 + '-field-2142'} aria-label={`${row.sku || "New SKU"} vendor short code`} className="m-input mono" value={row.vshort} placeholder="e.g. ABC"
                onChange={e => onUpd(row.id,{vshort:e.target.value.toUpperCase()})}/>
            </div>
            <div className="m-field"><label htmlFor={fieldId1 + '-field-2146'}>Vendor SKU</label>
              <input id={fieldId1 + '-field-2146'} aria-label={`${row.sku || "New SKU"} vendor SKU`} className="m-input mono" value={row.vsku} placeholder="e.g. STYLE-01"
                onChange={e => onUpd(row.id,{vsku:e.target.value})}/>
            </div>
            <div className="m-field"><label htmlFor={fieldId1 + '-field-2150'}>SKU</label>
              <input id={fieldId1 + '-field-2150'} aria-label={`${row.sku || "New SKU"} SKU code`} className="m-input mono" value={row.sku} placeholder="e.g. SKU-001"
                onChange={e => onUpd(row.id,{sku:e.target.value.toUpperCase()})}/>
            </div>
          </div>
          <div className="m-section">Unit Economics</div>
          <div className="m-grid">
            {[['Price','price'],['Package','pkg'],['Logistics','log'],
              ['Addons','addons']].map(([l,f])=>(
              <div key={f} className="m-field"><label>{l}</label>
                <input aria-label={(l)} className="m-input mono right" type="number" value={row[f]}
                  placeholder={f === 'price' ? '—' : '0'} onChange={e=>onUpd(row.id,{[f]:e.target.value})}/>
              </div>
            ))}
            <div className="m-field"><label htmlFor={fieldId1 + '-field-2164'}>Misc ₹</label>
              <input id={fieldId1 + '-field-2164'} aria-label={`${row.sku || "New SKU"} miscellaneous cost in rupees`} className="m-input mono right" type="number" value={row.misc}
                placeholder={miscDef} onChange={e=>onUpd(row.id,{misc:e.target.value})}/>
            </div>
            <div className="m-field"><label htmlFor={fieldId1 + '-field-2168'}>Return %</label>
              <input id={fieldId1 + '-field-2168'} aria-label={`${row.sku || "New SKU"} return rate percentage`} className="m-input mono right" type="number" value={row.crPct}
                placeholder={row.price ? c.crPct : '—'} onChange={e=>onUpd(row.id,{crPct:e.target.value,crAmt:''})}/>
            </div>
            <div className="m-field"><label htmlFor={fieldId1 + '-field-2172'}>Return ₹</label>
              <input id={fieldId1 + '-field-2172'} aria-label={`${row.sku || "New SKU"} return cost in rupees`} className="m-input mono right" type="number" value={row.crAmt}
                placeholder={row.price ? c.crAmt : '—'} onChange={e=>onUpd(row.id,{crAmt:e.target.value,crPct:''})}/>
            </div>
            <div className="m-field"><label htmlFor={fieldId1 + '-field-2176'}>Dmg %</label>
              <input id={fieldId1 + '-field-2176'} aria-label={`${row.sku || "New SKU"} damage rate percentage`} className="m-input mono right" type="number" value={row.dmgPct}
                placeholder={row.price ? c.dmgPct : '—'} onChange={e=>onUpd(row.id,{dmgPct:e.target.value,dmgAmt:''})}/>
            </div>
            <div className="m-field"><label htmlFor={fieldId1 + '-field-2180'}>Dmg ₹</label>
              <input id={fieldId1 + '-field-2180'} aria-label={`${row.sku || "New SKU"} damage cost in rupees`} className="m-input mono right" type="number" value={row.dmgAmt}
                placeholder={row.price ? c.dmgAmt : '—'} onChange={e=>onUpd(row.id,{dmgAmt:e.target.value,dmgPct:''})}/>
            </div>
          </div>
          <div className="m-section">Profitability</div>
          <div className="m-grid">
            <div className="m-field"><label htmlFor={fieldId1 + '-field-2187'}>Breakeven</label>
              <input aria-label={"Breakeven"} id={fieldId1 + '-field-2187'} className="m-input mono right" readOnly value={row.price?`₹${c.be}`:''} placeholder="—"/>
            </div>
            <div className="m-field"><label htmlFor={fieldId1 + '-field-2190'}>Breakeven (GST)</label>
              <input aria-label={"Breakeven (GST)"} id={fieldId1 + '-field-2190'} className="m-input mono right" readOnly value={row.price?`₹${c.beGst}`:''} placeholder="—"/>
            </div>
            <div className="m-field"><label htmlFor={fieldId1 + '-field-2193'}>Profit %</label>
              <input id={fieldId1 + '-field-2193'} aria-label={`${row.sku || "New SKU"} profit percentage`} className="m-input mono right" type="number" value={row.profPct}
                placeholder={row.price ? c.profPct : '—'} onChange={e=>onUpd(row.id,{profPct:e.target.value,profAmt:''})}/>
            </div>
            <div className="m-field"><label htmlFor={fieldId1 + '-field-2197'}>Profit ₹</label>
              <input id={fieldId1 + '-field-2197'} aria-label={`${row.sku || "New SKU"} profit in rupees`} className="m-input mono right" type="number" value={row.profAmt}
                placeholder={row.price ? c.profAmt : '—'} onChange={e=>onUpd(row.id,{profAmt:e.target.value,profPct:''})}/>
            </div>
            <div className="m-field"><label htmlFor={fieldId1 + '-field-2201'}>Target Pre-GST</label>
              <input aria-label={"Target Pre-GST"} id={fieldId1 + '-field-2201'} className="m-input mono right" readOnly value={row.price?`₹${c.bsNoGst}`:''} placeholder="—"/>
            </div>
            <div className="m-field"><label htmlFor={fieldId1 + '-field-2204'}>GST Type</label>
              <select id={fieldId1 + '-field-2204'} className="m-input" aria-label="GST rate" value={row.gstType} disabled={!row.price}
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
              <label htmlFor={fieldId1 + '-field-2217'} style={{color:'var(--accent)'}}>Target Post-GST</label>
              <input aria-label={"Target Post-GST"} id={fieldId1 + '-field-2217'} className="m-input mono right" readOnly
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
                      <input aria-label={`${row.sku || "New SKU"} ${pl.name} advertising percentage`} type="number" className="m-plat-tier" style={{ width:'45%' }}
                        value={override.adPct ?? ''} placeholder={`${pl.default_ad_pct ?? 0}%`}
                        onChange={e => onPlatOverride(row.id, pl.id, 'adPct', e.target.value)}/>
                      <input aria-label={`${row.sku || "New SKU"} ${pl.name} advertising amount in rupees`} type="number" className="m-plat-tier" style={{ width:'45%' }}
                        value={override.adAmt ?? ''} placeholder={`₹${plc.adAmt}`}
                        onChange={e => onPlatOverride(row.id, pl.id, 'adAmt', e.target.value)}/>
                    </div>
                    <select className="m-plat-tier" aria-label="Platform tier" value={plc.tierIdx}
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
