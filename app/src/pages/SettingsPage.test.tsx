import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HelmetProvider } from 'react-helmet-async'
import SettingsPage from './SettingsPage'
import { SETTINGS_STORAGE_KEY, updateSettings } from '../lib/settings'

function renderPage() {
  return render(
    <HelmetProvider>
      <SettingsPage />
    </HelmetProvider>,
  )
}

function storedSettings() {
  return JSON.parse(window.localStorage.getItem(SETTINGS_STORAGE_KEY)!)
}

describe('SettingsPage', () => {
  beforeEach(() => {
    window.localStorage.clear()
    document.documentElement.classList.remove('dark')
    updateSettings({ units: 'metric', theme: 'system' })
  })

  it('renders units and appearance options with a live preview', () => {
    renderPage()
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /^metric/i })).toBeChecked()
    expect(screen.getByRole('radio', { name: /^system/i })).toBeChecked()
    expect(screen.getByText(/61 m tall/)).toBeInTheDocument()
  })

  it('switching to imperial persists and updates the preview', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('radio', { name: /imperial/i }))
    expect(storedSettings().units).toBe('imperial')
    expect(screen.getByText(/200 ft tall/)).toBeInTheDocument()
    expect(screen.getByText(/74 mph/)).toBeInTheDocument()
  })

  it('switching appearance to dark toggles .dark and persists', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('radio', { name: /^dark/i }))
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(storedSettings().theme).toBe('dark')
  })
})
