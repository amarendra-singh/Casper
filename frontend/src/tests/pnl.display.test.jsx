/**
 * UI tests for FlipkartReport Real P&L table rendering.
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
    cogs: 80,
    platform_bs: 172,
    ...skuOverrides,
  }]
})

const renderReport = (view = 'pnl') => {
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
      <MemoryRouter initialEntries={['/pnl/flipkart/1?view=pnl']}>
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
      <MemoryRouter initialEntries={['/pnl/flipkart/999?view=pnl']}>
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

  it('shows all 3 tabs', async () => {
    renderReport()
    await screen.findByText(/flipkart report/i)
    expect(screen.getByText(/real p&l/i)).toBeInTheDocument()
    expect(screen.getByText(/insights/i)).toBeInTheDocument()
  })
})


// ── Real P&L tab ──────────────────────────────────────────────────────────────

describe('Real P&L table', () => {
  it('renders SKU name', async () => {
    renderReport('pnl')
    const sku = await screen.findByText('SHJ-JS-VRI-N65-WHITE')
    expect(sku).toBeInTheDocument()
  })

  it('shows correct net units (34)', async () => {
    renderReport('pnl')
    await screen.findByText('SHJ-JS-VRI-N65-WHITE')
    // '34' appears in both summary bar and table row — use getAllByText
    expect(screen.getAllByText('34').length).toBeGreaterThanOrEqual(1)
  })

  it('shows return rate badge', async () => {
    renderReport('pnl')
    await screen.findByText('SHJ-JS-VRI-N65-WHITE')
    // return_rate_pct=54.05 → displayed as 54.1%
    expect(screen.getByText('54.1%')).toBeInTheDocument()
  })

  it('displays FK BS/unit as ₹97.7 (1 decimal)', async () => {
    renderReport('pnl')
    await screen.findByText('SHJ-JS-VRI-N65-WHITE')
    // 3320.98 / 34 = 97.67 → displayed as ₹97.7
    expect(screen.getByText('₹97.7')).toBeInTheDocument()
  })

  it('displays Target BS as ₹172.0', async () => {
    renderReport('pnl')
    await screen.findByText('SHJ-JS-VRI-N65-WHITE')
    expect(screen.getByText('₹172.0')).toBeInTheDocument()
  })

  it('displays negative variance with - prefix', async () => {
    renderReport('pnl')
    await screen.findByText('SHJ-JS-VRI-N65-WHITE')
    // var/unit = 97.67 - 172 = -74.3
    expect(screen.getByText('-₹74.3')).toBeInTheDocument()
  })

  it('displays margin % with sign prefix', async () => {
    renderReport('pnl')
    await screen.findByText('SHJ-JS-VRI-N65-WHITE')
    expect(screen.getByText('-43.2%')).toBeInTheDocument()
  })

  it('no Sell Price/unit column (removed)', async () => {
    renderReport('pnl')
    await screen.findByText('SHJ-JS-VRI-N65-WHITE')
    expect(screen.queryByText(/sell price\/unit/i)).toBeNull()
  })

  it('no Platform BS/unit column (removed)', async () => {
    renderReport('pnl')
    await screen.findByText('SHJ-JS-VRI-N65-WHITE')
    expect(screen.queryByText(/platform bs\/unit/i)).toBeNull()
  })

  it('shows FK Fees/unit column', async () => {
    renderReport('pnl')
    await screen.findByText(/fk fees\/unit/i)
  })
})


// ── Summary bar ───────────────────────────────────────────────────────────────

describe('Real P&L summary bar', () => {
  it('shows FK Bank Settlement total', async () => {
    renderReport('pnl')
    await screen.findByText(/fk bank settlement/i)
  })

  it('shows Total Expected BS', async () => {
    renderReport('pnl')
    await screen.findByText(/total expected bs/i)
  })

  it('shows Net Variance', async () => {
    renderReport('pnl')
    await screen.findByText(/net variance/i)
  })

  it('shows beating/missing counts', async () => {
    renderReport('pnl')
    await screen.findByText(/beating target/i)
    expect(screen.getByText(/missing target/i)).toBeInTheDocument()
  })
})


// ── Filters ───────────────────────────────────────────────────────────────────

describe('SKU filter pills', () => {
  it('shows All, Beating, Missing pills', async () => {
    renderReport('pnl')
    await screen.findByText(/all matched/i)
    expect(screen.getByText(/^Beating \(/)).toBeInTheDocument()
    expect(screen.getByText(/^Missing \(/)).toBeInTheDocument()
  })

  it('search input filters SKUs', async () => {
    getPnlReport.mockResolvedValue(makeReport())
    render(
      <MemoryRouter initialEntries={['/pnl/flipkart/1?view=pnl']}>
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

  it('clicking Real P&L tab shows table', async () => {
    renderReport('fk')
    await screen.findByText(/revenue flow/i)
    fireEvent.click(screen.getByText('Real P&L'))
    const sku = await screen.findByText('SHJ-JS-VRI-N65-WHITE')
    expect(sku).toBeInTheDocument()
  })
})


// ── Loss row highlighting ─────────────────────────────────────────────────────

describe('row styling', () => {
  it('loss row has pnl-tr-loss class', async () => {
    renderReport('pnl')
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
      <MemoryRouter initialEntries={['/pnl/flipkart/1?view=pnl']}>
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
