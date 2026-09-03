import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync } from 'fs'
import { execFileSync } from 'child_process'
import { chromium } from 'playwright'

// Regenerates every Heartline mark variant.
//
// Traced full-mark variants: from trace-cut.svg (potrace logo preset on the
// source sketch with a surgical rail cut — see README).
//
// Mini mark (v3): the user's winning simplification (hill + heart + loop, from
// the logo-lab toggles, captured in mini-source.png). Thickness is a LADDER of
// levels: each component's rasterized mask is grown/shrunk with morphology,
// neighbors are mutually excluded (gaps shrink but never fuse), the original
// silhouette is unioned back in (no bites), and each layer is retraced.

const here = new URL('.', import.meta.url).pathname
const tmp = `${here}.tmp-mini`
const T = {
  ink: '#1A1A2E',
  canvas: '#FEFCF3',
  accent: '#48CAE4',
  coral: '#E85D75',
}

// ---------------------------------------------------------------------------
// traced full-mark variants (path data in 0.1pt units over 14360x6020, y-up)
// ---------------------------------------------------------------------------
const svgIn = readFileSync(`${here}trace-cut.svg`, 'utf8')
const paths = [...svgIn.matchAll(/<path d="([^"]+)"/g)].map((m) => m[1])
if (paths.length !== 12) throw new Error(`expected 12 traced components, got ${paths.length}`)

// Component index map (verified visually against the trace):
// 0 hill · 1 support line · 2 left lattice · 3 hill2 · 4 track · 5 loop
// 6 heart+pulse · 7 right rails+lattice · 8 tail · 9-11 baseline ticks
const byIdx = paths
const el = {
  hill: byIdx[0],
  support: byIdx[1],
  latticeL: byIdx[2],
  hill2: byIdx[3],
  track: byIdx[4],
  loop: byIdx[5],
  heart: byIdx[6],
  railsR: byIdx[7],
  tail: byIdx[8],
  tick1: byIdx[9],
  tick2: byIdx[10],
  tick3: byIdx[11],
}

const VB = '0 0 1436 602'
const W = 'translate(0,602) scale(0.1,-0.1)'

const group = (fills) =>
  Object.entries(fills)
    .map(([name, color]) => `<path d="${el[name]}" fill="${color}"/>`)
    .join('\n  ')

function svg({ body, viewBox = VB, bg = null, rx = 0 }) {
  const bgRect = bg ? `<rect x="0" y="0" width="100%" height="100%" fill="${bg}"${rx ? ` rx="${rx}"` : ''}/>` : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">
  <title>CoasterRank Heartline mark</title>
  ${bgRect}<g transform="${W}">
  ${body}
  </g>
</svg>
`
}

const structure = {
  hill: T.ink,
  hill2: T.ink,
  track: T.ink,
  support: T.ink,
  latticeL: T.ink,
  railsR: T.ink,
  tail: T.ink,
  tick1: T.ink,
  tick2: T.ink,
  tick3: T.ink,
}

const all = (color) => Object.fromEntries(Object.keys(el).map((k) => [k, color]))

const variants = {
  'heartline-signature': svg({
    body: group({ ...structure, track: T.coral, heart: T.coral, loop: T.accent }),
  }),
  'heartline-heart': svg({ body: group({ ...structure, heart: T.coral, loop: T.accent }) }),
  'heartline-heritage': svg({
    body: group({ ...structure, latticeL: T.accent, railsR: T.accent, support: T.accent, track: T.coral, heart: T.coral }),
  }),
  'heartline-duotone': svg({ body: group({ ...all(T.ink), heart: T.coral }) }),
  'heartline-mono': svg({ body: group(all(T.ink)) }),
  'heartline-reversed': svg({ body: group({ ...all(T.canvas), heart: T.coral, loop: T.accent }) }),
}

// simplified marks: drop lattice / rails / support / ticks
const markEls = { hill: el.hill, hill2: el.hill2, track: el.track, heart: el.heart, loop: el.loop, tail: el.tail }
const markGroup = (fills) =>
  Object.entries(fills)
    .map(([name, color]) => `<path d="${markEls[name]}" fill="${color}"/>`)
    .join('\n  ')

const markVariants = {
  'heartline-mark': svg({
    body: markGroup({ hill: T.ink, hill2: T.ink, track: T.coral, heart: T.coral, loop: T.accent, tail: T.ink }),
  }),
  'heartline-mark-mono': svg({ body: markGroup(Object.fromEntries(Object.keys(markEls).map((k) => [k, T.ink]))) }),
  'heartline-mark-reversed': svg({
    body: markGroup({ hill: T.canvas, hill2: T.canvas, track: T.canvas, heart: T.coral, loop: T.accent, tail: T.canvas }),
  }),
}

// ---------------------------------------------------------------------------
// badges
// ---------------------------------------------------------------------------
function heartBadge({ bg, glyph }) {
  // heart glyph in path units: x 7180-10090, v 120-3150 (v = (602 - y_pt) * 10)
  const size = 1024
  const s = 620 / 2910
  const gx = size / 2 - s * ((7180 + 10090) / 2)
  const gy = size / 2 + s * ((120 + 3150) / 2)
  const tf = `translate(${gx.toFixed(1)},${gy.toFixed(1)}) scale(${s.toFixed(5)},${(-s).toFixed(5)})`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <title>CoasterRank app icon</title>
  <rect width="1024" height="1024" rx="232" fill="${bg}"/>
  <g transform="${tf}">
    <path d="${el.heart}" fill="${glyph}"/>
  </g>
</svg>
`
}

function markBadge({ bg, colors }) {
  const size = 1024
  const s = 860 / 14360
  const gx = size / 2 - s * (14360 / 2)
  const gy = size / 2 + s * (6020 / 2)
  const tf = `translate(${gx.toFixed(1)},${gy.toFixed(1)}) scale(${s.toFixed(5)},${(-s).toFixed(5)})`
  const body = Object.entries(colors)
    .map(([name, color]) => `<path d="${markEls[name]}" fill="${color}"/>`)
    .join('\n    ')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <title>CoasterRank app icon</title>
  <rect width="1024" height="1024" rx="232" fill="${bg}"/>
  <g transform="${tf}">
    ${body}
  </g>
</svg>
`
}

const badgeVariants = {
  'heartline-badge-ink': heartBadge({ bg: T.ink, glyph: T.coral }),
  'heartline-badge-coral': heartBadge({ bg: T.coral, glyph: T.canvas }),
  'heartline-badge-canvas': heartBadge({ bg: T.canvas, glyph: T.ink }),
  'heartline-badge-mark': markBadge({
    bg: T.ink,
    colors: { hill: T.canvas, hill2: T.canvas, track: T.coral, heart: T.coral, loop: T.accent, tail: T.canvas },
  }),
}

// lockups (text renders with Racing Sans One when opened directly in a browser; Arial fallback otherwise)
function lockup({ stacked }) {
  const fs = 168
  const markH = 340
  const s = markH / 6020
  const markW = markH * (1436 / 602)
  const gap = 56
  const text = `Coaster<tspan fill="${T.coral}">Rank</tspan>`
  const markFills = { hill: T.ink, hill2: T.ink, track: T.coral, heart: T.coral, loop: T.accent, tail: T.ink }
  if (!stacked) {
    const w = 80 + markW + gap + 1150
    const h = 480
    const ty = h / 2 + markH / 2
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">
  <title>CoasterRank lockup</title>
  <g transform="translate(40,${ty.toFixed(1)}) scale(${s.toFixed(5)},${(-s).toFixed(5)})">
    ${markGroup(markFills)}
  </g>
  <text x="${(40 + markW + gap).toFixed(0)}" y="${(h / 2 + fs * 0.35).toFixed(0)}" font-family="'Racing Sans One', Arial, sans-serif" font-size="${fs}" fill="${T.ink}">${text}</text>
</svg>
`
  }
  const w = 1200
  const h = 200 + markH + 40 + fs * 1.2
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">
  <title>CoasterRank lockup stacked</title>
  <g transform="translate(${((w - markW) / 2).toFixed(1)},${(200 + markH).toFixed(1)}) scale(${s.toFixed(5)},${(-s).toFixed(5)})">
    ${markGroup(markFills)}
  </g>
  <text x="${w / 2}" y="${(200 + markH + 40 + fs).toFixed(0)}" text-anchor="middle" font-family="'Racing Sans One', Arial, sans-serif" font-size="${fs}" fill="${T.ink}">${text}</text>
</svg>
`
}

// ---------------------------------------------------------------------------
// mini mark (v3): thickness ladder from mini-source.png
// ---------------------------------------------------------------------------
const MINI_SRC = `${here}mini-source.png`
const MINI_W = 922
const MINI_H = 452
const MINI_SCALE = 2 // rasterize masks at 2x for potrace quality
// k = px growth (positive thickens via Erode on dark shapes); index 0 = thinnest
const MINI_LEVELS = [-2, 0, 2, 4, 6]

function potraceLayer(png) {
  const pbm = png.replace(/\.png$/, '.pbm')
  const out = png.replace(/\.png$/, '.svg')
  execFileSync('magick', [png, '-compress', 'none', pbm])
  execFileSync('potrace', ['-b', 'svg', '-q', '--turdsize', '5', '--alphamax', '1.2', '-o', out, pbm])
  return [...readFileSync(out, 'utf8').matchAll(/<path d="([^"]+)"/g)].map((m) => m[1])
}

function bboxOf(d) {
  // potrace path data: absolute M + relative c chains (0.1pt units, y-up canvas)
  const tokens = d.match(/[MmCcLlHhVvZz]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? []
  let i = 0
  let cx = 0, cy = 0, sx = 0, sy = 0
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  const next = () => parseFloat(tokens[i++])
  const isNum = () => i < tokens.length && !/^[A-Za-z]$/.test(tokens[i])
  const pt = (x, y) => {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  while (i < tokens.length) {
    const c = tokens[i++]
    if (c === 'M' || c === 'm') {
      let first = true
      while (isNum()) {
        if (c === 'M') { cx = next(); cy = next() } else { cx += next(); cy += next() }
        if (first) { sx = cx; sy = cy; first = false }
        pt(cx, cy)
        if (c === 'M') break
      }
      sx = cx; sy = cy
    } else if (c === 'C' || c === 'c') {
      while (isNum()) {
        const x0 = cx, y0 = cy
        const dx1 = next(), dy1 = next(), dx2 = next(), dy2 = next(), dx3 = next(), dy3 = next()
        if (c === 'C') {
          pt(dx1, dy1); pt(dx2, dy2); pt(dx3, dy3)
          cx = dx3; cy = dy3
        } else {
          pt(x0 + dx1, y0 + dy1); pt(x0 + dx2, y0 + dy2); pt(x0 + dx3, y0 + dy3)
          cx = x0 + dx3; cy = y0 + dy3
        }
      }
    } else if (c === 'L' || c === 'l') {
      while (isNum()) {
        if (c === 'L') { cx = next(); cy = next() } else { cx += next(); cy += next() }
        pt(cx, cy)
      }
    } else if (c === 'H' || c === 'h') {
      while (isNum()) {
        cx = c === 'H' ? next() : cx + next()
        pt(cx, cy)
      }
    } else if (c === 'V' || c === 'v') {
      while (isNum()) {
        cy = c === 'V' ? next() : cy + next()
        pt(cx, cy)
      }
    } else if (c === 'Z' || c === 'z') {
      cx = sx; cy = sy
    }
  }
  return { minX, minY, maxX, maxY }
}

async function buildMinis() {
  mkdirSync(tmp, { recursive: true })
  // 1. base trace of the user's pick at 2x (threshold 80 so the light cyan survives);
  //    everything downstream shares this 2x coordinate space
  const src2x = `${tmp}mini-source-2x.png`
  execFileSync('magick', ['-quiet', MINI_SRC, '-alpha', 'off', '-resize', '200%', src2x])
  const baseSvg = `${tmp}mini-base.svg`
  execFileSync('bash', [
    '/Users/mu/.agents/skills/png2svg/png2svg.sh',
    '--preprocess', 'logo', '--threshold', '80', '--output', baseSvg, src2x,
  ])
  const basePaths = [...readFileSync(baseSvg, 'utf8').matchAll(/<path d="([^"]+)"/g)].map((m) => m[1])
  if (basePaths.length !== 3) throw new Error(`expected 3 base components (hill/heart/loop), got ${basePaths.length}`)

  // 2. classify by bbox: hill = leftmost, loop = rightmost, heart = middle
  const withBox = basePaths.map((d) => ({ d, ...bboxOf(d) }))
  withBox.sort((a, b) => a.minX - b.minX)
  const elems = { hill: withBox[0].d, heart: withBox[1].d, loop: withBox[2].d }

  // 3. rasterize each component mask at 2x via playwright
  const browser = await chromium.launch({
    executablePath:
      process.env.CHROME_BIN ??
      '/Users/mu/Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell',
  })
  const page = await browser.newPage({ viewport: { width: MINI_W, height: MINI_H }, deviceScaleFactor: MINI_SCALE })
  const masks = {}
  for (const [name, d] of Object.entries(elems)) {
    const compSvg = `${tmp}mask-${name}.svg`
    writeFileSync(
      compSvg,
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MINI_W} ${MINI_H}"><g transform="translate(0,${MINI_H}) scale(0.1,-0.1)"><path d="${d}" fill="#000"/></g></svg>`,
    )
    const png = `${tmp}mask-${name}.png`
    await page.goto(`file://${compSvg}`)
    await page.screenshot({ path: png, omitBackground: true })
    // flatten onto white (morphology wants opaque)
    execFileSync('magick', ['-quiet', png, '-background', 'white', '-alpha', 'off', '-fuzz', '0%', '-fill', 'black', '+opaque', 'white', png])
    masks[name] = png
  }

  // 4. per level: grow/shrink masks, mutual exclusion, union original, trace
  const MW = MINI_W * MINI_SCALE
  const MH = MINI_H * MINI_SCALE
  const minis = []
  for (let li = 0; li < MINI_LEVELS.length; li++) {
    const k = MINI_LEVELS[li]
    const grown = {}
    for (const [name, mask] of Object.entries(masks)) {
      const out = `${tmp}lvl${li}-${name}.png`
      if (k > 0) execFileSync('magick', ['-quiet', mask, '-morphology', 'Erode', `Disk:${k * MINI_SCALE}`, out])
      else if (k < 0) execFileSync('magick', ['-quiet', mask, '-morphology', 'Dilate', `Disk:${-k * MINI_SCALE}`, out])
      else execFileSync('magick', ['-quiet', mask, out])
      grown[name] = out
    }
    const layers = {}
    for (const name of Object.keys(grown)) {
      const other = Object.keys(grown).filter((n) => n !== name)
      // keep = my grown mask, minus neighbors' grown masks (multiply in white=member domain)
      let keep = `${tmp}lvl${li}-${name}-keep.png`
      execFileSync('magick', ['-quiet', grown[name], '-negate', keep])
      for (const o of other) {
        execFileSync('magick', ['-quiet', keep, grown[o], '-compose', 'Multiply', '-composite', keep])
      }
      // union with my original silhouette so exclusion never bites the body
      // (keep is white=member; the original mask is black=member — negate it first)
      execFileSync('magick', [
        '-quiet', keep, '(', masks[name], '-negate', ')', '-compose', 'Lighten', '-composite', keep,
      ])
      execFileSync('magick', ['-quiet', keep, '-negate', `${tmp}lvl${li}-${name}-l.png`])
      layers[name] = potraceLayer(`${tmp}lvl${li}-${name}-l.png`)
    }
    minis.push(layers)
  }
  await browser.close()

  // 5. viewBox: union of base component bboxes + pad (stable across levels);
  //    all path data lives in 2x 0.1pt units (canvas MINI_W*2 x MINI_H*2, y-up)
  const boxes = Object.values(elems).map((d) => bboxOf(d))
  const u = {
    x0: Math.min(...boxes.map((b) => b.minX)) / 10,
    y0: Math.min(...boxes.map((b) => b.minY)) / 10,
    x1: Math.max(...boxes.map((b) => b.maxX)) / 10,
    y1: Math.max(...boxes.map((b) => b.maxY)) / 10,
  }
  const pad = 16
  const miniVB = `${(u.x0 - pad).toFixed(0)} ${(2 * MINI_H - u.y1 - pad).toFixed(0)} ${(u.x1 - u.x0 + 2 * pad).toFixed(0)} ${(u.y1 - u.y0 + 2 * pad).toFixed(0)}`
  const miniW = u.x1 - u.x0 + 2 * pad
  const miniH = u.y1 - u.y0 + 2 * pad

  const miniSvg = (layers, colors) => {
    const body = [
      ...layers.hill.map((d) => `<path d="${d}" fill="${colors.hill}"/>`),
      ...layers.heart.map((d) => `<path d="${d}" fill="${colors.heart}"/>`),
      ...layers.loop.map((d) => `<path d="${d}" fill="${colors.loop}"/>`),
    ].join('')
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${miniVB}">
  <title>CoasterRank Heartline mini mark</title>
  <g transform="translate(0,${2 * MINI_H}) scale(0.1,-0.1)">${body}</g>
</svg>
`
  }

  const minis_light = {}
  const minis_dark = {}
  MINI_LEVELS.forEach((_, li) => {
    minis_light[`heartline-mini-${li}`] = miniSvg(minis[li], { hill: T.ink, heart: T.coral, loop: T.accent })
    minis_dark[`heartline-mini-${li}-reversed`] = miniSvg(minis[li], { hill: T.canvas, heart: T.coral, loop: T.accent })
  })

  // badge: thickest level (last) reversed, on an ink tile
  const badgeLevel = MINI_LEVELS.length - 1
  const size = 1024
  const bw = 860
  const bh = (bw * miniH) / miniW
  const bx = (size - bw) / 2
  const by = (size - bh) / 2
  const inner = minis_dark[`heartline-mini-${badgeLevel}-reversed`]
    .replace(/^[\s\S]*?<title>[\s\S]*?<\/title>/, '')
    .replace(/<\/svg>\s*$/, '')
  const badgeMini = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">
  <title>CoasterRank app icon</title>
  <rect width="${size}" height="${size}" rx="232" fill="${T.ink}"/>
  <svg x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${bw}" height="${bh.toFixed(1)}" viewBox="${miniVB}">${inner}</svg>
</svg>
`

  writeFileSync(tmp + '/MARKER.txt', 'here'); console.log('TMP CONTENTS:', require('fs').readdirSync(tmp).length, 'files at buildMinis end')
  return { minis_light, minis_dark, badgeMini, miniVB }
}

const { minis_light, minis_dark, badgeMini, miniVB } = await buildMinis()

// ---------------------------------------------------------------------------
// emit
// ---------------------------------------------------------------------------
const out = {
  ...variants,
  ...markVariants,
  ...badgeVariants,
  ...minis_light,
  ...minis_dark,
  'heartline-badge-mini': badgeMini,
  'heartline-lockup': lockup({ stacked: false }),
  'heartline-lockup-stacked': lockup({ stacked: true }),
}

const dest = new URL('../../../../app/public/logos/', import.meta.url).pathname
mkdirSync(dest, { recursive: true })
for (const [name, content] of Object.entries(out)) {
  writeFileSync(`${dest}/${name}.svg`, content)
}
// keep tmp for debugging
console.log(`wrote ${Object.keys(out).length} variants (mini viewBox: ${miniVB}) to ${dest}`)
