import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import SignupCta from './SignupCta'

function renderCta(onDismiss = vi.fn()) {
  render(
    <MemoryRouter>
      <SignupCta onDismiss={onDismiss} />
    </MemoryRouter>,
  )
  return onDismiss
}

describe('SignupCta', () => {
  it('renders a headline, signup CTA, and soft dismiss', () => {
    renderCta()
    expect(screen.getByRole('dialog', { name: 'Sign up invitation' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sign up free' })).toHaveAttribute('href', '/signup')
    expect(screen.getByRole('button', { name: 'Not now, thanks' })).toBeInTheDocument()
    // No login shortcut: logged-out regulars already know where it lives.
    expect(screen.queryByRole('link', { name: 'Log in' })).not.toBeInTheDocument()
  })

  it('calls onDismiss for the soft dismiss too', async () => {
    const onDismiss = renderCta()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Not now, thanks' }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('calls onDismiss when the × button is clicked', async () => {
    const onDismiss = renderCta()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Dismiss signup prompt' }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('calls onDismiss on Escape', async () => {
    const onDismiss = renderCta()
    const user = userEvent.setup()
    await user.keyboard('{Escape}')
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})
