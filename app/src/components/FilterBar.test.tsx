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
  return within(screen.getByRole('radiogroup', { name: 'Track' })).getByRole('radio', { name })
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
    expect(materialRadio('All')).toBeInTheDocument()
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

  it('keeps what was typed when the debounced URL value echoes back (trailing space)', () => {
    vi.useFakeTimers()
    const { onChange, rerender } = renderBar()
    const input = screen.getByLabelText(/filter coasters/i)

    // Typing stops with a trailing space; the debounce filters on the
    // trimmed value…
    fireEvent.change(input, { target: { value: 'cobra ' } })
    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_FILTERS, q: 'cobra' })

    // …and the parent re-renders with the URL's trimmed q. That echo must
    // not rewrite the input: the user typed the space, and a keystroke
    // landing during this flush would otherwise be clobbered too.
    rerender(
      <FilterBar
        filters={{ ...DEFAULT_FILTERS, q: 'cobra' }}
        onChange={onChange}
        countries={countries}
        manufacturers={manufacturers}
      />,
    )
    expect(input).toHaveValue('cobra ')

    // The next keystroke survives and debounces normally.
    fireEvent.change(input, { target: { value: 'cobra r' } })
    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(onChange).toHaveBeenNthCalledWith(2, { ...DEFAULT_FILTERS, q: 'cobra r' })
    expect(input).toHaveValue('cobra r')
  })

  it('adopts external URL changes into the input (back navigation)', () => {
    vi.useFakeTimers()
    const { onChange, rerender } = renderBar({ ...DEFAULT_FILTERS, q: 'cobra' })
    const input = screen.getByLabelText(/filter coasters/i)
    expect(input).toHaveValue('cobra')

    // Back navigation drops q from the URL — the input follows the URL.
    rerender(
      <FilterBar
        filters={DEFAULT_FILTERS}
        onChange={onChange}
        countries={countries}
        manufacturers={manufacturers}
      />,
    )
    expect(input).toHaveValue('')
  })

  it('applies a pending search on top of filters changed mid-debounce', () => {
    vi.useFakeTimers()
    const { onChange, rerender } = renderBar()
    fireEvent.change(screen.getByLabelText(/filter coasters/i), { target: { value: 'cobra' } })

    // An unrelated filter toggle lands immediately, mid-debounce…
    fireEvent.click(statusRadio('Running'))
    expect(onChange).toHaveBeenNthCalledWith(1, { ...DEFAULT_FILTERS, allStatuses: false })
    // …and the parent re-renders with the new filters while the search is pending.
    rerender(
      <FilterBar
        filters={{ ...DEFAULT_FILTERS, allStatuses: false }}
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
      allStatuses: false,
      q: 'cobra',
    })
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('calls onChange when the status is set to Running', async () => {
    const user = userEvent.setup()
    const { onChange } = renderBar()
    await user.click(statusRadio('Running'))
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_FILTERS, allStatuses: false })
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
    expect(materialRadio('All')).not.toBeChecked()
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
    // All is now the default — filtering to Running is the non-default (badged on mobile only).
    renderBar({
      ...DEFAULT_FILTERS,
      allStatuses: false,
      country: 'Canada',
      manufacturer: 'Intamin',
    })
    expect(statusRadio('Running')).toBeChecked()

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
      // §8.2: the toolbar segmenteds stay in the DOM but are CSS-hidden on
      // mobile (jsdom can't compute CSS, so pin the classes).
      expect(screen.getByRole('radiogroup', { name: 'Track' })).toHaveClass('hidden', 'sm:flex')
      expect(screen.getByRole('radiogroup', { name: 'Status' })).toHaveClass('hidden', 'sm:flex')

      await openMore(user)
      const popover = screen.getByTestId('filter-popover')
      expect(within(popover).getByRole('radiogroup', { name: 'Track' })).not.toHaveClass('hidden')
      expect(within(popover).getByRole('radiogroup', { name: 'Status' })).not.toHaveClass('hidden')
      expect(within(popover).getByRole('combobox', { name: 'Country' })).toBeInTheDocument()
      expect(within(popover).getByRole('combobox', { name: 'Manufacturer' })).toBeInTheDocument()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('reserves a stable toolbar height (§8.2) and gives selects a floor width (§3.1)', async () => {
    const user = userEvent.setup()
    renderBar()
    const panel = screen.getByLabelText(/filter coasters/i).closest('[class*="min-h"]')
    expect(panel).not.toBeNull()
    expect(panel).toHaveClass('min-h-[3.25rem]')
    await openMore(user)
    expect(screen.getByRole('combobox', { name: 'Country' })).toHaveClass('min-w-[12rem]')
  })
})
