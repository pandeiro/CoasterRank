import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { refreshOgCard, generateOgCardBlob, fitText, type OgCardSpec } from './og-card'
import { supabase } from './supabase'

vi.mock('./supabase', () => ({
  supabase: {
    storage: {
      from: vi.fn(),
    },
    from: vi.fn(),
  },
}))

const spec: OgCardSpec = {
  name: 'Coaster Fan',
  username: 'coaster_fan',
  avatarSrc: null,
  topCoaster: 'Steel Vengeance',
  rankedCount: 12,
}

describe('fitText', () => {
  const measure = (value: string) => value.length

  it('returns the text untouched when it fits', () => {
    expect(fitText('abcdef', 6, measure)).toBe('abcdef')
    expect(fitText('abc', 6, measure)).toBe('abc')
  })

  it('truncates with an ellipsis when it does not fit', () => {
    // "ab…" is exactly 3 chars wide; "abc…" would be 4.
    expect(fitText('abcdef', 3, measure)).toBe('ab…')
  })

  it('handles very narrow widths', () => {
    expect(fitText('abcdef', 1, measure)).toBe('…')
  })
})

describe('generateOgCardBlob', () => {
  const originalCreateElement = document.createElement.bind(document)

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns null when canvas is unsupported', async () => {
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      if (tag === 'canvas') {
        return { width: 0, height: 0, getContext: () => null } as unknown as HTMLCanvasElement
      }
      return originalCreateElement(tag)
    }) as typeof document.createElement)

    await expect(generateOgCardBlob(spec)).resolves.toBeNull()
  })
})

describe('refreshOgCard', () => {
  const upload = vi.fn()
  const getPublicUrl = vi.fn()
  const update = vi.fn()
  const originalCreateElement = document.createElement.bind(document)

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(supabase.storage.from).mockReturnValue({
      upload,
      getPublicUrl,
    } as never)
    vi.mocked(supabase.from).mockReturnValue({ update } as never)
    update.mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) })
    getPublicUrl.mockReturnValue({ data: { publicUrl: 'https://img.test/og-card.png' } })
  })

  /** Fake canvas whose toBlob yields a tiny PNG blob. */
  function stubCanvas() {
    const ctx = new Proxy(
      {},
      {
        get: (_target, prop) => {
          if (prop === 'measureText') return () => ({ width: 10 })
          if (prop === 'canvas') return undefined
          return () => undefined
        },
      },
    )
    const fakeCanvas = {
      width: 1200,
      height: 630,
      getContext: () => ctx,
      toBlob: (cb: (blob: Blob | null) => void) => cb(new Blob(['png'], { type: 'image/png' })),
    } as unknown as HTMLCanvasElement
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) =>
      tag === 'canvas' ? fakeCanvas : originalCreateElement(tag)) as typeof document.createElement)
  }

  it('uploads the card, persists the URL, and returns it', async () => {
    stubCanvas()
    upload.mockResolvedValue({ error: null })

    const url = await refreshOgCard({ ...spec, userId: 'u1' })

    expect(url).toBe('https://img.test/og-card.png')
    expect(upload).toHaveBeenCalledWith(
      'u1/og-card.png',
      expect.any(Blob),
      expect.objectContaining({ contentType: 'image/png', upsert: true }),
    )
    expect(supabase.from).toHaveBeenCalledWith('profiles')
    expect(update).toHaveBeenCalledWith({ og_image_url: 'https://img.test/og-card.png' })
  })

  it('resolves to null (never throws) when the upload fails', async () => {
    stubCanvas()
    upload.mockResolvedValue({ error: { message: 'storage down' } })

    await expect(refreshOgCard({ ...spec, userId: 'u1' })).resolves.toBeNull()
  })

  it('resolves to null when canvas rendering is unavailable', async () => {
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      if (tag === 'canvas') {
        return { width: 0, height: 0, getContext: () => null } as unknown as HTMLCanvasElement
      }
      return document.createElement(tag)
    }) as typeof document.createElement)

    await expect(refreshOgCard({ ...spec, userId: 'u1' })).resolves.toBeNull()
    expect(upload).not.toHaveBeenCalled()
  })
})
