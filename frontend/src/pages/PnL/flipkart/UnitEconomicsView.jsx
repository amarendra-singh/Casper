import { useState, useMemo } from 'react'
import { fmt, fmtN, fmtPct } from './utils'

/**
 * Unit Economics tab — per-SKU profitability breakdown.
 * Shows Profit/unit, Margin, and totals (Cost, Payout, Net Profit) anchored on breakeven.
 */
export default function UnitEconomicsView({ report, augmentedRows }) {
  const [skuFilter, setSkuFilter] = useState('all')
  const [skuSearch, setSkuSearch] = useState('')
  const [sortCol,   setSortCol]   = useState('total_true_profit')
  const [sortDir,   setSortDir]   = useState('asc')

  const profitSkus = augmentedRows.filter(r => (r.total_true_profit ?? 0) > 0)
  const lossSkus   = augmentedRows.filter(r => (r.total_true_profit ?? 0) <= 0)

  const totals = useMemo(() => {
    const totalExpected = augmentedRows.reduce((s, r) => s + ((r.casper_breakeven || 0) * (r.net_units || 0)), 0)
    const totalActual   = augmentedRows.reduce((s, r) => s + (r.bank_settlement_projected || 0), 0)
    const totalProfit   = augmentedRows.reduce((s, r) => s + (r.total_true_profit || 0), 0)
    const overallVarPct = totalExpected > 0 ? ((totalActual - totalExpected) / totalExpected) * 100 : null
    const avgProfitPerUnit = augmentedRows.length
      ? augmentedRows.reduce((s, r) => s + (r.true_profit_per_unit || 0), 0) / augmentedRows.length
      : null
    // Weighted margin = total profit / total cost × 100 (units-weighted, blended)
    let totalProfitNoGst = 0, totalCostNoGst = 0
    let totalProfitGst   = 0, totalCostGst   = 0
    augmentedRows.forEach(r => {
      const u = r.net_units || 0
      if (r.casper_breakeven != null) {
        totalProfitNoGst += (r.profit_no_gst || 0) * u
        totalCostNoGst   += r.casper_breakeven * u
      }
      if (r.casper_breakeven_gst != null) {
        totalProfitGst += (r.profit_with_gst || 0) * u
        totalCostGst   += r.casper_breakeven_gst * u
      }
    })
    const weightedMarginPct    = totalCostNoGst > 0 ? (totalProfitNoGst / totalCostNoGst) * 100 : null
    const weightedMarginGstPct = totalCostGst   > 0 ? (totalProfitGst   / totalCostGst)   * 100 : null
    return { totalExpected, totalActual, totalProfit, overallVarPct, avgProfitPerUnit, weightedMarginPct, weightedMarginGstPct }
  }, [augmentedRows])

  const filteredRows = augmentedRows
    .filter(r => {
      if (skuFilter === 'profit') return (r.total_true_profit ?? 0) > 0
      if (skuFilter === 'loss')   return (r.total_true_profit ?? 0) <= 0
      return true
    })
    .filter(r => !skuSearch || r.platform_sku_name.toLowerCase().includes(skuSearch.toLowerCase()))
    .sort((a, b) => {
      const av = a[sortCol] ?? (sortDir === 'asc' ? Infinity : -Infinity)
      const bv = b[sortCol] ?? (sortDir === 'asc' ? Infinity : -Infinity)
      return sortDir === 'asc' ? av - bv : bv - av
    })

  function toggleSort(col) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }
  const sortIcon = col => sortCol === col ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''

  return (
    <div className="pnl-body pnl-body-full pnl-animate-in">

      {/* Summary bar */}
      <div className="pnl-summary-bar">
        <SumItem label="Total Cost" valClass="muted" value={fmt(totals.totalExpected)} />
        <SumItem label="Total Payout" valClass="gold" value={fmt(totals.totalActual)} />
        <div className="pnl-sum-item">
          <div className="pnl-sum-label">Net Profit</div>
          <div className={`pnl-sum-val ${totals.totalProfit >= 0 ? 'green' : 'red'}`}>
            {totals.totalProfit >= 0 ? '+' : ''}{fmt(totals.totalProfit)}
            {totals.overallVarPct != null && (
              <span className="pnl-sum-pct"> ({totals.overallVarPct >= 0 ? '+' : ''}{totals.overallVarPct.toFixed(1)}%)</span>
            )}
          </div>
        </div>
        <div className="pnl-sum-divider"/>
        <div className="pnl-sum-item">
          <div className="pnl-sum-label">Avg Profit / unit</div>
          <div className={`pnl-sum-val ${(totals.avgProfitPerUnit ?? 0) >= 0 ? 'green' : 'red'}`}>
            {totals.avgProfitPerUnit != null ? ((totals.avgProfitPerUnit >= 0 ? '+' : '') + fmt(totals.avgProfitPerUnit, 2)) : '—'}
          </div>
        </div>
        <div className="pnl-sum-item">
          <div className="pnl-sum-label">Wtd Margin</div>
          <div className={`pnl-sum-val ${(totals.weightedMarginPct ?? 0) >= 0 ? 'green' : 'red'}`}>
            {totals.weightedMarginPct != null ? ((totals.weightedMarginPct >= 0 ? '+' : '') + totals.weightedMarginPct.toFixed(1) + '%') : '—'}
          </div>
        </div>
        <div className="pnl-sum-item">
          <div className="pnl-sum-label">Wtd Margin (after GST)</div>
          <div className={`pnl-sum-val ${(totals.weightedMarginGstPct ?? 0) >= 0 ? 'green' : 'red'}`}>
            {totals.weightedMarginGstPct != null ? ((totals.weightedMarginGstPct >= 0 ? '+' : '') + totals.weightedMarginGstPct.toFixed(1) + '%') : '—'}
          </div>
        </div>
        <div className="pnl-sum-divider"/>
        <SumItem label="Profitable" valClass="green" value={profitSkus.length} />
        <SumItem label="Loss-making" valClass="red"   value={lossSkus.length} />
        <div className="pnl-sum-divider"/>
        <SumItem label="Total Units" value={fmtN(report.net_units)} />
        {report.unmatched_skus > 0 && (
          <SumItem label="No Pricing Data" valClass="amber" value={`${report.unmatched_skus} SKUs hidden`} />
        )}
      </div>

      {/* Controls */}
      <div className="pnl-tbl-controls">
        <input className="pnl-search" placeholder="Search SKU…" value={skuSearch}
          onChange={e => setSkuSearch(e.target.value)} />
        <div className="pnl-filter-pills">
          {[
            { key: 'all',    label: `All (${augmentedRows.length})` },
            { key: 'profit', label: `Profitable (${profitSkus.length})` },
            { key: 'loss',   label: `Loss-making (${lossSkus.length})` },
          ].map(f => (
            <button key={f.key}
              className={`pnl-fpill${skuFilter === f.key ? ' active' : ''}`}
              onClick={() => setSkuFilter(f.key)}>{f.label}</button>
          ))}
        </div>
        <span className="pnl-row-count">{filteredRows.length} SKUs</span>
      </div>

      {/* Table */}
      <div className="pnl-tbl-wrap">
        <table className="pnl-tbl">
          <thead>
            <tr>
              <th className="pnl-th sticky-col">SKU</th>
              <SortTh col="net_units"            label="Units Sold"                  sub="after returns" sortCol={sortCol} sortDir={sortDir} onClick={toggleSort}/>
              <SortTh col="return_rate_pct"     label="Return Rate"                  sortCol={sortCol} sortDir={sortDir} onClick={toggleSort}/>
              <SortTh col="fees_per_unit"       label="Platform Fee"                 sub="per unit · commission + tax" sortCol={sortCol} sortDir={sortDir} onClick={toggleSort}/>
              <SortTh col="fk_bs_per_unit"      label="Net Payout"                   sub="per unit · Flipkart settlement" sortCol={sortCol} sortDir={sortDir} onClick={toggleSort}/>
              <SortTh col="casper_breakeven"    label="Breakeven"                    sub="per unit · cost recovery" sortCol={sortCol} sortDir={sortDir} onClick={toggleSort}/>
              <SortTh col="casper_breakeven_gst" label="Breakeven + GST"             sub="per unit · cost + 5% GST" sortCol={sortCol} sortDir={sortDir} onClick={toggleSort}/>
              <SortTh col="profit_no_gst"       label="Profit / unit"                sub="Payout − Breakeven" primary sortCol={sortCol} sortDir={sortDir} onClick={toggleSort}/>
              <SortTh col="real_margin_pct"     label="Margin"                       sub="Profit ÷ Breakeven" primary sortCol={sortCol} sortDir={sortDir} onClick={toggleSort}/>
              <SortTh col="profit_with_gst"     label="Profit / unit (after GST)"    sub="Payout − Breakeven+GST" primary sortCol={sortCol} sortDir={sortDir} onClick={toggleSort}/>
              <SortTh col="margin_gst_pct"      label="Margin (after GST)"           sub="Profit ÷ Breakeven+GST" primary sortCol={sortCol} sortDir={sortDir} onClick={toggleSort}/>
              <SortTh col="casper_expected_bs"  label="Target Payout"                sub="per unit · cost + profit + GST" sortCol={sortCol} sortDir={sortDir} onClick={toggleSort}/>
              <SortTh col="expected_total"      label="Total Cost"                   sub="Breakeven × Units" sortCol={sortCol} sortDir={sortDir} onClick={toggleSort}/>
              <SortTh col="total_earned"        label="Total Payout"                 sub="Settled by Flipkart" sortCol={sortCol} sortDir={sortDir} onClick={toggleSort}/>
              <SortTh col="total_true_profit"   label="Net Profit"                   sub="Total Payout − Total Cost" primary sortCol={sortCol} sortDir={sortDir} onClick={toggleSort}/>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map(row => <PnLRow key={row.id} row={row} />)}
            {filteredRows.length === 0 && (
              <tr><td colSpan={15} className="pnl-td center" style={{ padding: '32px', color: 'var(--text-3)' }}>
                No SKUs match your filter
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Small presentational helpers ────────────────────────────────────────────

function SumItem({ label, value, valClass = '' }) {
  return (
    <div className="pnl-sum-item">
      <div className="pnl-sum-label">{label}</div>
      <div className={`pnl-sum-val ${valClass}`}>{value}</div>
    </div>
  )
}

function SortTh({ col, label, sub, primary, sortCol, sortDir, onClick }) {
  const icon = sortCol === col ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''
  return (
    <th className={`pnl-th sortable${primary ? ' pnl-th-primary' : ''}`} onClick={() => onClick(col)}>
      <span className="pnl-th-label">{label}</span>
      {sub && <span className="pnl-th-sub">{sub}</span>}
      {icon}
    </th>
  )
}

function PnLRow({ row }) {
  const profitNo   = row.profit_no_gst
  const profitWith = row.profit_with_gst
  const totalP     = row.total_true_profit
  const noCls      = profitNo == null   ? '' : profitNo > 0   ? 'positive' : 'negative'
  const withCls    = profitWith == null ? '' : profitWith > 0 ? 'positive' : 'negative'
  const totalCls   = totalP == null     ? '' : totalP > 0     ? 'positive' : 'negative'

  return (
    <tr className={`pnl-tr${profitWith != null && profitWith < 0 ? ' pnl-tr-loss' : ''}`}>
      <td className="pnl-td sku-col sticky-col">
        <span className="pnl-sku-name">{row.platform_sku_name}</span>
      </td>
      <td className="pnl-td center"><span className="pnl-units-net">{fmtN(row.net_units)}</span></td>
      <td className="pnl-td center">
        {row.return_rate_pct != null
          ? <span className={`pnl-ret-rate ${row.return_rate_pct > 40 ? 'high' : row.return_rate_pct > 20 ? 'mid' : 'low'}`}>{fmtPct(row.return_rate_pct)}</span>
          : '—'}
      </td>
      <td className="pnl-td right mono red">{row.fees_per_unit != null ? fmt(row.fees_per_unit, 1) : '—'}</td>
      <td className="pnl-td right mono">{row.fk_bs_per_unit != null ? fmt(row.fk_bs_per_unit, 1) : '—'}</td>
      <td className="pnl-td right mono muted">{row.casper_breakeven != null ? fmt(row.casper_breakeven, 1) : '—'}</td>
      <td className="pnl-td right mono muted">{row.casper_breakeven_gst != null ? fmt(row.casper_breakeven_gst, 1) : '—'}</td>
      <td className={`pnl-td right mono pnl-td-primary variance ${noCls}`}>
        {profitNo == null ? '—' : (profitNo >= 0 ? '+' : '') + fmt(profitNo, 1)}
      </td>
      <td className="pnl-td center pnl-td-primary">
        {row.real_margin_pct == null ? '—' : (
          <span className={`pnl-ret-rate ${row.real_margin_pct > 0 ? 'low' : row.real_margin_pct > -10 ? 'mid' : 'high'}`}>
            {row.real_margin_pct >= 0 ? '+' : ''}{row.real_margin_pct.toFixed(1)}%
          </span>
        )}
      </td>
      <td className={`pnl-td right mono pnl-td-primary variance ${withCls}`}>
        {profitWith == null ? '—' : (profitWith >= 0 ? '+' : '') + fmt(profitWith, 1)}
      </td>
      <td className="pnl-td center pnl-td-primary">
        {row.margin_gst_pct == null ? '—' : (
          <span className={`pnl-ret-rate ${row.margin_gst_pct > 0 ? 'low' : row.margin_gst_pct > -10 ? 'mid' : 'high'}`}>
            {row.margin_gst_pct >= 0 ? '+' : ''}{row.margin_gst_pct.toFixed(1)}%
          </span>
        )}
      </td>
      <td className="pnl-td right mono muted">{fmt(row.casper_expected_bs, 1)}</td>
      <td className="pnl-td right mono muted">{row.expected_total != null ? fmt(row.expected_total) : '—'}</td>
      <td className="pnl-td right mono">{row.total_earned != null ? fmt(row.total_earned) : '—'}</td>
      <td className={`pnl-td right mono pnl-td-primary variance ${totalCls}`}>
        {totalP == null ? '—' : (totalP >= 0 ? '+' : '') + fmt(totalP)}
      </td>
    </tr>
  )
}
