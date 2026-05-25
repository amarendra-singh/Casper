import { useMemo } from 'react'

/**
 * Derives all computed fields for a platform P&L report.
 * Platform-generic: works for Flipkart, Meesho, and any future platform
 * because FK-specific fields (commission, fixed_fee, taxes_gst, rewards) are
 * simply 0/null for other platforms — feesPerUnit still sums correctly.
 *
 *   augmentedRows: matched SKU rows + per-unit cost/variance/margin fields
 *   insightsData:  aggregate totals + chart data for the Insights tab
 */
export function useReportData(report) {
  const augmentedRows = useMemo(() => {
    const matched = (report?.sku_rows || []).filter(r => r.is_matched)
    return matched.map(r => {
      const fkBsPerUnit = (r.bank_settlement_projected != null && r.net_units)
        ? r.bank_settlement_projected / r.net_units : null
      const varPerUnit = (fkBsPerUnit != null && r.casper_breakeven != null)
        ? fkBsPerUnit - r.casper_breakeven : null
      const varTotal = (varPerUnit != null && r.net_units != null)
        ? varPerUnit * r.net_units : null
      const feesPerUnit = r.net_units ? (
        (Math.abs(r.commission_fee || 0) + Math.abs(r.collection_fee || 0) +
         Math.abs(r.fixed_fee || 0) +
         Math.abs(r.taxes_gst || 0) + Math.abs(r.taxes_tcs || 0) + Math.abs(r.taxes_tds || 0)
         - Math.abs(r.rewards_benefits || 0)) / r.net_units
      ) : null
      const totalEarned   = r.bank_settlement_projected ?? null
      const expectedTotal = (r.casper_breakeven != null && r.net_units != null)
        ? r.casper_breakeven * r.net_units : null

      const profitNoGst = (fkBsPerUnit != null && r.casper_breakeven != null)
        ? fkBsPerUnit - r.casper_breakeven : null
      const profitWithGst = (fkBsPerUnit != null && r.casper_breakeven_gst != null)
        ? fkBsPerUnit - r.casper_breakeven_gst : null
      const realMarginPct = (fkBsPerUnit != null && r.casper_breakeven)
        ? ((fkBsPerUnit - r.casper_breakeven) / r.casper_breakeven) * 100 : null
      const marginGstPct = (fkBsPerUnit != null && r.casper_breakeven_gst)
        ? ((fkBsPerUnit - r.casper_breakeven_gst) / r.casper_breakeven_gst) * 100 : null

      return {
        ...r,
        fk_bs_per_unit: fkBsPerUnit,
        true_profit_per_unit: varPerUnit,
        total_true_profit: varTotal,
        fees_per_unit: feesPerUnit,
        total_earned: totalEarned,
        expected_total: expectedTotal,
        profit_no_gst: profitNoGst,
        profit_with_gst: profitWithGst,
        real_margin_pct: realMarginPct,
        margin_gst_pct: marginGstPct,
      }
    })
  }, [report])

  const insightsData = useMemo(() => {
    if (!report) return null
    const rows    = report.sku_rows || []
    const matched = rows.filter(r => r.is_matched && r.variance_bs != null)
    const totalActualBS    = matched.reduce((s, r) => s + (r.bank_settlement_projected || 0), 0)
    const totalExpectedBS  = matched.reduce((s, r) => s + (r.casper_expected_bs || 0) * (r.net_units || 0), 0)
    const netVariance      = totalActualBS - totalExpectedBS
    const totalRevShipping = rows.reduce((s, r) => s + Math.abs(r.reverse_shipping_fee || 0), 0)
    const totalCommission  = rows.reduce((s, r) => s + Math.abs(r.commission_fee || 0), 0)
    const totalCollection  = rows.reduce((s, r) => s + Math.abs(r.collection_fee || 0), 0)
    const totalGST         = rows.reduce((s, r) => s + Math.abs(r.taxes_gst || 0), 0)
    const totalTax         = rows.reduce((s, r) => s + Math.abs(r.taxes_tcs || 0) + Math.abs(r.taxes_tds || 0), 0)
    const totalRewards     = rows.reduce((s, r) => s + (r.rewards_benefits || 0), 0)
    const totalRTO         = rows.reduce((s, r) => s + (r.rto_units || 0), 0)
    const totalRVP         = rows.reduce((s, r) => s + (r.rvp_units || 0), 0)
    const totalCancelled   = rows.reduce((s, r) => s + (r.cancelled_units || 0), 0)

    const sortedByVar = [...matched].sort((a, b) => b.variance_bs - a.variance_bs)
    const varianceChartData = [
      ...sortedByVar.filter(r => r.variance_bs < 0).slice(-6),
      ...sortedByVar.filter(r => r.variance_bs > 0).slice(0, 6),
    ].map(r => ({
      name:     r.platform_sku_name.split('-').slice(-2).join('-'),
      fullName: r.platform_sku_name,
      variance: Math.round(r.variance_bs),
    }))

    const marginBrackets = [
      { label: 'Loss',   count: rows.filter(r => (r.net_margin_pct||0) < 0).length,                                  color: '#ef4444' },
      { label: '0–20%',  count: rows.filter(r => (r.net_margin_pct||0) >= 0  && (r.net_margin_pct||0) < 20).length, color: '#f97316' },
      { label: '20–50%', count: rows.filter(r => (r.net_margin_pct||0) >= 20 && (r.net_margin_pct||0) < 50).length, color: '#eab308' },
      { label: '50–80%', count: rows.filter(r => (r.net_margin_pct||0) >= 50 && (r.net_margin_pct||0) < 80).length, color: '#22c55e' },
      { label: '80%+',   count: rows.filter(r => (r.net_margin_pct||0) >= 80).length,                               color: '#16a34a' },
    ]

    const beatingSkus = matched.filter(r => r.variance_bs > 0)
    const missingSkus = matched.filter(r => r.variance_bs < 0)

    return {
      totalActualBS, totalExpectedBS, netVariance,
      totalRevShipping, totalCommission, totalCollection, totalGST, totalTax, totalRewards,
      totalRTO, totalRVP, totalCancelled,
      varianceChartData, marginBrackets,
      beatingCount: beatingSkus.length,
      missingCount: missingSkus.length,
      beatingTotal: beatingSkus.reduce((s, r) => s + r.variance_bs, 0),
      missingTotal: missingSkus.reduce((s, r) => s + r.variance_bs, 0),
    }
  }, [report])

  return { augmentedRows, insightsData }
}
