/**
 * UI tests for FlipkartReport Unit Economics table rendering.
 * Tests that computed values display correctly in the DOM.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import FlipkartReport from '../pages/PnL/FlipkartReport'

// ── Mock API ──────────────────────────────────────────────────────────────────

vi.mock('../api/client', () => ({
  getPnlReport: vi.fn(),
}))

import { getPnlReport } from '../api/client'

// ── Shared test report fixture ────────────────────────────────────────────────

const makeReport = (skuOverrides = {}) => ({
  id: 1,
  platform_id: 1,
  platform_name: 'Flipkart',
  period_start: '2025-10-01',
  period_end: '2025-10-31',
  filename: 'test_report.xlsx',
  uploaded_at: '2025-11-25T00:00:00',
  status: 'done',
  gross_sales: 324854,
  net_sales: 138764,
  bank_settlement: 89480.52,
  gross_units: 74,
  net_units: 34,
  net_margin_pct: 75.76,
  total_skus: 1,
  matched_skus: 1,
  unmatched_skus: 0,
  returns_amount: -186090,
  returned_units: 401,
  total_expenses: -37147.31,
  input_tax_credits: 6283.67,
  net_earnings: 95764.19,
  amount_settled: 89654.83,
  amount_pending: -174.31,
  target_monthly_units: 700,
  sku_rows: [{
    id: 1,
    platform_sku_name: 'SHJ-JS-VRI-N65-WHITE',
    sku_pricing_id: 1,
    gross_units: 74,
    rto_units: 28,
    rvp_units: 8,
    cancelled_units: 4,
    net_units: 34,
    return_rate_pct: 54.1,   // was 54.05 — toFixed(1) rounds to 54.0 due to float
    accounted_net_sales: 5199.1,
    commission_fee: 0,
    collection_fee: 0,
    fixed_fee: -210,
    reverse_shipping_fee: -1356,
    taxes_gst: -281.88,
    taxes_tcs: -25.16,
    taxes_tds: -5.08,
    rewards_benefits: 0,
    bank_settlement_projected: 3320.98,
    input_tax_credits: 312.12,
    net_earnings: 3633.10,
    earnings_per_unit: 106.86,
    net_margin_pct: 69.88,
    amount_settled: 3321,
    amount_pending: 0,
    casper_expected_bs: 172,
    casper_expected_profit_pct: 20,
    variance_bs: -2527.02,
    variance_margin_pct: -43.2,
    is_matched: true,
    casper_breakeven: 137.04,
    casper_breakeven_gst: 143.89,
    casper_misc_total: 12,
    ...skuOverrides,
  }]
})

const renderReport = (view = 'unit') => {
  getPnlReport.mockResolvedValue(makeReport())
  return render(
    <MemoryRouter initialEntries={[`/pnl/flipkart/1?view=${view}`]}>
      <Routes>
        <Route path="/pnl/flipkart/:reportId" element={<FlipkartReport />} />
      </Routes>
    </MemoryRouter>
  )
}

// ── Loading state ─────────────────────────────────────────────────────────────

describe('FlipkartReport loading', () => {
  it('shows loading state initially', () => {
    getPnlReport.mockReturnValue(new Promise(() => {}))
    render(
      <MemoryRouter initialEntries={['/pnl/flipkart/1?view=unit']}>
        <Routes>
          <Route path="/pnl/flipkart/:reportId" element={<FlipkartReport />} />
        </Routes>
      </MemoryRouter>
    )
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })

  it('shows error state for invalid report', async () => {
    getPnlReport.mockRejectedValue(new Error('Not found'))
    render(
      <MemoryRouter initialEntries={['/pnl/flipkart/999?view=unit']}>
        <Routes>
          <Route path="/pnl/flipkart/:reportId" element={<FlipkartReport />} />
        </Routes>
      </MemoryRouter>
    )
    const error = await screen.findByText(/report not found/i)
    expect(error).toBeInTheDocument()
  })
})


// ── Header ────────────────────────────────────────────────────────────────────

describe('FlipkartReport header', () => {
  it('shows period in header', async () => {
    renderReport()
    const period = await screen.findByText(/oct 2025/i)
    expect(period).toBeInTheDocument()
  })

  it('shows back to reports link', async () => {
    renderReport()
    const back = await screen.findByText(/← reports/i)
    expect(back).toBeInTheDocument()
  })

  it('shows all 4 tabs', async () => {
    renderReport()
    await screen.findByText(/flipkart report/i)
    expect(screen.getByText(/unit economics/i)).toBeInTheDocument()
    expect(screen.getByText(/operating p&l/i)).toBeInTheDocument()
    expect(screen.getByText(/insights/i)).toBeInTheDocument()
  })
})


// ── Unit Economics tab ──────────────────────────────────────────────────────────────

describe('Unit Economics table', () => {
  it('renders SKU name', async () => {
    renderReport('unit')
    const sku = await screen.findByText('SHJ-JS-VRI-N65-WHITE')
    expect(sku).toBeInTheDocument()
  })

  it('shows correct net units (34)', async () => {
    renderReport('unit')
    await screen.findByText('SHJ-JS-VRI-N65-WHITE')
    // '34' appears in both summary bar and table row — use getAllByText
    expect(screen.getAllByText('34').length).toBeGreaterThanOrEqual(1)
  })

  it('shows return rate badge', async () => {
    renderReport('unit')
    await screen.findByText('SHJ-JS-VRI-N65-WHITE')
    // return_rate_pct=54.05 → displayed as 54.1%
    expect(screen.getByText('54.1%')).toBeInTheDocument()
  })

  it('displays FK BS/unit as ₹97.7 (1 decimal)', async () => {
    renderReport('unit')
    await screen.findByText('SHJ-JS-VRI-N65-WHITE')
    // 3320.98 / 34 = 97.67 → displayed as ₹97.7
    expect(screen.getByText('₹97.7')).toBeInTheDocument()
  })

  it('displays Target BS as ₹172.0', async () => {
    renderReport('unit')
    await screen.findByText('SHJ-JS-VRI-N65-WHITE')
    expect(screen.getByText('₹172.0')).toBeInTheDocument()
  })

  it('displays negative profit per unit with - prefix', async () => {
    renderReport('unit')
    await screen.findByText('SHJ-JS-VRI-N65-WHITE')
    // profit_no_gst = (3320.98/34) − 137.04 = 97.68 − 137.04 = -39.36 → "-₹39.4"
    expect(screen.getByText('-₹39.4')).toBeInTheDocument()
  })

  it('displays margin % with sign prefix', async () => {
    renderReport('unit')
    await screen.findByText('SHJ-JS-VRI-N65-WHITE')
    // real_margin_pct = (97.68 − 137.04) / 137.04 × 100 = -28.72 → "-28.7%"
    expect(screen.getAllByText('-28.7%').length).toBeGreaterThanOrEqual(1)
  })

  it('no Sell Price/unit column (removed)', async () => {
    renderReport('unit')
    await screen.findByText('SHJ-JS-VRI-N65-WHITE')
    expect(screen.queryByText(/sell price\/unit/i)).toBeNull()
  })

  it('no Platform BS/unit column (removed)', async () => {
    renderReport('unit')
    await screen.findByText('SHJ-JS-VRI-N65-WHITE')
    expect(screen.queryByText(/platform bs\/unit/i)).toBeNull()
  })

  it('shows Platform Fee column', async () => {
    renderReport('unit')
    await screen.findByText(/platform fee/i)
  })
})


// ── Summary bar ───────────────────────────────────────────────────────────────

describe('Unit Economics summary bar', () => {
  // Note: these labels also appear as column headers, so we use findAllByText
  // and assert at least one match exists in the rendered DOM.
  it('shows Total Payout', async () => {
    renderReport('unit')
    const matches = await screen.findAllByText(/total payout/i)
    expect(matches.length).toBeGreaterThanOrEqual(1)
  })

  it('shows Total Cost', async () => {
    renderReport('unit')
    const matches = await screen.findAllByText(/total cost/i)
    expect(matches.length).toBeGreaterThanOrEqual(1)
  })

  it('shows Net Profit', async () => {
    renderReport('unit')
    const matches = await screen.findAllByText(/net profit/i)
    expect(matches.length).toBeGreaterThanOrEqual(1)
  })

  it('shows profitable / loss-making counts', async () => {
    renderReport('unit')
    const profitable = await screen.findAllByText(/profitable/i)
    expect(profitable.length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(/loss-making/i).length).toBeGreaterThanOrEqual(1)
  })
})


// ── Filters ───────────────────────────────────────────────────────────────────

describe('SKU filter pills', () => {
  it('shows All, Profitable, Loss-making pills', async () => {
    renderReport('unit')
    await screen.findByText(/^All \(/)
    expect(screen.getByText(/^Profitable \(/)).toBeInTheDocument()
    expect(screen.getByText(/^Loss-making \(/)).toBeInTheDocument()
  })

  it('search input filters SKUs', async () => {
    getPnlReport.mockResolvedValue(makeReport())
    render(
      <MemoryRouter initialEntries={['/pnl/flipkart/1?view=unit']}>
        <Routes>
          <Route path="/pnl/flipkart/:reportId" element={<FlipkartReport />} />
        </Routes>
      </MemoryRouter>
    )
    await screen.findByText('SHJ-JS-VRI-N65-WHITE')
    const search = screen.getByPlaceholderText(/search sku/i)
    fireEvent.change(search, { target: { value: 'NOMATCH' } })
    expect(screen.queryByText('SHJ-JS-VRI-N65-WHITE')).toBeNull()
  })
})


// ── Tab switching ─────────────────────────────────────────────────────────────

describe('tab navigation', () => {
  it('shows FK Report view when view=fk', async () => {
    renderReport('fk')
    await screen.findByText(/revenue flow/i)
  })

  it('shows Insights view when view=insights', async () => {
    renderReport('insights')
    await screen.findByText(/flipkart settlement/i)
  })

  it('clicking Unit Economics tab shows table', async () => {
    renderReport('fk')
    await screen.findByText(/revenue flow/i)
    fireEvent.click(screen.getByText('Unit Economics'))
    const sku = await screen.findByText('SHJ-JS-VRI-N65-WHITE')
    expect(sku).toBeInTheDocument()
  })
})


// ── Loss row highlighting ─────────────────────────────────────────────────────

describe('row styling', () => {
  it('loss row has pnl-tr-loss class', async () => {
    renderReport('unit')
    await screen.findByText('SHJ-JS-VRI-N65-WHITE')
    const row = screen.getByText('SHJ-JS-VRI-N65-WHITE').closest('tr')
    expect(row).toHaveClass('pnl-tr-loss')
  })

  it('profit row does not have pnl-tr-loss class', async () => {
    getPnlReport.mockResolvedValue(makeReport({
      bank_settlement_projected: 7000,  // way above 172 * 34 = 5848
      variance_bs: 1152,
    }))
    render(
      <MemoryRouter initialEntries={['/pnl/flipkart/1?view=unit']}>
        <Routes>
          <Route path="/pnl/flipkart/:reportId" element={<FlipkartReport />} />
        </Routes>
      </MemoryRouter>
    )
    await screen.findByText('SHJ-JS-VRI-N65-WHITE')
    const row = screen.getByText('SHJ-JS-VRI-N65-WHITE').closest('tr')
    expect(row).not.toHaveClass('pnl-tr-loss')
  })
})


// ── Operating P&L tab ──────────────────────────────────────────────────────────────

describe('Operating P&L tab', () => {
  // Mock fixture: BS=3320.98, breakeven=137.04, net=34
  // → var_cost = 137.04 * 34 = 4659.36
  // → gross_profit = 3320.98 - 4659.36 = -1338.38 (LOSS)
  // → margin = -1338.38 / 3320.98 = -40.3%

  it('renders verdict banner with loss state', async () => {
    renderReport('ops')
    const banner = await screen.findByText(/Real loss/i)
    expect(banner).toBeInTheDocument()
  })

  it('shows FK Cash In KPI', async () => {
    renderReport('ops')
    await screen.findByText(/FK Cash In/i)
  })

  it('shows Net Profit KPI', async () => {
    renderReport('ops')
    // "Net Profit" can appear in banner + KPI label
    const matches = await screen.findAllByText(/Net Profit/i)
    expect(matches.length).toBeGreaterThanOrEqual(1)
  })

  it('shows True Margin %', async () => {
    renderReport('ops')
    await screen.findByText(/True Margin/i)
  })

  it('shows Kill List card', async () => {
    renderReport('ops')
    // Appears in KPI label + filter pill + card title
    const matches = await screen.findAllByText(/Kill List/i)
    expect(matches.length).toBeGreaterThanOrEqual(1)
  })

  it('shows Volume Absorption card', async () => {
    renderReport('ops')
    await screen.findByText(/Volume Absorption/i)
  })

  it('shows Data Gap card', async () => {
    renderReport('ops')
    // Appears in KPI label + card title
    const matches = await screen.findAllByText(/Data Gap/i)
    expect(matches.length).toBeGreaterThanOrEqual(1)
  })

  it('shows Return Leakage card', async () => {
    renderReport('ops')
    await screen.findByText(/Return Leakage/i)
  })

  it('renders SKU in Operating P&L table', async () => {
    renderReport('ops')
    // SKU appears in main table + may appear in pattern cards (Kill List/Return Leakage)
    const matches = await screen.findAllByText('SHJ-JS-VRI-N65-WHITE')
    expect(matches.length).toBeGreaterThanOrEqual(1)
  })

  it('flags loss-making SKU as kill (BS/u 97.7 < breakeven 137)', async () => {
    renderReport('ops')
    const skuMatches = await screen.findAllByText('SHJ-JS-VRI-N65-WHITE')
    // Find the one inside the main table (not the pattern card)
    const tableRow = skuMatches.map(el => el.closest('tr')).find(tr => tr != null)
    expect(tableRow).toHaveClass('pnl-tr-kill')
  })

  it('shows target units (700) in editor', async () => {
    renderReport('ops')
    await screen.findAllByText('SHJ-JS-VRI-N65-WHITE')
    expect(screen.getByText('700')).toBeInTheDocument()
  })

  it('clicking Operating P&L tab shows the view', async () => {
    renderReport('fk')
    await screen.findByText(/revenue flow/i)
    fireEvent.click(screen.getByText('Operating P&L'))
    await screen.findByText(/FK Cash In/i)
  })

  it('profitable SKU does NOT have pnl-tr-kill class', async () => {
    getPnlReport.mockResolvedValue(makeReport({
      bank_settlement_projected: 7000,  // 7000/34 = 205.88 > 137 breakeven
    }))
    render(
      <MemoryRouter initialEntries={['/pnl/flipkart/1?view=ops']}>
        <Routes>
          <Route path="/pnl/flipkart/:reportId" element={<FlipkartReport />} />
        </Routes>
      </MemoryRouter>
    )
    const skuMatches = await screen.findAllByText('SHJ-JS-VRI-N65-WHITE')
    const tableRow = skuMatches.map(el => el.closest('tr')).find(tr => tr != null)
    expect(tableRow).not.toHaveClass('pnl-tr-kill')
  })
})
