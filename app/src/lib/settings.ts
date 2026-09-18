import { useSyncExternalStore } from 'react'

// Local-only user settings (per client, per device). No Supabase, no
// account — a single JSON blob in localStorage, so guests get settings too.
// SEO/meta + data-entry forms stay metric (canonical); only human-facing
// stat display converts.

export type Units = 'metric' | 'imperial'
export type ThemeMode = 'system' | 'light' | 'dark'

export interface LocalSettings {
  units: Units
  theme: ThemeMode
}

export const SETTINGS_STORAGE_KEY = 'cr.settings.v1'

export const DEFAULT_SETTINGS: LocalSettings = {
  units: 'metric',
  theme: 'system',
}

// First-visit units default, from the browser locale: the US, Liberia, and
// Myanmar are the only countries on imperial, so visitors there start
// imperial — an explicit pick (stored) always wins over this guess.
const IMPERIAL_REGIONS = new Set(['US', 'LR', 'MM'])

export function localeDefaultUnits(): Units {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.language !== 'string') {
      return 'metric'
    }
    const region = new Intl.Locale(navigator.language).region?.toUpperCase()
    return region !== undefined && IMPERIAL_REGIONS.has(region) ? 'imperial' : 'metric'
  } catch {
    // Malformed locale tag (Intl.Locale throws RangeError): stay metric.
    return 'metric'
  }
}

function isUnits(value: unknown): value is Units {
  return value === 'metric' || value === 'imperial'
}

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'system' || value === 'light' || value === 'dark'
}

function readStoredSettings(): LocalSettings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (!raw) return { units: localeDefaultUnits(), theme: DEFAULT_SETTINGS.theme }
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null)
      return { units: localeDefaultUnits(), theme: DEFAULT_SETTINGS.theme }
    const record = parsed as Record<string, unknown>
    return {
      units: isUnits(record.units) ? record.units : localeDefaultUnits(),
      theme: isThemeMode(record.theme) ? record.theme : DEFAULT_SETTINGS.theme,
    }
  } catch {
    // Corrupt JSON or blocked storage (private mode): fall back to defaults
    // without throwing — settings are a preference, never a gate.
    return { units: localeDefaultUnits(), theme: DEFAULT_SETTINGS.theme }
  }
}

// ── Module store (same pattern as lib/guest-rides: module state +
// localStorage mirror, no provider plumbing) ──────────────────────────────

let current: LocalSettings =
  typeof window === 'undefined' ? { ...DEFAULT_SETTINGS } : readStoredSettings()

const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) listener()
}

function persist(settings: LocalSettings): void {
  try {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // Blocked storage: keep the in-memory value for this session.
  }
}

export function getSettingsSnapshot(): LocalSettings {
  return current
}

export function getSettingsServerSnapshot(): LocalSettings {
  return DEFAULT_SETTINGS
}

function subscribeSettings(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function updateSettings(patch: Partial<LocalSettings>): void {
  const next: LocalSettings = {
    units: patch.units && isUnits(patch.units) ? patch.units : current.units,
    theme: patch.theme && isThemeMode(patch.theme) ? patch.theme : current.theme,
  }
  if (next.units === current.units && next.theme === current.theme) return
  current = next
  persist(current)
  applyThemeMode(current.theme)
  notify()
}

export function useSettings(): {
  settings: LocalSettings
  updateSettings: (patch: Partial<LocalSettings>) => void
} {
  const settings = useSyncExternalStore(
    subscribeSettings,
    getSettingsSnapshot,
    getSettingsServerSnapshot,
  )
  return { settings, updateSettings }
}

// ── UI mode → `.dark` on <html> ───────────────────────────────────────────
// Every color utility resolves through CSS vars, so toggling one class
// re-skins the whole app (dark values live in the `.dark` block in
// src/index.css; Tailwind `darkMode: 'class'` enables future `dark:`
// variants too).

const DARK_QUERY = '(prefers-color-scheme: dark)'

function systemPrefersDark(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia(DARK_QUERY).matches
  )
}

export function resolveIsDark(mode: ThemeMode): boolean {
  if (mode === 'dark') return true
  if (mode === 'light') return false
  return systemPrefersDark()
}

export function applyThemeMode(mode: ThemeMode): void {
  if (typeof document === 'undefined') return
  const isDark = resolveIsDark(mode)
  document.documentElement.classList.toggle('dark', isDark)
  syncFavicon(isDark)
}

// Tab-icon follows the resolved theme. An SVG-embedded media query (the
// GitHub trick) would only track the OS — explicit light/dark overrides
// need the href swapped here (and in the index.html pre-paint script).
const FAVICON_LIGHT_HREF = '/favicon.svg'
const FAVICON_DARK_HREF = '/favicon-dark.svg'

function syncFavicon(isDark: boolean): void {
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
  if (!link) return
  const href = isDark ? FAVICON_DARK_HREF : FAVICON_LIGHT_HREF
  if (link.getAttribute('href') !== href) link.setAttribute('href', href)
}

let themeInitDone = false

// Boot wiring (called once from main.tsx): paint the stored/system theme
// over the index.html pre-paint script's work, then stay live — OS theme
// flips re-resolve while on `system`, and other tabs' changes arrive via
// the storage event.
export function initSettingsTheme(): void {
  if (typeof window === 'undefined' || themeInitDone) return
  themeInitDone = true
  applyThemeMode(current.theme)
  if (typeof window.matchMedia === 'function') {
    const mql = window.matchMedia(DARK_QUERY)
    const onChange = () => {
      if (getSettingsSnapshot().theme === 'system') {
        applyThemeMode('system')
        notify()
      }
    }
    // `addEventListener` is universal in our browsers; Safari < 14 had
    // addListener — long dead, not worth the branch.
    mql.addEventListener('change', onChange)
  }
  window.addEventListener('storage', (event) => {
    if (event.key !== SETTINGS_STORAGE_KEY) return
    current = readStoredSettings()
    applyThemeMode(current.theme)
    notify()
  })
}

// ── Units formatting (display only) ───────────────────────────────────────

const M_TO_FT = 3.28084
const KMH_TO_MPH = 0.621371

function groupThousands(value: number): string {
  return value.toLocaleString('en-US')
}

export function formatHeightM(heightM: number, units: Units): string {
  if (units === 'imperial') return `${groupThousands(Math.round(heightM * M_TO_FT))} ft`
  return `${groupThousands(heightM)} m`
}

export function formatSpeedKmh(speedKmh: number, units: Units): string {
  if (units === 'imperial') return `${groupThousands(Math.round(speedKmh * KMH_TO_MPH))} mph`
  return `${groupThousands(speedKmh)} km/h`
}

export function formatLengthM(lengthM: number, units: Units): string {
  if (units === 'imperial') return `${groupThousands(Math.round(lengthM * M_TO_FT))} ft`
  return `${groupThousands(lengthM)} m`
}
