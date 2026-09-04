/**
 * One-off: regenerate a rider's OG share card PNG and refresh their profile.
 *
 * Motivation: cards generated before the static-content redesign (PR #119)
 * baked in a `rankedCount` that went stale the moment rides changed — one
 * beta user's unfurl showed "0 coasters ranked" with 96 rides logged. The
 * redesign removed the stats, but the guard added there skips regeneration
 * when nothing baked changed, so existing stale cards need a one-time reset.
 *
 * Uses the same canvas drawing as app/src/lib/og-card.ts (port of the
 * post-redesign drawCard), with the bottom-left brand lockup mirroring the
 * app header proportions (Layout.tsx: h-7 mark + sm:text-xl wordmark,
 * gap-2, items-center — scaled 2x to this card's 40px wordmark). The mark is
 * read from the same checkout's app/public/logo-reversed.svg, then:
 *   1. uploads the PNG to storage avatars/<uid>/og-card.png (upsert)
 *   2. updates profiles.og_image_url
 *
 * Dry-run by default: renders the PNG, saves it to /tmp for inspection, and
 * touches nothing upstream. Pass --apply to write to storage + profile.
 *
 * Usage: cd scripts && npx tsx src/oneoff/regen-og-card.ts <username> [--apply]
 */
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { supabaseAdmin } from './db/client'

const SCRIPT_DIR = new URL('.', import.meta.url).pathname
// The mark comes from the same checkout (app/public/logo-reversed.svg — the
// dark-surface variant), so future mark redesigns are picked up on re-run.
const BRAND_MARK_PATH = join(SCRIPT_DIR, '..', '..', '..', 'app', 'public', 'logo-reversed.svg')

const username = process.argv[2]
const apply = process.argv.includes('--apply')

if (!username) {
  console.error('Usage: npx tsx src/oneoff/regen-og-card.ts <username> [--apply]')
  process.exit(1)
}

// Port of app/src/lib/og-card.ts drawCard (post-redesign static layout):
// identity content only — name, username, avatar, bars motif, brand.
const CARD_JS = `
  const CANVAS = '#FEFCF3', INK = '#1A1A2E', ACCENT = '#48CAE4', CORAL = '#E85D75'
  const DISPLAY = '"Racing Sans One", Arial, sans-serif'
  const BODY = 'Inter, system-ui, sans-serif'

  function fitText(text, maxWidth, measure) {
    if (measure(text) <= maxWidth) return text
    let low = 0, high = text.length
    while (low < high) {
      const mid = Math.ceil((low + high) / 2)
      if (measure(text.slice(0, mid) + '…') <= maxWidth) low = mid
      else high = mid - 1
    }
    return text.slice(0, low) + '…'
  }

  function drawAvatar(ctx, img, cx, cy, radius) {
    ctx.save()
    ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.closePath(); ctx.clip()
    const size = Math.min(img.width, img.height)
    ctx.drawImage(img, (img.width - size) / 2, (img.height - size) / 2, size, size,
      cx - radius, cy - radius, radius * 2, radius * 2)
    ctx.restore()
    ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2)
    ctx.strokeStyle = ACCENT; ctx.lineWidth = 5; ctx.stroke()
  }

  async function render({ name, username, avatarSrc, brandMarkSrc, brandMarkAspect }) {
    const canvas = document.getElementById('card')
    const ctx = canvas.getContext('2d')
    // A canvas-only page never triggers @font-face loads on its own, so
    // fonts.ready resolves immediately with fallbacks — force the loads.
    await Promise.all([
      document.fonts.load('64px "Racing Sans One"'),
      document.fonts.load('40px "Racing Sans One"'),
      document.fonts.load('400 30px Inter'),
    ]).catch(() => {})
    await document.fonts.ready
    let avatar = null
    if (avatarSrc) {
      avatar = await new Promise((resolve) => {
        const img = new Image()
        img.crossOrigin = 'anonymous'
        img.onload = () => resolve(img)
        img.onerror = () => resolve(null)
        img.src = avatarSrc
      })
    }
    let brandMark = null
    if (brandMarkSrc) {
      brandMark = await new Promise((resolve) => {
        const img = new Image()
        img.onload = () => resolve(img)
        img.onerror = () => resolve(null)
        img.src = brandMarkSrc
      })
    }
    ctx.fillStyle = INK
    ctx.fillRect(0, 0, 1200, 630)
    const bars = 7, barW = 62, gap = 22
    const x0 = 1200 - 70 - (bars * barW + (bars - 1) * gap)
    const baseline = 520
    const heights = [110, 145, 185, 230, 285, 345, 410]
    for (let i = 0; i < bars; i++) {
      ctx.fillStyle = i === bars - 1 ? CORAL : ACCENT
      ctx.fillRect(x0 + i * (barW + gap), baseline - heights[i], barW, heights[i])
    }
    const textX = 96
    let textY = 0
    if (avatar) { drawAvatar(ctx, avatar, textX + 84, 158, 84); textY = 330 }
    else { textY = 210 }
    ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left'
    ctx.fillStyle = CANVAS; ctx.font = '64px ' + DISPLAY
    ctx.fillText(fitText(name, 620, (s) => ctx.measureText(s).width), textX, textY)
    ctx.fillStyle = ACCENT; ctx.font = '30px ' + BODY
    ctx.fillText('@' + username, textX, textY + 52)
    // Bottom-left brand lockup — the canonical #124 workshop-winner spec
    // (BoardPage.tsx masthead): mark at natural aspect, 4rem tall (64px),
    // baseline-aligned (mark bottom on the wordmark baseline), tight gap-x-1
    // (4px), wordmark 2.6rem leading-none tracking-wide raised -0.12em to
    // ride the mark's mid-slope.
    const wordSize = 41.6 // 2.6rem
    const markH = 64
    const gapX = 4
    ctx.letterSpacing = (wordSize * 0.025).toFixed(2) + 'px' // tracking-wide
    ctx.font = wordSize + 'px ' + DISPLAY
    let brandX = 96
    if (brandMark && brandMarkAspect) {
      const markW = markH * brandMarkAspect // items-baseline + w-auto: natural aspect
      ctx.drawImage(brandMark, brandX, 566 - markH, markW, markH)
      brandX += markW + gapX
    }
    const wordBaseline = 566 - wordSize * 0.12 // -translate-y-[0.12em]
    ctx.fillStyle = CANVAS
    ctx.fillText('Coaster', brandX, wordBaseline)
    const w = ctx.measureText('Coaster').width
    ctx.fillStyle = CORAL
    ctx.fillText('Rank', brandX + w, wordBaseline)
    return canvas.toDataURL('image/png')
  }
`

const cardHtml = (profile: {
  name: string
  username: string
  avatarUrl: string | null
  brandMarkSrc: string | null
  brandMarkAspect: number | null
}) => `
<!doctype html><html><head>
<meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Racing+Sans+One&display=swap" rel="stylesheet">
<style>html,body{margin:0}</style>
</head><body>
<canvas id="card" width="1200" height="630"></canvas>
<script>${CARD_JS}
  window.__render = () => render(${JSON.stringify({
    name: profile.name,
    username: profile.username,
    avatarSrc: profile.avatarUrl,
    brandMarkSrc: profile.brandMarkSrc,
    brandMarkAspect: profile.brandMarkAspect,
  })})
</script>
</body></html>`

async function main(usernameArg: string) {
  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .select('id, username, display_name, avatar_url')
    .ilike('username', usernameArg)
    .limit(1)
    .maybeSingle()
  if (error || !profile) {
    console.error(`Profile not found for username '${username}':`, error?.message ?? 'no row')
    process.exit(1)
  }
  console.log(`Profile: ${profile.display_name ?? ''} (@${profile.username}) ${profile.id}`)

  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1240, height: 670 } })
  page.on('pageerror', (error) => console.error('Page error:', error.message))
  // Inline the mark as a data URL: relative paths don't resolve under
  // page.setContent, and this avoids CORS entirely for the canvas draw.
  let brandMarkSrc: string | null = null
  let brandMarkAspect: number | null = null
  if (existsSync(BRAND_MARK_PATH)) {
    const svg = readFileSync(BRAND_MARK_PATH, 'utf8')
    // Parse the viewBox for the natural aspect ratio (page-side `naturalWidth`
    // is unreliable for width/height-less SVGs rendered headlessly).
    const viewBox = /viewBox="[\d.+-]+ [\d.+-]+ ([\d.+-]+) ([\d.+-]+)"/.exec(svg)
    if (viewBox && Number(viewBox[2]) > 0) brandMarkAspect = Number(viewBox[1]) / Number(viewBox[2])
    brandMarkSrc = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
  }
  if (!brandMarkSrc) {
    console.warn('Brand mark not found — card falls back to wordmark-only:', BRAND_MARK_PATH)
  }
  await page.setContent(
    cardHtml({
      name: profile.display_name || profile.username || '',
      username: profile.username || '',
      avatarUrl: profile.avatar_url,
      brandMarkSrc,
      brandMarkAspect,
    }),
    { waitUntil: 'networkidle' },
  )
  const dataUrl = await page.evaluate(
    () => (window as unknown as { __render: () => Promise<string> }).__render(),
  )
  await browser.close()

  const png = Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64')
  const outPath = join(tmpdir(), `${profile.username}-og-card.png`)
  writeFileSync(outPath, png)
  console.log(`Rendered ${png.length} bytes → ${outPath}`)

  if (!apply) {
    console.log('Dry run — no upload, no profile update. Re-run with --apply to write.')
    return
  }

  const storagePath = `${profile.id}/og-card.png`
  const { error: uploadError } = await supabaseAdmin.storage
    .from('avatars')
    .upload(storagePath, png, { contentType: 'image/png', upsert: true, cacheControl: '300' })
  if (uploadError) {
    console.error('Storage upload failed:', uploadError.message)
    process.exit(1)
  }
  const { data } = supabaseAdmin.storage.from('avatars').getPublicUrl(storagePath)
  const { error: updateError } = await supabaseAdmin
    .from('profiles')
    .update({ og_image_url: data.publicUrl })
    .eq('id', profile.id)
  if (updateError) {
    console.error('Profile update failed:', updateError.message)
    process.exit(1)
  }
  console.log(`Uploaded + set og_image_url = ${data.publicUrl}`)
}

main(username)
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
