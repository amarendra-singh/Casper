import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { vi } from 'vitest'

vi.mock('../api/client', () => ({
  default: {
    get: vi.fn().mockResolvedValue({
      data: {
        platform_name: 'Snapdeal',
        tier_summary: { GREEN: 3, AMBER: 1, RED: 0, CRITICAL: 0 },
        sku_risk_table: [],
        alerts: [],
      }
    })
  }
}))

import FraudPlatformPage from '../pages/Fraud/FraudPlatformPage'

test('renders back link to fraud overview', async () => {
  render(
    <MemoryRouter initialEntries={['/fraud/platform/1']}>
      <Routes>
        <Route path="/fraud/platform/:platformId" element={<FraudPlatformPage />} />
      </Routes>
    </MemoryRouter>
  )
  await waitFor(() => expect(screen.getByText(/back to fraud overview/i)).toBeInTheDocument())
})

test('renders platform name in title', async () => {
  render(
    <MemoryRouter initialEntries={['/fraud/platform/1']}>
      <Routes>
        <Route path="/fraud/platform/:platformId" element={<FraudPlatformPage />} />
      </Routes>
    </MemoryRouter>
  )
  await waitFor(() => expect(screen.getByRole('heading', { name: /snapdeal/i })).toBeInTheDocument())
})
