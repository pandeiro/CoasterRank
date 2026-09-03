import { supabase } from './supabase'

/**
 * Per-rider OG share card (1200x630), drawn client-side with canvas and
 * uploaded to the public avatars bucket under <uid>/og-card.png (the bucket's
 * RLS allows writes only to the owner's first-level folder, so the card lives
 * beside the avatar). The stored URL lands in profiles.og_image_url, which the
 * Worker and RiderPage use as og:image; NULL falls back to /og-default.png.
 *
 * Best-effort by design: any failure (no canvas support, tainted canvas from a
 * cross-origin avatar, storage error) resolves to null and the static card
 * stays in place — never blocks the profile save/avatar flows.
 */

const OG_CARD_WIDTH = 1200
const OG_CARD_HEIGHT = 630
const STORAGE_BUCKET = 'avatars'

// Brand palette (mirrors app/src/index.css) — hardcoded because the card is a
// standalone raster: it must not depend on runtime CSS.
const CANVAS = '#FEFCF3'
const INK = '#1A1A2E'
const ACCENT = '#48CAE4'
const CORAL = '#E85D75'
const DISPLAY_FONT = '"Racing Sans One", Arial, sans-serif'
const BODY_FONT = 'Inter, system-ui, sans-serif'

/**
 * Pure text fitter: returns the longest prefix of `text` (plus an ellipsis)
 * whose measured width fits `maxWidth`. Kept DOM-free for unit testing.
 */
export function fitText(
  text: string,
  maxWidth: number,
  measure: (value: string) => number,
): string {
  if (measure(text) <= maxWidth) return text
  let low = 0
  let high = text.length
  // Longest prefix that fits (the ellipsis is budgeted inside maxWidth).
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (measure(`${text.slice(0, mid)}…`) <= maxWidth) low = mid
    else high = mid - 1
  }
  return `${text.slice(0, low)}…`
}

// The card bakes in only slow-changing identity content (name, username,
// avatar) — the same fields whose edit points trigger regeneration on the
// ProfilePage. Ride stats deliberately stay OFF the card: they change between
// regen triggers, so any baked count goes stale (og:description carries the
// live count instead — see worker.ts riderMeta).
export type OgCardSpec = {
  name: string
  username: string
  avatarSrc: string | null
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    // Storage URLs are cross-origin; without CORS the canvas would taint and
    // toBlob would throw. On failure we draw the card without the avatar.
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

function drawAvatar(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  cx: number,
  cy: number,
  radius: number,
): void {
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, radius, 0, Math.PI * 2)
  ctx.closePath()
  ctx.clip()
  // Center-crop the avatar into the circle.
  const srcSize = Math.min(img.width, img.height)
  const sx = (img.width - srcSize) / 2
  const sy = (img.height - srcSize) / 2
  ctx.drawImage(img, sx, sy, srcSize, srcSize, cx - radius, cy - radius, radius * 2, radius * 2)
  ctx.restore()
  ctx.beginPath()
  ctx.arc(cx, cy, radius, 0, Math.PI * 2)
  ctx.strokeStyle = ACCENT
  ctx.lineWidth = 5
  ctx.stroke()
}

function drawCard(
  ctx: CanvasRenderingContext2D,
  spec: OgCardSpec,
  avatar: HTMLImageElement | null,
): void {
  const { width: w, height: h } = { width: OG_CARD_WIDTH, height: OG_CARD_HEIGHT }

  ctx.fillStyle = INK
  ctx.fillRect(0, 0, w, h)

  // Rising-bars motif on the right (logo language; last bar = #1, in coral).
  const bars = 7
  const barW = 62
  const gap = 22
  const total = bars * barW + (bars - 1) * gap
  const x0 = w - 70 - total
  const baseline = 520
  const heights = [110, 145, 185, 230, 285, 345, 410]
  for (let i = 0; i < bars; i++) {
    ctx.fillStyle = i === bars - 1 ? CORAL : ACCENT
    const barX = x0 + i * (barW + gap)
    ctx.fillRect(barX, baseline - heights[i], barW, heights[i])
  }

  const textX = 96
  let textY = 0

  if (avatar) {
    drawAvatar(ctx, avatar, textX + 84, 158, 84)
    textY = 330
  } else {
    textY = 210
  }

  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'

  ctx.fillStyle = CANVAS
  ctx.font = `64px ${DISPLAY_FONT}`
  ctx.fillText(
    fitText(spec.name, 620, (s) => ctx.measureText(s).width),
    textX,
    textY,
  )

  ctx.fillStyle = ACCENT
  ctx.font = `30px ${BODY_FONT}`
  ctx.fillText(`@${spec.username}`, textX, textY + 52)

  ctx.fillStyle = CANVAS
  ctx.font = `40px ${DISPLAY_FONT}`
  ctx.fillText('Coaster', textX, 566)
  const coasterWidth = ctx.measureText('Coaster').width
  ctx.fillStyle = CORAL
  ctx.fillText('Rank', textX + coasterWidth, 566)
}

/** Renders the card to a PNG blob. Null when canvas is unavailable. */
export async function generateOgCardBlob(spec: OgCardSpec): Promise<Blob | null> {
  const canvas = document.createElement('canvas')
  canvas.width = OG_CARD_WIDTH
  canvas.height = OG_CARD_HEIGHT
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  // Wait for the web fonts so the card renders with brand typography (no-op
  // when the Font Loading API is unavailable).
  try {
    await document.fonts.ready
  } catch {
    // Fall back to system fonts.
  }

  const avatar = spec.avatarSrc ? await loadImage(spec.avatarSrc) : null
  drawCard(ctx, spec, avatar)

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/png')
  })
}

/**
 * Generate + upload + persist in one best-effort step. Returns the stored
 * og:image URL, or null when the card could not be produced (callers treat
 * that as "keep the static brand card").
 */
export async function refreshOgCard(spec: OgCardSpec & { userId: string }): Promise<string | null> {
  try {
    const blob = await generateOgCardBlob(spec)
    if (!blob) return null

    const path = `${spec.userId}/og-card.png`
    const { error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(path, blob, { contentType: 'image/png', upsert: true, cacheControl: '300' })
    if (uploadError) return null

    const {
      data: { publicUrl },
    } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path)

    const { error: updateError } = await supabase
      .from('profiles')
      .update({ og_image_url: publicUrl })
      .eq('id', spec.userId)
    if (updateError) return null

    return publicUrl
  } catch {
    return null
  }
}
