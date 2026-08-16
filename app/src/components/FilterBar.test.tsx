import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useCountries, useManufacturers, useParks, type RankingFilters } from '../lib/coasters'
import FilterBar from './FilterBar'

vi.mock('../lib/coasters', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/coasters')>()
  return {
    ...actual,
    useParks: vi.fn(),
    useCountries: vi.fn(),
    useManufacturers: vi.fn(),
  }
})

const defaultFilters: RankingFilters = { status: 'operating' }

function renderBar(filters: RankingFilters = defaultFilters, onChange = vi.fn()) {
  const utils = render(<FilterBar filters={filters} onChange={onChange} />)
  return { onChange, ...utils }
}

describe('FilterBar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useParks).mockReturnValue({
      data: [{ id: 'p1', name: 'Cedar Point', slug: 'cedar-point' }],
    } as never)
    vi.mocked(useCountries).mockReturnValue({ data: ['US', 'UK'] } as never)
    vi.mocked(useManufacturers).mockReturnValue({
      data: [{ id: 'm1', name: 'Intamin', slug: 'intamin' }],
    } as never)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders the search input and filter selects', () => {
    renderBar()
    expect(screen.getByLabelText(/search coasters/i)).toBeInTheDocument()
    expect(screen.getByLabelText('Status')).toBeInTheDocument()
    expect(screen.getByLabelText('Material')).toBeInTheDocument()
    expect(screen.getByLabelText('Country')).toBeInTheDocument()
    expect(screen.getByLabelText('Park')).toBeInTheDocument()
    expect(screen.getByLabelText('Manufacturer')).toBeInTheDocument()
  })

  it('debounces search input into an onChange', () => {
    vi.useFakeTimers()
    const { onChange } = renderBar(defaultFilters)
    fireEvent.change(screen.getByLabelText(/search coasters/i), { target: { value: 'cobra' } })
    expect(onChange).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith({ status: 'operating', q: 'cobra' })
  })

  it('does not fire onChange when search matches the URL value', () => {
    vi.useFakeTimers()
    const { onChange } = renderBar({ ...defaultFilters, q: 'cobra' })
    fireEvent.change(screen.getByLabelText(/search coasters/i), { target: { value: 'cobrae' } })
    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(onChange).toHaveBeenCalledWith({ status: 'operating', q: 'cobrae' })
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('calls onChange immediately when status changes', async () => {
    const user = userEvent.setup()
    const { onChange } = renderBar()
    await user.selectOptions(screen.getByLabelText('Status'), 'defunct')
    expect(onChange).toHaveBeenCalledWith({ status: 'defunct' })
  })

  it('calls onChange when material is selected', async () => {
    const user = userEvent.setup()
    const { onChange } = renderBar()
    await user.selectOptions(screen.getByLabelText('Material'), 'wood')
    expect(onChange).toHaveBeenCalledWith({ status: 'operating', material: 'wood' })
  })

  it('lists parks, countries, and manufacturers from the hooks', () => {
    renderBar()
    expect(screen.getByRole('option', { name: 'Cedar Point' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'US' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Intamin' })).toBeInTheDocument()
  })
})
