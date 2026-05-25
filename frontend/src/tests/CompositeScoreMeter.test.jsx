import { render, screen } from '@testing-library/react'
import CompositeScoreMeter from '../pages/Fraud/components/CompositeScoreMeter'

test('renders score number', () => {
  render(<CompositeScoreMeter score={72.5} />)
  expect(screen.getByText('72.5')).toBeInTheDocument()
})

test('renders null score as em dash', () => {
  render(<CompositeScoreMeter score={null} />)
  expect(screen.getAllByText('—').length).toBeGreaterThan(0)
})

test('compact mode renders span with csm-compact class', () => {
  const { container } = render(<CompositeScoreMeter score={50} compact />)
  expect(container.querySelector('.csm-compact')).toBeTruthy()
})

test('score 0 renders LOW label in full mode', () => {
  render(<CompositeScoreMeter score={0} />)
  expect(screen.getByText('LOW')).toBeInTheDocument()
})

test('score 75 renders CRITICAL label in full mode', () => {
  render(<CompositeScoreMeter score={75} />)
  expect(screen.getByText('CRITICAL')).toBeInTheDocument()
})
