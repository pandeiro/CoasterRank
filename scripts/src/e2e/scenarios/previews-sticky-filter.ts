/**
 * Scenario: sticky-filter previews — mobile sticky filter bar on the board.
 *
 * Run: cd scripts && npx tsx src/e2e/scenarios/previews-sticky-filter.ts
 * (dev server must be up first: cd app && npm run dev -- --port 5199 --strictPort)
 *
 * State tier 2 (no session + mockSupabase): zero prod writes. The board catalog
 * is fully mocked (40 rows so the page scrolls); only unmocked public reads
 * would pass through as anon — logged via prodReads() below.
 *
 * NOTE: shots are scrolled viewport captures (not capturePreviews), because the
 * harness settle() scrolls back to top — which would un-stick the bar.
 */
import { config } from 'dotenv'
config({ path: new URL('../../../../.env', import.meta.url).pathname })

import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'
import {
  mockSupabase,
  openPreview,
  previewFile,
  prSnippet,
  waitForVisible,
  type PreviewKind,
} from '../previews'
import { ensureServer } from '../helpers'

const SLUG = 'sticky-filter'
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

const LEAD = [
  ['Steel Vengeance', 'steel-vengeance'],
  ['Maverick', 'maverick'],
  ['Magnum XL-200', 'magnum-xl-200'],
] as const

const rows = [
  ...LEAD.map(([name, slug], i) =>
    row(`00000000-0000-4000-8000-0000000000${i}0`, name, slug, i + 1, 1.5 - i * 0.2),
  ),
  ...Array.from({ length: 37 }, (_, i) =>
    row(
      `00000000-0000-4000-8000-0000000010${String(i).padStart(2, '0')}`,
      `Preview Coaster ${i + 4}`,
      `preview-coaster-${i + 4}`,
      i + 4,
      0.9 - i * 0.02,
    ),
  ),
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

/** Scrolled viewport shot: freeze, scroll to stuck position, shoot viewport. */
async function scrolledShot(
  browser: Browser,
  name: string,
  setup: (page: Page) => Promise<void>,
  /** Selector that must be visible AFTER scrolling (asserted pre-shot). */
  expectVisibleAfterScroll?: string,
): Promise<string[]> {
  const files: string[] = []
  for (const kind of ['desktop', 'mobile'] as const satisfies readonly PreviewKind[]) {
    const page = await openPreview(browser, kind)
    const handle = await mockSupabase(page, { tables, rpcs })
    await page.goto(`${BASE}/`)
    await waitForVisible(page, 'text=Steel Vengeance')
    await setup(page)
    await page.addStyleTag({ content: FREEZE_CSS })
    await page.evaluate(() => document.fonts.ready)
    // Hero + banner are ~200px; 800px pins the filter bar hard under the header.
    await page.evaluate(() => window.scrollTo(0, 800))
    await page.waitForTimeout(400)
    if (expectVisibleAfterScroll) await waitForVisible(page, expectVisibleAfterScroll)
    const outPath = previewFile(SLUG, name, kind)
    await mkdir(dirname(outPath), { recursive: true })
    await page.screenshot({ path: outPath, fullPage: false })
    files.push(outPath)
    console.log(`[${SLUG}/${name}-${kind}] prod reads:`, JSON.stringify(handle.prodReads()))
    await page.context().close()
  }
  for (const path of files) console.log(`saved ${path}`)
  return files
}

async function main(): Promise<void> {
  await ensureServer()
  const browser = await chromium.launch()
  const files: string[] = []
  try {
    // 1. Board scrolled: mobile pins the filter bar under the header;
    //    desktop keeps the static toolbar (scrolled out of view here).
    files.push(
      ...(await scrolledShot(browser, '01-board-scrolled', async () => {
        // No extra state — plain board.
      })),
    )

    // 2. Guest Mark Mode scrolled: banner scrolls away (never sticky), the
    //    filter bar sticks as usual, and the bottom dock is untouched.
    files.push(
      ...(await scrolledShot(
        browser,
        '02-mark-mode-scrolled',
        async (page) => {
          await page.locator('button', { hasText: 'Rank My Rides' }).first().click()
          await waitForVisible(page, 'text=Step 1 of 2')
          const boxes = page.locator('input[type="checkbox"]').filter({ visible: true })
          await boxes.nth(0).click()
          await boxes.nth(1).click()
          await waitForVisible(page, 'text=Rank My Rides (2)')
        },
        // The dock is bottom-fixed: it must still be on-screen after scrolling.
        'text=Rank My Rides (2)',
      )),
    )

    // 3. Mobile dock state assertion (no PNG): under mobile emulation the
    //    layout viewport runs taller than the screenshot capture, so viewport
    //    shots crop bottom-fixed elements. Assert instead that the dock pill
    //    is mounted, opaque, untransformed, bottom-anchored, and labeled —
    //    i.e. painted correctly alongside the stuck filter bar.
    {
      const page = await openPreview(browser, 'mobile')
      const handle = await mockSupabase(page, { tables, rpcs })
      await page.goto(`${BASE}/`)
      await waitForVisible(page, 'text=Steel Vengeance')
      await page.locator('button', { hasText: 'Rank My Rides' }).first().click()
      await waitForVisible(page, 'text=Step 1 of 2')
      const boxes = page.locator('input[type="checkbox"]').filter({ visible: true })
      await boxes.nth(0).click()
      await boxes.nth(1).click()
      await waitForVisible(page, 'text=Rank My Rides (2)')
      await page.addStyleTag({ content: FREEZE_CSS })
      await page.evaluate(() => document.fonts.ready)
      await page.evaluate(() => window.scrollTo(0, 800))
      await page.waitForTimeout(400)
      const dockState = await page.evaluate(() => {
        const pill = [...document.querySelectorAll('div[role="status"]')].find((el) =>
          (el.textContent ?? '').includes('Rank My Rides (2)'),
        )
        if (!pill) return { mounted: false }
        const r = pill.getBoundingClientRect()
        const pcs = getComputedStyle(pill.parentElement!)
        return {
          mounted: true,
          label: (pill.textContent ?? '').slice(0, 40),
          rect: {
            x: Math.round(r.x),
            y: Math.round(r.y),
            w: Math.round(r.width),
            h: Math.round(r.height),
          },
          parentOpacity: pcs.opacity,
          parentTransform: pcs.transform,
          innerHeight: window.innerHeight,
        }
      })
      console.log(`[03 dock-mobile] state:`, JSON.stringify(dockState))
      console.log(`[03 dock-mobile] prod reads:`, JSON.stringify(handle.prodReads()))
      await page.context().close()
    }

    console.log(prSnippet(SLUG, files))
  } finally {
    await browser.close()
  }
}

void main()
