import { useMemo } from 'react'

/**
 * Operating P&L calculations — full-business profitability with overhead absorption.
 *
 * Core formula:
 *   Revenue       = FK bank_settlement_projected      (cash FK actually wires us)
 *   Variable Cost = casper_breakeven × net_units      (our full cost, already includes misc/overhead allocation)
 *   Net Profit    = Revenue − Variable Cost
 *   True Margin % = Net Profit / Revenue              (user preference: denominator = money received from FK)
 *
 * Absorption variance:
 *   We allocate overhead (rent/electricity/manpower) via `misc_total` per unit in pricing.
 *   If target_monthly_units = 700 and we deliver only 356, we under-recover fixed costs.
 *   Under-absorbed = (target − actual) × misc_per_unit
 *   misc_per_unit is the weighted average of casper_misc_total across delivered SKUs.
 *
 * Status codes for each matched SKU:
 *   'profit'     — profit per unit > 0
 *   'loss'       — profit per unit ≤ 0 but BS/unit ≥ breakeven (selling above cost but
 *                  producing below target profit)  [actually impossible — if BS≥BE then profit≥0]
 *   'kill'       — BS/unit < 0 OR BS/unit < breakeven (selling below cost ⇒ unit-level loss)
 */
export function useOperatingPnlData(report) {
  return useMemo(() => {
    if (!report?.sku_rows) return emptyResult()

    const rows          = report.sku_rows
    const matchedRows   = rows.filter(r => r.is_matched && r.casper_breakeven != null)
    const unmatchedRows = rows.filter(r => !r.is_matched)

    // Per-SKU calculations
    const enriched = matchedRows.map(r => {
      const revenue    = r.bank_settlement_projected || 0
      const netUnits   = r.net_units || 0
      const grossUnits = r.gross_units || 0
      const breakeven  = r.casper_breakeven || 0

      const bsPerUnit  = netUnits > 0 ? revenue / netUnits : 0
      const varCost    = breakeven * netUnits
      const profit     = revenue - varCost
      const profitU    = netUnits > 0 ? profit / netUnits : 0
      const marginPct  = revenue !== 0 ? (profit / revenue) * 100 : null
      const returnRate = grossUnits > 0 ? ((grossUnits - netUnits) / grossUnits) * 100 : 0

      // Status
      let status = 'profit'
      if (bsPerUnit < breakeven || bsPerUnit < 0) status = 'kill'
      else if (profit <= 0)                         status = 'loss'

      return {
        ...r,
        true_revenue:    revenue,
        true_var_cost:   varCost,
        true_profit:     profit,
        true_profit_u:   profitU,
        true_margin_pct: marginPct,
        true_bs_per_u:   bsPerUnit,
        true_return_pct: returnRate,
        true_status:     status,
      }
    })

    // Totals
    const totalRevenue  = enriched.reduce((s, r) => s + r.true_revenue, 0)
    const totalVarCost  = enriched.reduce((s, r) => s + r.true_var_cost, 0)
    const totalNetUnits = enriched.reduce((s, r) => s + (r.net_units || 0), 0)
    const grossProfit   = totalRevenue - totalVarCost
    const grossMargin   = totalRevenue !== 0 ? (grossProfit / totalRevenue) * 100 : null

    // Absorption (volume variance against target)
    const targetUnits      = report.target_monthly_units || 0
    // Weighted average misc per unit across delivered SKUs (from live pricing)
    const miscWeighted = enriched.reduce((s, r) => s + (r.casper_misc_total || 0) * (r.net_units || 0), 0)
    const miscPerUnit      = totalNetUnits > 0 ? miscWeighted / totalNetUnits : 0
    const targetAbsorption = targetUnits * miscPerUnit
    const actualAbsorption = totalNetUnits * miscPerUnit
    const absorptionGap    = targetAbsorption - actualAbsorption   // positive = under-absorbed
    const volumePct        = targetUnits > 0 ? (totalNetUnits / targetUnits) * 100 : null

    // Final net profit = gross profit − any un-recovered overhead
    // (gross already accounts for miscPerUnit × netUnits via breakeven, so the "extra"
    //  drag is only the overhead we FAILED to recover on the missing units)
    const overheadDrag = Math.max(0, absorptionGap)
    const netProfit    = grossProfit - overheadDrag
    const netMarginPct = totalRevenue !== 0 ? (netProfit / totalRevenue) * 100 : null

    // Pattern groupings
    const killList = enriched
      .filter(r => r.true_status === 'kill')
      .sort((a, b) => a.true_profit_u - b.true_profit_u)

    const returnLeakage = enriched
      .filter(r => r.true_return_pct >= 30)
      .sort((a, b) => b.true_return_pct - a.true_return_pct)

    const dataGap = unmatchedRows
      .slice()
      .sort((a, b) => (b.gross_units || 0) - (a.gross_units || 0))

    return {
      rows: enriched,
      totals: {
        revenue:         totalRevenue,
        var_cost:        totalVarCost,
        gross_profit:    grossProfit,
        gross_margin:    grossMargin,
        overhead_drag:   overheadDrag,
        net_profit:      netProfit,
        net_margin:      netMarginPct,
        net_units:       totalNetUnits,
        misc_per_unit:   miscPerUnit,
        target_units:    targetUnits,
        target_absorp:   targetAbsorption,
        actual_absorp:   actualAbsorption,
        absorption_gap:  absorptionGap,
        volume_pct:      volumePct,
        kill_count:      killList.length,
        gap_count:       dataGap.length,
      },
      killList,
      returnLeakage,
      dataGap,
    }
  }, [report])
}

function emptyResult() {
  return {
    rows: [],
    totals: {
      revenue: 0, var_cost: 0, gross_profit: 0, gross_margin: null,
      overhead_drag: 0, net_profit: 0, net_margin: null, net_units: 0,
      misc_per_unit: 0, target_units: 0, target_absorp: 0, actual_absorp: 0,
      absorption_gap: 0, volume_pct: null, kill_count: 0, gap_count: 0,
    },
    killList: [],
    returnLeakage: [],
    dataGap: [],
  }
}
