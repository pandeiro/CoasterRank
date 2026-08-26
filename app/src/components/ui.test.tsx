import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { ConfirmDialog } from './ui'

describe('ConfirmDialog', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <ConfirmDialog
        isOpen={false}
        onClose={() => {}}
        onConfirm={() => {}}
        title="Delete Coaster"
        message="Are you sure?"
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('keeps the overlay fullscreen-centered and puts the width cap on the panel', () => {
    const { container } = render(
      <ConfirmDialog
        isOpen
        onClose={() => {}}
        onConfirm={() => {}}
        title="Delete Coaster"
        message="Are you sure?"
      />,
    )

    const overlay = container.querySelector('[role="dialog"]')
    expect(overlay).not.toBeNull()
    // Overlay must span the viewport and center its child; a max-width here
    // would pin the whole dialog to the left edge (the bug this guards).
    expect(overlay).toHaveClass('fixed', 'inset-0', 'flex', 'items-center', 'justify-center')
    expect(overlay).not.toHaveClass('max-w-md')

    const panel = container.querySelector('#modal-content')
    expect(panel).not.toBeNull()
    expect(panel).toHaveClass('w-full', 'max-w-md')
  })
})
