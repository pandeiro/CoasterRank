import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearChunkReloadGuard,
  hasChunkReloadGuard,
  isChunkLoadError,
  reloadForChunkError,
} from './chunk-recovery'

// The exact message from the reported Sentry events (Chrome, after a deploy
// deletes the old hash and the SPA fallback answers with HTML).
const CHROME_STALE_CHUNK = new TypeError(
  'Failed to fetch dynamically imported module: https://coasterrank.app/assets/CoasterDetailPage-9AVFb0dW.js',
)

describe('isChunkLoadError', () => {
  it('matches the Chrome message seen in production', () => {
    expect(isChunkLoadError(CHROME_STALE_CHUNK)).toBe(true)
  })

  it('matches the other browsers’ and tooling variants', () => {
    expect(
      isChunkLoadError(
        new Error('error loading dynamically imported module https://coasterrank.app/assets/x.js'),
      ),
    ).toBe(true)
    expect(isChunkLoadError(new Error('Importing a module script failed.'))).toBe(true)
    expect(isChunkLoadError(new Error('Unable to preload CSS for /assets/ui-BF77ufjo.css'))).toBe(
      true,
    )
    expect(isChunkLoadError(new Error('Loading chunk 4 failed.'))).toBe(true)
    expect(isChunkLoadError(new Error('Loading css chunk AdminPage failed'))).toBe(true)
  })

  it('rejects unrelated errors and non-Error values', () => {
    expect(isChunkLoadError(new TypeError('Cannot read properties of undefined'))).toBe(false)
    expect(isChunkLoadError(new Error('NetworkError when attempting to fetch resource.'))).toBe(
      false,
    )
    expect(isChunkLoadError('Failed to fetch dynamically imported module: https://x/y.js')).toBe(
      true,
    )
    expect(isChunkLoadError(null)).toBe(false)
    expect(isChunkLoadError(undefined)).toBe(false)
    expect(isChunkLoadError({ status: 404 })).toBe(false)
    expect(isChunkLoadError(new Error())).toBe(false)
  })
})

describe('reloadForChunkError', () => {
  let reload: ReturnType<typeof vi.fn>

  beforeEach(() => {
    sessionStorage.clear()
    reload = vi.fn()
    vi.stubGlobal('location', { reload })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    sessionStorage.clear()
  })

  it('reloads once and arms the guard', () => {
    expect(reloadForChunkError(CHROME_STALE_CHUNK)).toBe(true)
    expect(reload).toHaveBeenCalledTimes(1)
    expect(hasChunkReloadGuard()).toBe(true)
  })

  it('refuses a second attempt while the guard is set (no reload loop)', () => {
    reloadForChunkError(CHROME_STALE_CHUNK)
    reload.mockClear()

    expect(reloadForChunkError(CHROME_STALE_CHUNK)).toBe(false)
    expect(reload).not.toHaveBeenCalled()
  })

  it('ignores unrelated errors entirely', () => {
    expect(reloadForChunkError(new TypeError('Cannot read properties of undefined'))).toBe(false)
    expect(reload).not.toHaveBeenCalled()
    expect(hasChunkReloadGuard()).toBe(false)
  })

  it('refuses to reload when storage is unavailable (loop safety)', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => {
        throw new Error('storage blocked')
      },
      setItem: () => {
        throw new Error('storage blocked')
      },
      removeItem: () => {},
    })

    expect(reloadForChunkError(CHROME_STALE_CHUNK)).toBe(false)
    expect(reload).not.toHaveBeenCalled()
  })
})

describe('guard helpers', () => {
  afterEach(() => {
    sessionStorage.clear()
  })

  it('clearChunkReloadGuard re-arms one-shot recovery', () => {
    sessionStorage.setItem('cr:chunk-reload', new Date().toISOString())
    expect(hasChunkReloadGuard()).toBe(true)

    clearChunkReloadGuard()
    expect(hasChunkReloadGuard()).toBe(false)
  })

  it('hasChunkReloadGuard stays false (not throws) when storage is unavailable', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => {
        throw new Error('storage blocked')
      },
      setItem: () => {
        throw new Error('storage blocked')
      },
      removeItem: () => {},
    })

    expect(hasChunkReloadGuard()).toBe(false)
    expect(() => clearChunkReloadGuard()).not.toThrow()
    vi.unstubAllGlobals()
  })
})
