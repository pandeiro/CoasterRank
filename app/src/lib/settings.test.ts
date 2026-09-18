import { describe, it, expect, beforeEach, beforeAll, afterEach, afterAll, vi } from 'vitest'
import {
  DEFAULT_SETTINGS,
  SETTINGS_STORAGE_KEY,
  applyThemeMode,
  formatHeightM,
  formatLengthM,
  formatSpeedKmh,
  getSettingsSnapshot,
  initSettingsTheme,
  localeDefaultUnits,
  resolveIsDark,
  updateSettings,
} from './settings'

type MqlStub = {
  matches: boolean
  addEventListener: ReturnType<typeof vi.fn>
  removeEventListener: ReturnType<typeof vi.fn>
}

function makeMql(matches: boolean): MqlStub {
  return {
    matches,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }
}

// initSettingsTheme() is once-per-module (first call wins), so boot it once
// for the whole file with a light-OS matchMedia stub: the storage-event
// listener serves the storage tests below, and the OS-change listener
// serves the theme tests.
let osMql!: MqlStub
let initMatchMediaFn!: ReturnType<typeof vi.fn>

beforeAll(() => {
  osMql = makeMql(false)
  initMatchMediaFn = vi.fn().mockReturnValue(osMql)
  window.matchMedia = initMatchMediaFn as never
  initSettingsTheme()
})

afterAll(() => {
  delete (window as unknown as Record<string, unknown>).matchMedia
})

// Stage a raw localStorage value, then sync the module store through the
// cross-tab path (the same code other tabs' writes take).
function stageStoredSettings(raw: string | null) {
  updateSettings({ ...DEFAULT_SETTINGS })
  // Clear AFTER the reset: the reset write persists to storage, which would
  // otherwise make the null (first-visit) case unreadable.
  window.localStorage.clear()
  if (raw !== null) window.localStorage.setItem(SETTINGS_STORAGE_KEY, raw)
  const event = new Event('storage') as Event & { key?: string | null }
  event.key = SETTINGS_STORAGE_KEY
  window.dispatchEvent(event)
  return getSettingsSnapshot()
}

describe('settings storage', () => {
  const realLanguage = window.navigator.language

  beforeEach(() => {
    // Pin a metric locale: jsdom defaults to en-US, which takes the
    // imperial first-visit default (tested explicitly below).
    Object.defineProperty(window.navigator, 'language', {
      value: 'de-DE',
      configurable: true,
    })
  })

  afterEach(() => {
    Object.defineProperty(window.navigator, 'language', {
      value: realLanguage,
      configurable: true,
    })
  })

  beforeEach(() => {
    window.localStorage.clear()
    document.documentElement.classList.remove('dark')
    updateSettings({ ...DEFAULT_SETTINGS })
  })

  it('falls back to metric + system on empty storage', () => {
    expect(stageStoredSettings(null)).toEqual({ units: 'metric', theme: 'system' })
  })

  it('falls back to defaults on corrupt JSON', () => {
    expect(stageStoredSettings('not-json{')).toEqual({ units: 'metric', theme: 'system' })
  })

  it('falls back per-field on unknown values', () => {
    expect(stageStoredSettings(JSON.stringify({ units: 'furlongs', theme: 'amoled' }))).toEqual({
      units: 'metric',
      theme: 'system',
    })
  })

  it('reads a fully valid blob', () => {
    expect(stageStoredSettings(JSON.stringify({ units: 'imperial', theme: 'dark' }))).toEqual({
      units: 'imperial',
      theme: 'dark',
    })
  })

  it('round-trips writes through localStorage', () => {
    updateSettings({ units: 'imperial', theme: 'dark' })
    expect(JSON.parse(window.localStorage.getItem(SETTINGS_STORAGE_KEY)!)).toEqual({
      units: 'imperial',
      theme: 'dark',
    })
    expect(getSettingsSnapshot()).toEqual({ units: 'imperial', theme: 'dark' })
  })

  it('ignores invalid patch values', () => {
    updateSettings({ units: 'imperial' })
    updateSettings({ units: 'furlongs' as never, theme: 'amoled' as never })
    expect(getSettingsSnapshot()).toEqual({ units: 'imperial', theme: 'system' })
  })
})

describe('locale units default', () => {
  const realLanguage = window.navigator.language

  function setLanguage(tag: string) {
    Object.defineProperty(window.navigator, 'language', { value: tag, configurable: true })
  }

  afterEach(() => {
    setLanguage(realLanguage)
    window.localStorage.clear()
    document.documentElement.classList.remove('dark')
    updateSettings({ units: 'metric', theme: 'system' })
  })

  it('defaults imperial to US English, metric elsewhere', () => {
    setLanguage('en-US')
    expect(localeDefaultUnits()).toBe('imperial')
    expect(stageStoredSettings(null)).toEqual({ units: 'imperial', theme: 'system' })
    setLanguage('en-GB')
    expect(localeDefaultUnits()).toBe('metric')
    expect(stageStoredSettings(null)).toEqual({ units: 'metric', theme: 'system' })
  })

  it('stays metric without a region or with a malformed tag', () => {
    setLanguage('en')
    expect(localeDefaultUnits()).toBe('metric')
    setLanguage('')
    expect(localeDefaultUnits()).toBe('metric')
  })

  it('a stored pick always wins over the locale guess', () => {
    setLanguage('en-US')
    expect(stageStoredSettings(JSON.stringify({ units: 'metric', theme: 'system' }))).toEqual({
      units: 'metric',
      theme: 'system',
    })
  })
})

describe('units formatting', () => {
  it('passes metric values through untouched', () => {
    expect(formatHeightM(61, 'metric')).toBe('61 m')
    expect(formatSpeedKmh(119, 'metric')).toBe('119 km/h')
    expect(formatLengthM(1146, 'metric')).toBe('1146 m')
  })

  it('converts to imperial, rounded with grouped thousands', () => {
    // 61 m → 200.1 ft; 119 km/h → 73.9 mph; 1146 m → 3759.8 ft
    expect(formatHeightM(61, 'imperial')).toBe('200 ft')
    expect(formatSpeedKmh(119, 'imperial')).toBe('74 mph')
    expect(formatLengthM(1146, 'imperial')).toBe('3,760 ft')
  })
})

describe('theme resolution', () => {
  beforeEach(() => {
    updateSettings({ theme: 'system' })
    document.documentElement.classList.remove('dark')
  })

  afterEach(() => {
    window.matchMedia = initMatchMediaFn as never
    osMql.matches = false
    document.documentElement.classList.remove('dark')
  })

  it('explicit modes ignore the OS', () => {
    window.matchMedia = vi.fn().mockReturnValue(makeMql(true)) as never
    expect(resolveIsDark('light')).toBe(false)
    window.matchMedia = vi.fn().mockReturnValue(makeMql(false)) as never
    expect(resolveIsDark('dark')).toBe(true)
  })

  it('system follows the OS, defaulting to light without matchMedia', () => {
    delete (window as unknown as Record<string, unknown>).matchMedia
    expect(resolveIsDark('system')).toBe(false)
    window.matchMedia = vi.fn().mockReturnValue(makeMql(true)) as never
    expect(resolveIsDark('system')).toBe(true)
  })

  it('applyThemeMode toggles .dark on <html>', () => {
    applyThemeMode('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    applyThemeMode('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('applyThemeMode swaps the tab icon with the theme', () => {
    document.head.innerHTML = '<link rel="icon" type="image/svg+xml" href="/favicon.svg">'
    const link = document.querySelector('link[rel="icon"]')!
    applyThemeMode('dark')
    expect(link.getAttribute('href')).toBe('/favicon-dark.svg')
    applyThemeMode('light')
    expect(link.getAttribute('href')).toBe('/favicon.svg')
    document.head.innerHTML = ''
  })

  it('follows live OS flips while on system', () => {
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    const onChange = osMql.addEventListener.mock.calls.find(
      (call: unknown[]) => call[0] === 'change',
    )?.[1] as () => void
    expect(onChange).toBeTypeOf('function')
    osMql.matches = true
    onChange()
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('picks up other tabs via the storage event', () => {
    window.localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({ units: 'metric', theme: 'dark' }),
    )
    const event = new Event('storage') as Event & { key?: string | null }
    event.key = SETTINGS_STORAGE_KEY
    window.dispatchEvent(event)
    expect(getSettingsSnapshot().theme).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })
})
