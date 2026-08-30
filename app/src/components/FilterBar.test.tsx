import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
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

function materialRadio(name: string) {
  return within(screen.getByRole('radiogroup', { name: 'Material' })).getByRole('radio', { name })
}

function statusRadio(name: string) {
  return within(screen.getByRole('radiogroup', { name: 'Status' })).getByRole('radio', { name })
}

async function openMore(user = userEvent.setup()) {
  await user.click(screen.getByRole('button', { name: /filters/i }))
}

describe('FilterBar', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders the search input and segmenteds, with the popover closed', async () => {
    renderBar()
    expect(screen.getByLabelText(/filter coasters/i)).toBeInTheDocument()
    expect(materialRadio('Any')).toBeInTheDocument()
    expect(statusRadio('Running')).toBeInTheDocument()
    expect(screen.queryByLabelText('Country')).not.toBeInTheDocument()

    const user = userEvent.setup()
    await openMore(user)
    expect(screen.getByLabelText('Country')).toBeInTheDocument()
    expect(screen.getByLabelText('Manufacturer')).toBeInTheDocument()
  })

  it('closes the popover on Escape', async () => {
    const user = userEvent.setup()
    renderBar()
    await openMore(user)
    expect(screen.getByLabelText('Country')).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(screen.queryByLabelText('Country')).not.toBeInTheDocument()
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
    fireEvent.click(statusRadio('Any'))
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

  it('calls onChange when the status is set to Any', async () => {
    const user = userEvent.setup()
    const { onChange } = renderBar()
    await user.click(statusRadio('Any'))
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_FILTERS, allStatuses: true })
  })

  it('calls onChange when a material view is selected', async () => {
    const user = userEvent.setup()
    const { onChange } = renderBar()
    await user.click(materialRadio('Wood'))
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_FILTERS, materialView: 'wood' })
  })

  it('marks the active material view as checked', () => {
    renderBar({ ...DEFAULT_FILTERS, materialView: 'steel' })
    expect(materialRadio('Steel')).toBeChecked()
    expect(materialRadio('Any')).not.toBeChecked()
  })

  it('lists pinned and rest countries with counts in the popover', async () => {
    const user = userEvent.setup()
    renderBar()
    await openMore(user)
    expect(screen.getByRole('option', { name: 'United States (841)' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'United Kingdom (20)' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Canada (6)' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'All countries' })).toBeInTheDocument()
  })

  it('lists manufacturers from props in the popover', async () => {
    const user = userEvent.setup()
    renderBar()
    await openMore(user)
    expect(screen.getByRole('option', { name: 'Intamin' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'B&M' })).toBeInTheDocument()
  })

  it('reflects the URL-provided filters and badges the active popover count', async () => {
    const user = userEvent.setup()
    renderBar({ ...DEFAULT_FILTERS, allStatuses: true, country: 'Canada', manufacturer: 'Intamin' })
    expect(statusRadio('Any')).toBeChecked()
    expect(screen.getByRole('button', { name: /filters/i })).toHaveTextContent('2')

    await openMore(user)
    expect(screen.getByLabelText('Country')).toHaveValue('Canada')
    expect(screen.getByLabelText('Manufacturer')).toHaveValue('Intamin')
  })

  it('resets country and manufacturer from the popover', async () => {
    const user = userEvent.setup()
    const { onChange } = renderBar({
      ...DEFAULT_FILTERS,
      country: 'Canada',
      manufacturer: 'Intamin',
    })
    await openMore(user)
    await user.click(screen.getByRole('button', { name: /reset/i }))
    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_FILTERS,
      country: undefined,
      manufacturer: undefined,
    })
  })

  it('folds the segmenteds into the popover on mobile and keeps the toolbar minimal', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    )
    try {
      const user = userEvent.setup()
      renderBar()
      expect(screen.queryByRole('radiogroup', { name: 'Material' })).not.toBeInTheDocument()
      expect(screen.queryByRole('radiogroup', { name: 'Status' })).not.toBeInTheDocument()

      await openMore(user)
      expect(screen.getByRole('radiogroup', { name: 'Material' })).toBeInTheDocument()
      expect(screen.getByRole('radiogroup', { name: 'Status' })).toBeInTheDocument()
      expect(screen.getByRole('combobox', { name: 'Country' })).toBeInTheDocument()
      expect(screen.getByRole('combobox', { name: 'Manufacturer' })).toBeInTheDocument()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
