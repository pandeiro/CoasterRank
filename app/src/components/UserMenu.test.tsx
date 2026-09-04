import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Link } from 'react-router-dom'
import UserMenu from './UserMenu'
import type { Profile } from '../lib/profile'

vi.mock('./ui/Avatar', () => ({
  default: () => <div data-testid="avatar" />,
}))

const profile: Profile = {
  id: 'u1',
  username: 'coaster_fan',
  display_name: 'Coaster Fan',
  avatar_url: null,
  is_admin: false,
  public_list: true,
  og_image_url: null,
}

const onSignOut = vi.fn()

function renderMenu(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <UserMenu profile={profile} userId="u1" onSignOut={onSignOut} />
      <Link to="/elsewhere">go elsewhere</Link>
    </MemoryRouter>,
  )
}

function trigger() {
  return screen.getByRole('button', { name: /open account menu/i })
}

// jsdom loads no Tailwind stylesheet, so shell visibility classes (`hidden`,
// `sm:hidden`) do nothing there — when open, BOTH shells are in the a11y tree.
// Disambiguate by testid/`within`, never by bare role.
async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(trigger())
  return {
    sheet: screen.getByTestId('account-sheet'),
    dropdown: screen.getByTestId('account-dropdown'),
  }
}

beforeEach(() => {
  onSignOut.mockClear()
})

describe('UserMenu', () => {
  it('gives the avatar trigger an accessible name', () => {
    // Issue #91: icon-only button announced nothing to screen readers.
    renderMenu()
    const t = trigger()
    expect(t).toHaveAttribute('aria-haspopup', 'menu')
    expect(t).toHaveAttribute('aria-expanded', 'false')
  })

  it('renders the menu into a portal on document.body, not inside the header', async () => {
    const user = userEvent.setup()
    renderMenu()
    const { dropdown } = await openMenu(user)
    // Regression guard: the header carries backdrop-blur, which makes it the
    // containing block for fixed descendants — the old in-header menu had its
    // "full-screen" mobile backdrop clipped to the 64px header strip.
    expect(dropdown.parentElement).toBe(document.body)
    expect(screen.getByTestId('user-menu-backdrop').parentElement).toBe(document.body)
  })

  it('opens: expands, un-inerts, and moves focus into the menu', async () => {
    const user = userEvent.setup()
    renderMenu()
    expect(trigger()).toHaveAttribute('aria-expanded', 'false')
    // Closed shells are inert + off-stage (sheet parked below the viewport).
    expect(screen.getByTestId('account-sheet')).toHaveAttribute('inert')
    expect(screen.getByTestId('account-sheet')).toHaveClass('translate-y-full')

    const { sheet, dropdown } = await openMenu(user)
    expect(trigger()).toHaveAttribute('aria-expanded', 'true')
    expect(sheet).not.toHaveAttribute('inert')
    expect(sheet).toHaveClass('translate-y-0')
    expect(screen.getByTestId('user-menu-backdrop')).toHaveClass('opacity-100')
    // jsdom: matchMedia missing → isCoarsePointer() false → desktop shell focused.
    expect(dropdown).toHaveFocus()
  })

  it('closes on Escape and returns focus to the trigger', async () => {
    const user = userEvent.setup()
    renderMenu()
    await openMenu(user)
    await user.keyboard('{Escape}')
    expect(trigger()).toHaveAttribute('aria-expanded', 'false')
    expect(trigger()).toHaveFocus()
    expect(screen.getByTestId('account-sheet')).toHaveClass('translate-y-full')
  })

  it('closes on backdrop click and returns focus to the trigger', async () => {
    const user = userEvent.setup()
    renderMenu()
    await openMenu(user)
    fireEvent.click(screen.getByTestId('user-menu-backdrop'))
    expect(trigger()).toHaveAttribute('aria-expanded', 'false')
    expect(trigger()).toHaveFocus()
  })

  it('closes on route change without stealing focus', async () => {
    const user = userEvent.setup()
    renderMenu()
    await openMenu(user)
    await user.click(screen.getByRole('link', { name: 'go elsewhere' }))
    expect(trigger()).toHaveAttribute('aria-expanded', 'false')
    expect(trigger()).not.toHaveFocus()
  })

  it('dismisses when clicking the item for the page we are already on', async () => {
    // Same-path navigation leaves location.pathname untouched, so the
    // route-change close effect never fires — only the item's own onClick
    // can dismiss the menu here. Regression guard: the menu used to linger.
    const user = userEvent.setup()
    renderMenu('/me')
    await openMenu(user)
    await user.click(screen.getAllByRole('menuitem', { name: 'My Coasters' })[0])
    expect(trigger()).toHaveAttribute('aria-expanded', 'false')
    expect(trigger()).toHaveFocus()
  })

  it('invokes onSignOut from the open menu', async () => {
    const user = userEvent.setup()
    renderMenu()
    const { dropdown } = await openMenu(user)
    await user.click(within(dropdown).getByRole('menuitem', { name: /sign out/i }))
    expect(onSignOut).toHaveBeenCalledTimes(1)
  })

  it('links the account destinations, including the public page when shared', async () => {
    const user = userEvent.setup()
    renderMenu()
    await openMenu(user)
    // Only the open shell is exposed (the closed one is aria-hidden).
    const hrefs = screen.getAllByRole('menuitem').map((el) => el.getAttribute('href'))
    expect(hrefs).toContain('/me')
    expect(hrefs).toContain('/me/profile')
    expect(hrefs).toContain('/riders/coaster_fan')
  })

  it('omits the public-page item when the list is not shared', async () => {
    const user = userEvent.setup()
    const hidden = render(
      <MemoryRouter>
        <UserMenu profile={{ ...profile, public_list: false }} userId="u1" onSignOut={vi.fn()} />
      </MemoryRouter>,
    )
    await user.click(hidden.getByRole('button', { name: /open account menu/i }))
    expect(hidden.getAllByRole('menuitem').map((el) => el.getAttribute('href'))).not.toContain(
      '/riders/coaster_fan',
    )
  })

  it('pins the responsive shell and motion classes', () => {
    // jsdom has no layout engine, so pin the classes that carry the design:
    // - sheet: full-width bottom sheet on touch, hidden on sm+
    // - dropdown: fixed w-48 anchored top-right via measured inline style
    // - motion: transform/opacity only, disabled under prefers-reduced-motion
    renderMenu()
    const sheet = screen.getByTestId('account-sheet')
    expect(sheet).toHaveClass('fixed', 'inset-x-0', 'bottom-0', 'sm:hidden', 'rounded-t-2xl')
    expect(sheet).toHaveClass('motion-reduce:transition-none')

    const dropdown = screen.getByTestId('account-dropdown')
    expect(dropdown).toHaveClass('hidden', 'sm:block', 'fixed', 'w-48', 'origin-top-right')
    expect(dropdown).toHaveClass('motion-reduce:transition-none')

    const backdrop = screen.getByTestId('user-menu-backdrop')
    expect(backdrop).toHaveClass('fixed', 'inset-0', 'motion-reduce:transition-none')
  })
})
