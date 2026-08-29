import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DEFAULT_FILTERS, type CountryOption, type RankingFilters } from '../lib/coasters'
import FilterBar from './FilterBar'

const countries: CountryOption[] = [
  { country: 'United States', count: 841, pinned: true },
  { country: 'United Kingdom', count: 20, pinned: true },
  { country: 'Canada', count: 6, pinned: false },
]

const manufacturers = ['B&M', 'Intamin']

function renderBar(filters: RankingFilters = DEFAULT_FILTERS, onChange = vi.fn()) {
  const utils = render(
    <FilterBar
      filters={filters}
      onChange={onChange}
      countries={countries}
      manufacturers={manufacturers}
    />,
  )
  return { onChange, ...utils }
}

describe('FilterBar', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders the search input and filter controls', () => {
    renderBar()
    expect(screen.getByLabelText(/filter coasters/i)).toBeInTheDocument()
    expect(screen.getByLabelText('Material')).toBeInTheDocument()
    expect(screen.getByLabelText('Country')).toBeInTheDocument()
    expect(screen.getByLabelText('Manufacturer')).toBeInTheDocument()
    expect(screen.getByLabelText('Include non-operational')).toBeInTheDocument()
  })

  it('debounces search input into an onChange', () => {
    vi.useFakeTimers()
    const { onChange } = renderBar()
    fireEvent.change(screen.getByLabelText(/filter coasters/i), { target: { value: 'cobra' } })
    expect(onChange).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_FILTERS, q: 'cobra' })
  })

  it('does not fire onChange when search matches the URL value', () => {
    vi.useFakeTimers()
    const { onChange } = renderBar({ ...DEFAULT_FILTERS, q: 'cobra' })
    fireEvent.change(screen.getByLabelText(/filter coasters/i), { target: { value: 'cobrae' } })
    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_FILTERS, q: 'cobrae' })
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('applies a pending search on top of filters changed mid-debounce', () => {
    vi.useFakeTimers()
    const { onChange, rerender } = renderBar()
    fireEvent.change(screen.getByLabelText(/filter coasters/i), { target: { value: 'cobra' } })

    // An unrelated filter toggle lands immediately, mid-debounce…
    fireEvent.click(screen.getByLabelText('Include non-operational'))
    expect(onChange).toHaveBeenNthCalledWith(1, { ...DEFAULT_FILTERS, allStatuses: true })
    // …and the parent re-renders with the new filters while the search is pending.
    rerender(
      <FilterBar
        filters={{ ...DEFAULT_FILTERS, allStatuses: true }}
        onChange={onChange}
        countries={countries}
        manufacturers={manufacturers}
      />,
    )

    // The debounce is not restarted by the re-render: it fires 300ms after
    // typing, merging the search onto the toggled filters (not stale ones).
    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(onChange).toHaveBeenNthCalledWith(2, {
      ...DEFAULT_FILTERS,
      allStatuses: true,
      q: 'cobra',
    })
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('calls onChange when the status checkbox toggles', async () => {
    const user = userEvent.setup()
    const { onChange } = renderBar()
    await user.click(screen.getByLabelText('Include non-operational'))
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_FILTERS, allStatuses: true })
  })

  it('calls onChange when a material view is selected', async () => {
    const user = userEvent.setup()
    const { onChange } = renderBar()
    await user.click(screen.getByRole('radio', { name: 'Wooden only' }))
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_FILTERS, materialView: 'wood' })
  })

  it('marks the active material view as checked', () => {
    renderBar({ ...DEFAULT_FILTERS, materialView: 'steel' })
    expect(screen.getByRole('radio', { name: 'Steel only' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Everything' })).not.toBeChecked()
  })

  it('lists pinned and rest countries with counts', () => {
    renderBar()
    expect(screen.getByRole('option', { name: 'United States (841)' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'United Kingdom (20)' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Canada (6)' })).toBeInTheDocument()
    expect(screen.getAllByRole('option', { name: 'Any' }).length).toBeGreaterThanOrEqual(1)
  })

  it('lists manufacturers from props', () => {
    renderBar()
    expect(screen.getByRole('option', { name: 'Intamin' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'B&M' })).toBeInTheDocument()
  })

  it('reflects the URL-provided filters', () => {
    renderBar({ ...DEFAULT_FILTERS, allStatuses: true, country: 'Canada', manufacturer: 'Intamin' })
    expect(screen.getByLabelText('Include non-operational')).toBeChecked()
    expect(screen.getByLabelText('Country')).toHaveValue('Canada')
    expect(screen.getByLabelText('Manufacturer')).toHaveValue('Intamin')
  })
})
