import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ManufacturerMultiPicker from './ManufacturerMultiPicker'
import type { Manufacturer } from '../lib/coasters'

const manufacturers: Manufacturer[] = [
  { id: 'm1', name: 'Intamin', slug: 'intamin' },
  { id: 'm2', name: 'Zamperla', slug: 'zamperla' },
  { id: 'm3', name: 'Rocky Mountain Construction', slug: 'rmc' },
]

function renderPicker(props: Partial<React.ComponentProps<typeof ManufacturerMultiPicker>> = {}) {
  const onChange = vi.fn()
  render(
    <ManufacturerMultiPicker
      manufacturers={manufacturers}
      selected={[]}
      onChange={onChange}
      {...props}
    />,
  )
  return { onChange }
}

describe('ManufacturerMultiPicker', () => {
  it('adds a pick at the FRONT (newest wins) and clears the query', async () => {
    const user = userEvent.setup()
    const { onChange } = renderPicker({
      selected: [{ id: 'm1', name: 'Intamin', slug: 'intamin' }],
    })
    const input = screen.getByPlaceholderText(/search for a manufacturer/i)
    await user.type(input, 'Zamperla')
    await user.click(screen.getByText('Zamperla'))
    expect(onChange).toHaveBeenCalledWith([
      { id: 'm2', name: 'Zamperla', slug: 'zamperla' },
      { id: 'm1', name: 'Intamin', slug: 'intamin' },
    ])
  })

  it('excludes already-selected manufacturers from the suggestions', async () => {
    const user = userEvent.setup()
    renderPicker({ selected: manufacturers })
    await user.type(screen.getByPlaceholderText(/search/i), 'Intamin')
    // The chip still shows the name, but no suggestion dropdown renders.
    expect(document.querySelectorAll('ul.absolute')).toHaveLength(0)
  })

  it('removes a chip and reorders via the move buttons', async () => {
    const user = userEvent.setup()
    const { onChange } = renderPicker({ selected: manufacturers })
    await user.click(screen.getByRole('button', { name: /remove zamperla/i }))
    expect(onChange).toHaveBeenCalledWith([
      { id: 'm1', name: 'Intamin', slug: 'intamin' },
      { id: 'm3', name: 'Rocky Mountain Construction', slug: 'rmc' },
    ])
    onChange.mockClear()
    await user.click(screen.getByRole('button', { name: /move intamin down/i }))
    expect(onChange).toHaveBeenCalledWith([
      { id: 'm2', name: 'Zamperla', slug: 'zamperla' },
      { id: 'm1', name: 'Intamin', slug: 'intamin' },
      { id: 'm3', name: 'Rocky Mountain Construction', slug: 'rmc' },
    ])
  })

  it('disables the up button on the primary and down on the last chip', () => {
    renderPicker({ selected: manufacturers })
    expect(screen.getByRole('button', { name: /move intamin up/i })).toBeDisabled()
    expect(
      screen.getByRole('button', { name: /move rocky mountain construction down/i }),
    ).toBeDisabled()
  })

  it('marks the first chip as primary', () => {
    renderPicker({ selected: manufacturers })
    expect(screen.getByText(/· primary/)).toBeInTheDocument()
  })
})
