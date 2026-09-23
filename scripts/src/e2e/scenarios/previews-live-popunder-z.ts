/**
 * Scenario: live-popunder-z previews — Live stats popunder vs sticky filter bar.
 *
 * Run: cd scripts && npx tsx src/e2e/scenarios/previews-live-popunder-z.ts
 * (dev server must be up first: cd app && npm run dev -- --port 5199 --strictPort)
 *
 * State tier 2 (no session + mockSupabase): zero prod writes. The board catalog
 * is fully mocked (a few rows — no scroll needed); only unmocked public reads
 * would pass through as anon — logged via prodReads() below.
 *
 * The regression: the mobile sticky filter wrapper sat at z-20, tying the
 * hero's LiveStatusPopunder (z-20, earlier in the DOM) and painting over it,
 * so the live stats popup hid behind the bleed filter bar. The fix drops the
 * wrapper to z-10. These shots pin the popunder open over the filter bar.
 */
import { config } from 'dotenv'
config({ path: new URL('../../../../.env', import.meta.url).pathname })

import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { chromium, type Browser } from 'playwright'
import { mockSupabase, openPreview, previewFile, prSnippet, waitForVisible } from '../previews'
import { ensureServer } from '../helpers'

const SLUG = 'live-popunder-z'
const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5199'

const PARK_ID = '00000000-0000-4000-8000-0000000000cp'

function row(id: string, name: string, slug: string, rank: number, score: number) {
  return {
    id,
    park_id: PARK_ID,
    name,
    slug,
    manufacturer_id: null,
    model: null,
    opening_date: null,
    status: 'operating',
    material: 'steel',
    height_m: null,
    speed_kmh: null,
    length_m: null,
    inversions: null,
    type: null,
    park_name: 'Cedar Point',
    park_slug: 'cedar-point',
    park_country: 'United States',
    park_city: 'Sandusky, Ohio',
    manufacturer_name: 'Bolliger & Mabillard',
    manufacturer_names: ['Bolliger & Mabillard'],
    aliases: [],
    score,
    comparisons: 423,
    participants: 131,
    first_place_votes: 42,
    rank,
    rank_last_week: rank,
  }
}

const rows = [
  row('00000000-0000-4000-8000-000000000010', 'Steel Vengeance', 'steel-vengeance', 1, 1.5),
  row('00000000-0000-4000-8000-000000000020', 'Maverick', 'maverick', 2, 1.3),
  row('00000000-0000-4000-8000-000000000030', 'Magnum XL-200', 'magnum-xl-200', 3, 1.1),
]

const tables = {
  v_coaster_rankings: rows,
  parks: [
    {
      id: PARK_ID,
      name: 'Cedar Point',
      slug: 'cedar-point',
      country: 'United States',
      region: 'Ohio',
      city: 'Sandusky',
    },
  ],
  manufacturers: [],
}

const rpcs = {
  public_board_meta: [
    {
      last_recomputed_at: new Date(Date.now() - 6 * 60_000).toISOString(),
      real_user_count: 120,
      ranked_user_count: 80,
    },
  ],
}

const FREEZE_CSS =
  '*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }'

async function main(): Promise<void> {
  await ensureServer()
  const browser: Browser = await chromium.launch()
  const files: string[] = []
  try {
    for (const kind of ['mobile', 'desktop'] as const) {
      const page = await openPreview(browser, kind)
      const handle = await mockSupabase(page, { tables, rpcs })
      await page.goto(`${BASE}/`)
      await waitForVisible(page, 'text=Steel Vengeance')
      // Pin the popunder open (click toggles pinnedOpen for touch/mouse).
      await page.getByRole('button', { name: 'Live' }).click()
      await waitForVisible(page, 'text=Last changed')
      await page.addStyleTag({ content: FREEZE_CSS })
      await page.evaluate(() => document.fonts.ready)
      // Paint-order assertion: every probed point of the popup must resolve
      // inside the popunder — never inside the sticky filter bar below it.
      const paint = await page.evaluate(() => {
        const pop = document.querySelector('div[role="status"].absolute')
        if (!pop) return { mounted: false }
        const r = pop.getBoundingClientRect()
        const cx = r.left + r.width / 2
        const hits = [r.top + 6, r.top + r.height / 2, r.bottom - 6].map((y) => {
          const el = document.elementFromPoint(cx, y)
          return !!el?.closest?.('div[role="status"].absolute')
        })
        return { mounted: true, hits }
      })
      console.log(`[${kind}] popunder paint:`, JSON.stringify(paint))
      if (!paint.mounted || !paint.hits?.every(Boolean)) {
        throw new Error(`[${kind}] Live popunder is covered by the filter bar`)
      }
      const outPath = previewFile(SLUG, '01-live-popunder-open', kind)
      await mkdir(dirname(outPath), { recursive: true })
      await page.screenshot({ path: outPath, fullPage: false })
      files.push(outPath)
      console.log(
        `[${SLUG}/01-live-popunder-open-${kind}] prod reads:`,
        JSON.stringify(handle.prodReads()),
      )
      await page.context().close()
    }
    console.log(prSnippet(SLUG, files))
  } finally {
    await browser.close()
  }
}

void main()
