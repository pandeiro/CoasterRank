import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import UserMenu from './UserMenu'

vi.mock('./ui/Avatar', () => ({
  default: () => <div data-testid="avatar" />,
}))

function renderMenu() {
  return render(
    <MemoryRouter>
      <UserMenu profile={undefined} userId="u1" onSignOut={vi.fn()} />
    </MemoryRouter>,
  )
}

describe('UserMenu', () => {
  it('gives the avatar trigger an accessible name', () => {
    // Issue #91: icon-only button announced nothing to screen readers.
    renderMenu()
    const trigger = screen.getByRole('button', { name: /open account menu/i })
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('opens the menu and flips aria-expanded', async () => {
    const user = userEvent.setup()
    renderMenu()
    const trigger = screen.getByRole('button', { name: /open account menu/i })
    await user.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /my coasters/i })).toBeInTheDocument()
  })

  it("anchors the sm+ dropdown to the wrapper's right edge, not the left", async () => {
    const user = userEvent.setup()
    renderMenu()
    await user.click(screen.getByRole('button', { name: /open account menu/i }))
    // Layout regression guard (jsdom can't measure position, so pin the
    // classes): the mobile sheet classes `inset-x-0` leave `left: 0` at sm+,
    // where the menu becomes absolute with a fixed w-48. With both left and
    // right constrained, CSS over-constraint resolution ignores `right` and
    // anchors the box to `left: 0`, extending it rightward past the viewport
    // edge at intermediate widths. `sm:left-auto` restores right-edge anchoring.
    expect(screen.getByRole('menu')).toHaveClass(
      'sm:absolute',
      'sm:left-auto',
      'sm:right-0',
      'sm:w-48',
    )
  })
})
