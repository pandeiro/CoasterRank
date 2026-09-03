// Rasterize heartline-badge-mini.svg -> app/public/apple-touch-icon.png (180x180).
// Usage: node src/oneoff/logo-lab/raster-apple-icon.mjs   (from scripts/)
import { chromium } from 'playwright'
import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'

const root = resolve(import.meta.dirname, '../../../..')
const svg = readFileSync(resolve(root, 'app/public/badge.svg'))
const dataHref = `data:image/svg+xml;base64,${svg.toString('base64')}`
const out = resolve(root, 'app/public/apple-touch-icon.png')

const html = `<!doctype html><html><body style="margin:0">
<img src="${dataHref}" width="180" height="180" style="display:block">
</body></html>`

// Cache holds chromium_headless_shell-1228; scripts' playwright pins 1234 — reuse what's here.
const executablePath =
  '/Users/mu/Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell'

const browser = await chromium.launch({ executablePath })
const page = await browser.newPage({
  viewport: { width: 180, height: 180 },
  deviceScaleFactor: 1,
})
await page.setContent(html, { waitUntil: 'networkidle' })
await page.locator('img').screenshot({ path: out })
await browser.close()
console.log('wrote', out)
