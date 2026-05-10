import { useMemo } from 'react'

/**
 * Operating P&L calculations — full-business profitability with overhead absorption.
 *
 * Core formula (aligned with Unit Economics):
 *   Total Payout  = FK bank_settlement_projected      (cash FK actually wires us)
 *   Total Cost    = casper_breakeven × net_units      (our full cost, already includes misc/overhead allocation)
 *   Net Profit    = Total Payout − Total Cost
 *   Net Margin %  = Net Profit / Total Cost × 100     (return on cost — same anchor as Unit Economics)
 *
 * Absorption variance:
 *   We allocate overhead (rent/electricity/manpower) via `misc_total` per unit in pricing.
 *   If target_monthly_units = 700 and we deliver only 356, we under-recover fixed costs.
 *   Under-absorbed = (target − actual) × misc_per_unit
 *   misc_per_unit is the weighted average of casper_misc_total across delivered SKUs.
 *
 * Status codes for each matched SKU (cleaned up):
 *   'profit'     — Net Payout / unit > breakeven           (selling above cost AND has positive profit)
 *   'thin'       — Net Payout / unit ≥ breakeven but margin < target%   (above cost, below profit goal)
 *                  [reserved — currently same as profit unless target % is enforced]
 *   'loss'       — Net Payout / unit < breakeven           (selling below cost — unit-level loss)
 */
export function useOperatingPnlData(report) {
  return useMemo(() => {
    if (!report?.sku_rows) return emptyResult()

    const rows          = report.sku_rows
    const matchedRows   = rows.filter(r => r.is_matched && r.casper_breakeven != null)
    const unmatchedRows = rows.filter(r => !r.is_matched)

    // Per-SKU calculations
    const enriched = matchedRows.map(r => {
      const payout      = r.bank_settlement_projected || 0
      const netUnits    = r.net_units || 0
      const grossUnits  = r.gross_units || 0
      const breakeven   = r.casper_breakeven || 0
      const breakevenG  = r.casper_breakeven_gst || 0

      const payoutPerU  = netUnits > 0 ? payout / netUnits : 0
      const totalCost   = breakeven * netUnits
      const totalCostG  = breakevenG * netUnits
      const profit      = payout - totalCost
      const profitU     = netUnits > 0 ? profit / netUnits : 0
      // Return-on-cost margin — same anchor as Unit Economics view
      const marginPct   = totalCost > 0 ? (profit / totalCost) * 100 : null
      const returnRate  = grossUnits > 0 ? ((grossUnits - netUnits) / grossUnits) * 100 : 0

      // Status: 'loss' if selling below cost, else 'profit'
      const status = (payoutPerU < breakeven || payoutPerU < 0) ? 'loss' : 'profit'

      return {
        ...r,
        true_payout:      payout,
        true_total_cost:  totalCost,
        true_total_cost_gst: totalCostG,
        true_profit:      profit,
        true_profit_u:    profitU,
        true_margin_pct:  marginPct,
        true_bs_per_u:    payoutPerU,
        true_return_pct:  returnRate,
        true_status:      status,
      }
    })

    // Totals — uniform naming across Unit Economics + Operating P&L
    const totalPayout    = enriched.reduce((s, r) => s + r.true_payout, 0)
    const totalCost      = enriched.reduce((s, r) => s + r.true_total_cost, 0)
    const totalCostGst   = enriched.reduce((s, r) => s + r.true_total_cost_gst, 0)
    const totalNetUnits  = enriched.reduce((s, r) => s + (r.net_units || 0), 0)
    // Net Profit = Payout − Cost (no overhead adjustment yet) — same definition as Unit Economics
    const netProfit      = totalPayout - totalCost
    const netMargin      = totalCost > 0 ? (netProfit / totalCost) * 100 : null
    // After-GST counterparts
    const netProfitGst   = totalPayout - totalCostGst
    const netMarginGst   = totalCostGst > 0 ? (netProfitGst / totalCostGst) * 100 : null

    // Absorption (volume variance against target)
    const targetUnits      = report.target_monthly_units || 0
    // Weighted average misc per unit across delivered SKUs (from live pricing)
    const miscWeighted = enriched.reduce((s, r) => s + (r.casper_misc_total || 0) * (r.net_units || 0), 0)
    const miscPerUnit      = totalNetUnits > 0 ? miscWeighted / totalNetUnits : 0
    const targetAbsorption = targetUnits * miscPerUnit
    const actualAbsorption = totalNetUnits * miscPerUnit
    const absorptionGap    = targetAbsorption - actualAbsorption   // positive = under-absorbed
    const volumePct        = targetUnits > 0 ? (totalNetUnits / targetUnits) * 100 : null

    // "Final" line items = Net Profit minus un-recovered overhead drag
    // (Net Profit already accounts for miscPerUnit × netUnits via breakeven, so the
    //  drag is only the overhead we FAILED to recover on the MISSING units)
    const overheadDrag = Math.max(0, absorptionGap)
    const finalProfit  = netProfit - overheadDrag
    const finalMargin  = totalCost > 0 ? (finalProfit / totalCost) * 100 : null

    // Pattern groupings — "Kill List" (industry term) = SKUs selling below cost
    const killList = enriched
      .filter(r => r.true_status === 'loss')
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
        payout:           totalPayout,
        total_cost:       totalCost,
        total_cost_gst:   totalCostGst,
        net_profit:       netProfit,         // Payout − Cost (matches Unit Economics)
        net_margin:       netMargin,         // Net Profit / Cost × 100
        net_profit_gst:   netProfitGst,
        net_margin_gst:   netMarginGst,      // Net Profit (GST) / Cost (GST) × 100
        overhead_drag:    overheadDrag,
        final_profit:     finalProfit,       // Net Profit − Overhead Drag (real bottom line)
        final_margin:     finalMargin,
        total_units:      totalNetUnits,     // renamed from "Net Units"
        misc_per_unit:    miscPerUnit,
        target_units:     targetUnits,
        target_absorp:    targetAbsorption,
        actual_absorp:    actualAbsorption,
        absorption_gap:   absorptionGap,
        volume_pct:       volumePct,
        kill_count:       killList.length,
        gap_count:        dataGap.length,
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
      payout: 0, total_cost: 0, total_cost_gst: 0,
      net_profit: 0, net_margin: null, net_profit_gst: 0, net_margin_gst: null,
      overhead_drag: 0, final_profit: 0, final_margin: null,
      total_units: 0, misc_per_unit: 0,
      target_units: 0, target_absorp: 0, actual_absorp: 0,
      absorption_gap: 0, volume_pct: null, kill_count: 0, gap_count: 0,
    },
    killList: [],
    returnLeakage: [],
    dataGap: [],
  }
}
