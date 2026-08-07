import { useState, useEffect, useCallback, useRef } from 'react'
// xlsx (~430 kB) is lazy-loaded inside the import/export handlers so it stays
// out of the initial SKUs bundle — only fetched when the user actually uses it.
import {
  getVendors, getCategories, getPlatforms,
  getMiscTotal, getSettings,
  getEntries, upsertBatch, deleteSku,
  updateCategory, deleteCategory, getUnmatchedSkus
} from '../api/client'
import SmartCell from '../components/SmartCell'
import AddVendorModal from '../components/AddVendorModal'
import AddCategoryModal from '../components/AddCategoryModal'
import ManageCategoriesModal from '../components/ManageCategoriesModal'
import BidirectionalPctAmount from '../components/BidirectionalPctAmount'
import AddTierQuickModal from '../components/AddTierQuickModal'
import UploadAdReportModal from '../components/UploadAdReportModal'
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

export function resolveGst(gstType, price) {
  const p = parseFloat(price) || 0
  if (gstType === 'apparel' || gstType === 'footwear') {
    return p <= 2500 ? 5 : 18
  }
  return parseFloat(gstType) || 0
}

// ─── Safe number → string (never scientific notation) ────────────────────────
function numStr(v) {
  if (v == null || v === '') return ''
  const n = parseFloat(v)
  if (isNaN(n)) return ''
  // toFixed(6) never produces sci notation; strip trailing zeros
  return n.toFixed(6).replace(/\.?0+$/, '') || '0'
}

/** Like numStr but capped at 2 decimals — for percentages and money values
 *  shown in narrow inputs. Avoids 9.163636-style stale precision. */
function numStr2(v) {
  if (v == null || v === '') return ''
  const n = parseFloat(v)
  if (isNaN(n)) return ''
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
    companyId:    data.companyId    || null,
    companyName:  data.companyName  || '',
    companyColor: data.companyColor || '',
    vshort:       data.vshort       || '',
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
    gstType:      data.gstType      || '5',
    gst:          data.gst          || '5',
    tiers:        data.tiers        || {},
    // Per-platform AD overrides: { [platformId]: { adPct: '', adAmt: '' } }
    // '' = inherit from platform.default_ad_pct
    platOverrides: data.platOverrides || {},
    // Per-platform SKU name aliases: { [platformId]: string }
    platAliases: data.platAliases || {},
  }
}

// Convert backend row → frontend row
function backendRowToFrontend(r) {
  // Rebuild platOverrides and platAliases from platform_configs returned by the API
  const platOverrides = {}
  const platAliases   = {}
  if (r.platform_configs) {
    r.platform_configs.forEach(cfg => {
      platOverrides[cfg.platform_id] = {
        adPct: cfg.ad_pct  != null ? numStr2(cfg.ad_pct) : '',
        adAmt: '',  // always blank on load; computed on render
      }
      if (cfg.platform_sku_name) platAliases[cfg.platform_id] = cfg.platform_sku_name
    })
  }

  return newRow({
    skuId:      r.id,
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
    misc:       numStr(r.misc_total),
    crPct:      numStr2(r.cr_percentage),
    crAmt:      numStr2(r.cr_cost),
    dmgPct:     numStr2(r.damage_percentage),
    dmgAmt:     numStr2(r.damage_cost),
    profPct:    numStr2(r.profit_percentage),
    gstType:    '5',
    gst:        r.gst != null ? numStr(r.gst) : '5',
    platOverrides,
    platAliases,
  })
}

// ─── Base compute (no AD — AD is per-platform) ────────────────────────────────
export function compute(row, miscDef, profDef, platforms) {
  const p      = parseFloat(row.price)  || 0
  const pkg    = parseFloat(row.pkg)    || 0
  const log    = parseFloat(row.log)    || 0
  const addons = parseFloat(row.addons) || 0
  const misc   = row.misc !== '' ? parseFloat(row.misc) : miscDef
  const crCharge = platforms[0]?.cr_charge ?? 0

  let crPct, crAmt
  if (row.crAmt !== '') {
    crAmt = parseFloat(row.crAmt) || 0
    crPct = crCharge > 0 ? (crAmt / crCharge) * 100 : 0
  } else {
    crPct = row.crPct !== '' ? parseFloat(row.crPct) : 20
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

  // GST resolved early so we can derive the with-GST companion values
  const gstRate = resolveGst(row.gstType || '5', row.price)
  const beGst   = be * (1 + gstRate / 100)

  let profPct, profAmt
  if (row.profAmt !== '') {
    profAmt = parseFloat(row.profAmt) || 0
    profPct = be > 0 ? (profAmt / be) * 100 : 0
  } else {
    profPct = row.profPct !== '' ? parseFloat(row.profPct) : profDef
    profAmt = be * profPct / 100
  }
  const profAmtGst = beGst * profPct / 100

  // Target Pre-GST is rounded to a whole rupee (logic.md §3 worked example);
  // GST is then computed on that integer base.
  const bsNoGst = Math.round(be + profAmt)
  const gstAmt  = +((bsNoGst * gstRate / 100).toFixed(2))
  const finalBS = +((bsNoGst + gstAmt).toFixed(2))

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
  const bsNoGst = +((platBe + profAmt).toFixed(2))

  const gstRate = resolveGst(row.gstType || '5', row.price)
  const gstAmt  = +((bsNoGst * gstRate / 100).toFixed(2))

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
export default function SKUs() {
  const [vendors,     setVendors]     = useState([])
  const [categories,  setCategories]  = useState([])
  const [platforms,   setPlatforms]   = useState([])
  const [activePlats, setActivePlats] = useState([])
  const [miscDef,     setMiscDef]     = useState(12)
  const [profDef,     setProfDef]     = useState(20)
  const [rows,        setRows]        = useState(() => [newRow(), newRow(), newRow()])
  const [unmatched,   setUnmatched]   = useState([])
  const [showHidden,  setShowHidden]  = useState(false)
  // Ordering + company filter. Default SKU-asc; id-desc order looked arbitrary.
  const [sortKey,   setSortKey]   = useState('sku')
  const [sortDir,   setSortDir]   = useState('asc')
  const [coFilter,  setCoFilter]  = useState(null)   // company_id, or null = all
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
  // Phase 5 — quick-add tier modal triggered from per-platform tier dropdown
  // shape: { platform, rowId } | null
  const [tierQuickAdd, setTierQuickAdd] = useState(null)
  // Phase 6 — ad-report upload modal scoped to a platform
  const [adReportPlat, setAdReportPlat] = useState(null)
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

  // Companies present in the loaded rows, with their colour and count. Empty in
  // single-company mode (the backend omits company fields there), which is what
  // keeps the legend from taking space when it would say the same thing on every row.
  const companyLegend = (() => {
    const by = new Map()
    rows.forEach(r => {
      if (!r.companyId) return
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

  const bulkSetCategory = (catId) => {
    const cat = categories.find(c => c.id === Number(catId))
    if (!cat || !uncategorised.length) return
    const ids = new Set(uncategorised.map(r => r.id))
    if (!window.confirm(
      `Set category "${cat.name}" on ${ids.size} SKU${ids.size !== 1 ? 's' : ''} that currently have none?\n\n` +
      `Rows that already have a category are left untouched. Nothing is written until you press Save All.`
    )) return
    // Category defaults are deliberately NOT applied here — they would overwrite
    // prices and cost inputs across every affected row. This sets the category only.
    setRows(prev => prev.map(r => ids.has(r.id)
      ? { ...r, category: cat.name, categoryId: cat.id, status: STATUS.DIRTY }
      : r))
  }

  const addRow = () => setRows(p => [...p, newRow()])

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
    if (!rowsToSave.length) return
    setRows(prev => prev.map(r =>
      rowsToSave.find(s => s.id === r.id) ? { ...r, status: STATUS.SAVING } : r
    ))

    const payload = rowsToSave.map(row => {
      // Build platform_overrides — include AD overrides + aliases
      const overrideMap = {}
      // AD overrides
      Object.entries(row.platOverrides || {}).forEach(([plId, o]) => {
        if (o.adPct === '' && o.adAmt === '') return
        let ad_pct = null
        if (o.adAmt !== '' && o.adAmt !== undefined) {
          const price = parseFloat(row.price) || 0
          const amt   = parseFloat(o.adAmt)   || 0
          ad_pct = price > 0 ? +(amt / price * 100).toFixed(4) : null
        } else if (o.adPct !== '' && o.adPct !== undefined) {
          ad_pct = parseFloat(o.adPct) ?? null
        }
        overrideMap[plId] = { platform_id: parseInt(plId), ad_pct, profit_pct: null, platform_sku_name: null }
      })
      // Aliases — merge into overrideMap
      Object.entries(row.platAliases || {}).forEach(([plId, alias]) => {
        if (!alias) return
        if (overrideMap[plId]) {
          overrideMap[plId].platform_sku_name = alias
        } else {
          overrideMap[plId] = { platform_id: parseInt(plId), ad_pct: null, profit_pct: null, platform_sku_name: alias }
        }
      })
      const platform_overrides = Object.values(overrideMap)

      return {
        sku:               row.sku,
        vendor_sku:        row.vsku       || null,
        series:            row.series     || null,
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

  const [collapsedSeries, setCollapsedSeries] = useState(new Set())
  const toggleSeries = name => setCollapsedSeries(prev => {
    const next = new Set(prev)
    next.has(name) ? next.delete(name) : next.add(name)
    return next
  })

  const vendorOpts = vendors.map(v => ({ label: v.name, sublabel: v.short_code }))
  const catOpts    = categories.map(c => ({ label: c.name }))
  const seriesOpts = [...new Set(rows.map(r => r.series).filter(Boolean))].map(s => ({ label: s }))

  const handleVendorSaved = v => {
    setVendors(p => [...p, v])
    if (pendingRowId) upd(pendingRowId, { vendor:v.name, vendorId:v.id, vshort:v.short_code })
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
  const applyCategoryDefaults = (row, cat) => {
    if (!cat) return {}
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
    'Price ₹','Package ₹','Inbound Logistics ₹','Addons ₹','Misc ₹',
    'CR %','CR ₹','Damage %','Damage ₹','Profit %','Profit ₹','GST %'
  ]
  const TMPL_SAMPLE = ['Varni','FH','y','N6-WHITE','Jewellery Set',299,0,0,0,0,10,'',5,'',20,'',5]

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
    if (!file) return
    const reader = new FileReader()
    reader.onload = async ev => {
      const XLSX = await import('xlsx')
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
          log:     String(r['Inbound Logistics ₹'] || r['Logistics ₹'] || ''),
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
      'Price ₹','Package ₹','Inbound Logistics ₹','Addons ₹','Misc ₹',
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
          <p className="page-subtitle">
            {rows.length} rows
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
              : 'Save All'
            }
          </button>
          <button className="btn btn-primary" onClick={addRow}>+ Add Row</button>
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

      {/* ── Settings bar ── */}
      <div className="e-bar">
        <div className="e-bar-item">
          <label>Global Profit %</label>
          <input type="number" value={profDef} min={0} max={100} aria-label="Global profit percent"
            onChange={e => setProfDef(parseFloat(e.target.value)||20)} />
        </div>
        <div className="e-bar-item">
          <label>Default Misc ₹</label>
          <input type="number" value={miscDef} min={0} aria-label="Default misc cost in rupees"
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

        {/* Company legend + filter (consolidated mode only). The coloured dot is the
            key to the row rails — a colour with no legend tells you nothing — and
            clicking it filters, so legend and filter are one control, not two rows. */}
        {companyLegend.length > 1 && (
          <>
            <div className="e-bar-sep"/>
            <label className="e-bar-label">Companies:</label>
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
            <select className="e-sort" value="" onChange={e => { bulkSetCategory(e.target.value); e.target.value = '' }}
              aria-label={`Set a category on ${uncategorised.length} SKUs that have none`}>
              <option value="">Set category…</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </>
        )}

        <div className="e-bar-sep"/>
        <label className="e-bar-label">Sort:</label>
        <select className="e-sort" value={`${sortKey}:${sortDir}`}
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
        <label className="e-bar-label">Columns:</label>
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
      </div>

      {/* ── Desktop Table ── */}
      <div className="e-scroll">
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
              {activePlats.map(pl => (
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
              {vis('log')    && <th className="sh sh-ue w-log">Inbound Logistics</th>}
              {vis('addons') && <th className="sh sh-ue w-addons">Addons</th>}
              {vis('misc')   && <th className="sh sh-ue w-misc">Misc</th>}
              {vis('crpct')  && <th className="sh sh-ue w-crpct" title="Courier return cost — expected return rate %">Return %</th>}
              {vis('cramt')  && <th className="sh sh-ue w-cramt" title="Return cost per unit (courier return charge)">Return ₹</th>}
              {vis('dmgpct') && <th className="sh sh-ue w-dmgpct">Dmg %</th>}
              {vis('dmgamt') && <th className="sh sh-ue w-dmgamt">Dmg ₹</th>}
              <th className="sh sh-prof w-be">Breakeven</th>
              {vis('gst') && <th className="sh sh-tax w-gst">GST</th>}
              <th className="sh sh-prof w-be">Breakeven (GST)</th>
              {vis('profpct') && <th className="sh sh-prof w-profpct">Profit %</th>}
              {vis('profamt') && <th className="sh sh-prof w-profamt">Profit ₹</th>}
              {vis('bsnogst') && <th className="sh sh-bs w-bsnogst">Target Pre-GST</th>}
              <th className="sh sh-bs w-finalbs">Target Post-GST</th>
              {activePlats.map(pl => ([
                <th key={`${pl.id}-ad`} className="sh sh-plat w-plat-ad">AD% / ₹</th>,
                <th key={`${pl.id}-tier`} className="sh sh-plat w-plat-tier">Tier</th>,
                <th key={`${pl.id}-bs`} className="sh sh-bs w-plat-bs">BS</th>
              ]))}
              <th className="sh" style={{ minWidth:28 }}/>
              <th className="sh" style={{ minWidth:28 }}/>
            </tr>
          </thead>

          <tbody>
            {(() => {
              // Order before grouping. Default is SKU name with numeric-aware
              // compare, so N5 · N8 · N9 · N10 reads naturally — the old id-desc
              // order looked arbitrary on screen.
              const cmp = (a, b) => {
                const dir = sortDir === 'asc' ? 1 : -1
                if (sortKey === 'sku')
                  return dir * String(a.sku || '').localeCompare(String(b.sku || ''), undefined, { numeric: true })
                if (sortKey === 'company')
                  return dir * String(a.companyName || '').localeCompare(String(b.companyName || ''))
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
                if (!groups[key]) groups[key] = []
                groups[key].push(row)
              })
              // Named series first (sorted), then ungrouped at end
              const keys = [
                ...Object.keys(groups).filter(k => k).sort((a,b) => a.toLowerCase().localeCompare(b.toLowerCase())),
                ...(groups[''] ? [''] : [])
              ]
              const totalCols = 2
                + (vis('series')?1:0) + (vis('vshort')?1:0) + (vis('vsku')?1:0) + (vis('category')?1:0)
                + 1+(vis('pkg')?1:0)+(vis('log')?1:0)+(vis('addons')?1:0)+(vis('misc')?1:0)
                + (vis('crpct')?1:0)+(vis('cramt')?1:0)+(vis('dmgpct')?1:0)+(vis('dmgamt')?1:0)
                + 2 + (vis('gst')?1:0) + (vis('profpct')?1:0) + (vis('profamt')?1:0)  // BE + BE(GST) + GST + Profit % + Profit ₹
                + (vis('bsnogst')?1:0) + 1                                              // Target Pre-GST + Target Post-GST
                + activePlats.length * 3 + 2

              return keys.flatMap(seriesKey => {
                const groupRows = groups[seriesKey]
                const collapsed = collapsedSeries.has(seriesKey)
                const headerRow = seriesKey ? (
                  <tr key={`series-hdr-${seriesKey}`} className="series-hdr-row">
                    <td colSpan={totalCols}>
                      <button className="series-hdr-btn" onClick={() => toggleSeries(seriesKey)}>
                        <span className="series-hdr-arrow">{collapsed ? '▶' : '▼'}</span>
                        <span className="series-hdr-name">{seriesKey}</span>
                        <span className="series-hdr-count">{groupRows.length}</span>
                      </button>
                    </td>
                  </tr>
                ) : null

                const dataRows = collapsed ? [] : groupRows.map(row => {
                  const c = compute(row, miscDef, profDef, platforms)
                  return (
                <tr key={row.id}
                    className={`e-row ${row.status === STATUS.ERROR ? 'row-error' : ''}${row.companyColor ? ' e-row-co' : ''}`}
                    // Owning-company mark: a coloured left rail. Costs no column
                    // width, and reads peripherally — one odd colour stands out.
                    style={row.companyColor ? { '--co-mark': row.companyColor } : undefined}
                    title={row.companyName ? `Company: ${row.companyName}` : undefined}>

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
                  <td className="ec w-sku sh-sku sticky-col" style={{left:90}}>
                    <div className="ec-sizer-wrap">
                      <span className="ec-sizer mono">{row.sku || 'SHJ-JS-VRI-N6'}</span>
                      <input className="ec-input mono" size={1} value={row.sku} placeholder="SHJ-JS-VRI-N6"
                        onChange={e => upd(row.id, { sku:e.target.value.toUpperCase() })} />
                    </div>
                    {/* Platform alias chips */}
                    {activePlats.some(pl => row.platAliases?.[pl.id]) && (
                      <div className="sku-alias-chips">
                        {activePlats.map(pl => {
                          const alias = row.platAliases?.[pl.id]
                          if (!alias) return null
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
                      <SmartCell
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
                        <input className="ec-input mono" size={1} value={row.vshort} placeholder="VRI"
                          onChange={e => upd(row.id, { vshort:e.target.value.toUpperCase() })} />
                      </div>
                    </td>
                  )}
                  {vis('vsku') && (
                    <td className="ec w-vsku sh-sku">
                      <div className="ec-sizer-wrap">
                        <span className="ec-sizer mono">{row.vsku || 'N6-WHITE'}</span>
                        <input className="ec-input mono" size={1} value={row.vsku} placeholder="N6-WHITE"
                          onChange={e => upd(row.id, { vsku:e.target.value })} />
                      </div>
                    </td>
                  )}
                  {vis('category') && (
                    <td className="ec ec-smart w-cat sh-sku">
                      <SmartCell
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
                  <td className="ec w-price sh-ue">
                    <div className="ec-sizer-wrap">
                      <span className="ec-sizer mono">{row.price || '0'}</span>
                      <input className="ec-input right mono" type="number" size={1} value={row.price}
                        placeholder="0"
                        onChange={e => {
                          const newPrice = e.target.value
                          const newGst = resolveGst(row.gstType || '5', newPrice)
                          upd(row.id, { price: newPrice, gst: String(newGst) })
                        }} />
                    </div>
                  </td>

                  {vis('pkg') && (
                    <td className="ec w-pkg sh-ue">
                      <div className="ec-sizer-wrap">
                        <span className="ec-sizer mono">{row.pkg || '0'}</span>
                        <input className="ec-input right mono" type="number" size={1} value={row.pkg}
                          placeholder="0" onChange={e => upd(row.id, { pkg:e.target.value })} />
                      </div>
                    </td>
                  )}
                  {vis('log') && (
                    <td className="ec w-log sh-ue">
                      <div className="ec-sizer-wrap">
                        <span className="ec-sizer mono">{row.log || '0'}</span>
                        <input className="ec-input right mono" type="number" size={1} value={row.log}
                          placeholder="0" onChange={e => upd(row.id, { log:e.target.value })} />
                      </div>
                    </td>
                  )}
                  {vis('addons') && (
                    <td className="ec w-addons sh-ue">
                      <div className="ec-sizer-wrap">
                        <span className="ec-sizer mono">{row.addons || '0'}</span>
                        <input className="ec-input right mono" type="number" size={1} value={row.addons}
                          placeholder="0" onChange={e => upd(row.id, { addons:e.target.value })} />
                      </div>
                    </td>
                  )}
                  {vis('misc') && (
                    <td className="ec w-misc sh-ue">
                      <div className="ec-sizer-wrap">
                        <span className="ec-sizer mono">{row.misc || String(miscDef)}</span>
                        <input className="ec-input right mono" type="number" size={1} value={row.misc}
                          placeholder={miscDef} onChange={e => upd(row.id, { misc:e.target.value })} />
                      </div>
                    </td>
                  )}
                  {/* CR — bidirectional % ↔ ₹ pair (anchor: Platform.cr_charge) */}
                  <BidirectionalPctAmount
                    pctKey="crPct" amtKey="crAmt"
                    pctValue={row.crPct} amtValue={row.crAmt}
                    pctComputed={numStr(c.crPct)} amtComputed={numStr(c.crAmt)}
                    onUpd={changes => upd(row.id, changes)}
                    pctVisible={vis('crpct')} amtVisible={vis('cramt')}
                    pctClassName="w-crpct" amtClassName="w-cramt"
                    shadeClassName="sh-ue"
                  />
                  {/* Damage — bidirectional % ↔ ₹ pair (anchor: Price) */}
                  <BidirectionalPctAmount
                    pctKey="dmgPct" amtKey="dmgAmt"
                    pctValue={row.dmgPct} amtValue={row.dmgAmt}
                    pctComputed={numStr(c.dmgPct)} amtComputed={numStr(c.dmgAmt)}
                    onUpd={changes => upd(row.id, changes)}
                    pctVisible={vis('dmgpct')} amtVisible={vis('dmgamt')}
                    pctClassName="w-dmgpct" amtClassName="w-dmgamt"
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
                  {/* Breakeven (with GST) — derived */}
                  <td className="ec ec-auto w-be sh-prof">
                    {row.price ? `₹${c.beGst}` : '—'}
                  </td>
                  {/* Profit — bidirectional % ↔ ₹ pair (anchor: Breakeven no-GST) */}
                  <BidirectionalPctAmount
                    pctKey="profPct" amtKey="profAmt"
                    pctValue={row.profPct} amtValue={row.profAmt}
                    pctComputed={numStr(c.profPct)} amtComputed={numStr(c.profAmt)}
                    onUpd={changes => upd(row.id, changes)}
                    pctVisible={vis('profpct')} amtVisible={vis('profamt')}
                    pctClassName="w-profpct" amtClassName="w-profamt"
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
                  {activePlats.map(pl => {
                    const plc      = computePlatform(row, pl, c, miscDef)
                    const override = row.platOverrides?.[pl.id] || {}
                    const alias    = row.platAliases?.[pl.id] || ''
                    return ([
                      <td key={`${pl.id}-ad`} className="ec ec-plat w-plat-ad">
                        <div className="plat-cell-a">
                          {/* % input — placeholder shows back-computed % when ₹ is set */}
                          <div className="plat-field">
                            <span className="plat-field-lbl">%</span>
                            <input
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
                            <input
                              type="number"
                              className="plat-field-inp"
                              value={override.adAmt ?? ''}
                              placeholder={plc.adAmt ?? 0}
                              onChange={e => handlePlatOverride(row.id, pl.id, 'adAmt', e.target.value)}
                            />
                          </div>
                          {/* Alias — always visible; dim placeholder when empty, gold border when set */}
                          <div className="plat-alias-row">
                            <input
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
                    <button onClick={() => delRow(row.id)} className="del-btn">×</button>
                  </td>
                </tr>
                  )
                })
                return [headerRow, ...dataRows].filter(Boolean)
              })
            })()}
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
          </div>
        </div>
      )}

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
              if (!u) return r
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
            {[['Price','price'],['Package','pkg'],['Inbound Logistics','log'],
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
            <div className="m-field"><label>Return %</label>
              <input className="m-input mono right" type="number" value={row.crPct}
                placeholder={c.crPct} onChange={e=>onUpd(row.id,{crPct:e.target.value,crAmt:''})}/>
            </div>
            <div className="m-field"><label>Return ₹</label>
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
            <div className="m-field"><label>Breakeven (GST)</label>
              <input className="m-input mono right" readOnly value={row.price?`₹${c.beGst}`:''} placeholder="—"/>
            </div>
            <div className="m-field"><label>Profit %</label>
              <input className="m-input mono right" type="number" value={row.profPct}
                placeholder={c.profPct} onChange={e=>onUpd(row.id,{profPct:e.target.value,profAmt:''})}/>
            </div>
            <div className="m-field"><label>Profit ₹</label>
              <input className="m-input mono right" type="number" value={row.profAmt}
                placeholder={c.profAmt} onChange={e=>onUpd(row.id,{profAmt:e.target.value,profPct:''})}/>
            </div>
            <div className="m-field"><label>Target Pre-GST</label>
              <input className="m-input mono right" readOnly value={row.price?`₹${c.bsNoGst}`:''} placeholder="—"/>
            </div>
            <div className="m-field"><label>GST Type</label>
              <select className="m-input" aria-label="GST rate" value={row.gstType || '5'}
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
              <label style={{color:'var(--accent)'}}>Target Post-GST</label>
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
