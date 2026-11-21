import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import PlatformFraudTab from '../pages/Fraud/components/PlatformFraudTab'
import ProfitCalculator, { calc } from '../pages/ProfitCalculator'
import api from '../api/client'

vi.mock('../context/CompanyContext', () => ({ useCompany: () => ({ role: 'owner', isAll: false }) }))

vi.mock('../api/client', () => ({ default: { get: vi.fn(), patch: vi.fn() } }))

beforeEach(() => vi.clearAllMocks())

describe('audited operator failures', () => {
  it('loads platform risk and settlement data instead of remaining at Loading', async () => {
    api.get.mockImplementation(url => Promise.resolve({ data: url.endsWith('overview')
      ? { verdict: 'CLEAN', verdict_msg: 'Fixture ready', platform_health: [], alerts: [] }
      : { reports: [], total_gap: 0, gap_count: 0, note: 'Pricing variance only' } }))
    render(<MemoryRouter><PlatformFraudTab /></MemoryRouter>)
    expect(await screen.findByText('Fixture ready')).toBeInTheDocument()
    expect(screen.getByText('Pricing target variance (all reports)')).toBeInTheDocument()
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument()
  })

  it('shows a failed platform request and retries successfully', async () => {
    api.get.mockRejectedValue(new Error('offline'))
    render(<MemoryRouter><PlatformFraudTab /></MemoryRouter>)
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load platform risk')
    api.get.mockImplementation(url => Promise.resolve({ data: url.endsWith('overview')
      ? { verdict: 'CLEAN', verdict_msg: 'Retry succeeded', alerts: [] }
      : { reports: [], total_gap: 0, gap_count: 0 } }))
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Retry succeeded')).toBeInTheDocument()
  })

  it('hides calculator results when unconditional rates exceed 100%', async () => {
    render(<ProfitCalculator />)
    const input = screen.getByRole('spinbutton', { name: /RTO rate/i })
    await userEvent.clear(input)
    await userEvent.type(input, '100')
    expect(screen.getByRole('alert')).toHaveTextContent('must total at most 100%')
    expect(screen.queryByText('Blended profit / order')).not.toBeInTheDocument()
  })

  it('does not invent a zero price when there is no finite break-even', () => {
    const result = calc({ price: '100', channel: 'marketplace', rtoPct: '100',
      cancelPct: '0', returnPct: '0', ads: { v: '10', u: 'rs' } })
    expect(result.valid).toBe(true)
    expect(result.breakeven).toBeNull()
  })
})
