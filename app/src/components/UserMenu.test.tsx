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
})
