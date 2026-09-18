/**
 * Scenario: user-settings previews — local-only display settings
 * (UI PR: units metric/imperial + UI mode system/light/dark).
 *
 * Run: cd scripts && E2E_BASE_URL=http://localhost:<port> npx tsx src/e2e/scenarios/previews-user-settings.ts
 * (dev server must be up first in the worktree: cd app && npm run dev -- --port <port> --strictPort)
 *
 * State tier 1–2, zero prod writes:
 *  - /settings shots need no session and no Supabase (static page; the
 *    theme/units state is seeded via localStorage in an init script).
 *  - the coaster shot is tier 2 logged-out: the v_coaster_rankings row and
 *    the public_board_meta RPC are fixtures (maybeSingle → single OBJECT).
 *    prodReads() must stay empty — the page is fully fixture-backed.
 *  - design.html needs nothing at all (no data connection).
 */
import { config } from 'dotenv'
config({ path: new URL('../../../../.env', import.meta.url).pathname })

import { chromium } from 'playwright'
import {
  capturePreviews,
  mockSupabase,
  openPreview,
  prSnippet,
  waitForVisible,
  type PreviewKind,
} from '../previews'
import { BASE_URL, ensureServer } from '../helpers'

const SLUG = 'user-settings'

function seedSettings(units: 'metric' | 'imperial', theme: 'system' | 'light' | 'dark') {
  return `window.localStorage.setItem('cr.settings.v1', '${JSON.stringify({ units, theme })}')`
}

const steelVengeance = {
  id: 'row-sv-1',
  park_id: 'park-cedar-point',
  name: 'Steel Vengeance',
  slug: 'steel-vengeance',
  manufacturer_id: null,
  model: 'I-Box Track',
  opening_date: '2018-05-05',
  status: 'operating',
  material: 'steel',
  height_m: 61,
  speed_kmh: 119,
  length_m: 1146,
  inversions: 4,
  type: 'Steel',
  park_name: 'Cedar Point',
  park_slug: 'cedar-point',
  park_country: 'United States',
  park_city: 'Sandusky',
  manufacturer_name: 'Rocky Mountain Construction',
  manufacturer_names: ['Rocky Mountain Construction'],
  aliases: [],
  score: 1.42,
  comparisons: 423,
  participants: 131,
  first_place_votes: 114,
  rank: 1,
  rank_last_week: null,
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

async function main(): Promise<void> {
  await ensureServer()
  const browser = await chromium.launch()
  const files: string[] = []
  try {
    // 1. The settings page: metric + system (light on the capture OS).
    files.push(
      ...(await capturePreviews(
        browser,
        SLUG,
        'settings',
        async (kind: PreviewKind) => {
          const page = await openPreview(browser, kind)
          await page.addInitScript(seedSettings('metric', 'system'))
          await mockSupabase(page)
          await page.goto(`${BASE_URL}/settings`)
          await waitForVisible(page, 'text=Preview — Steel Vengeance: 61 m tall')
          return page
        },
        { fullPage: true },
      )),
    )

    // 2. Same page, dark mode forced.
    files.push(
      ...(await capturePreviews(
        browser,
        SLUG,
        'settings-dark',
        async (kind: PreviewKind) => {
          const page = await openPreview(browser, kind)
          await page.addInitScript(seedSettings('metric', 'dark'))
          await mockSupabase(page)
          await page.goto(`${BASE_URL}/settings`)
          await waitForVisible(page, 'text=Preview — Steel Vengeance: 61 m tall')
          return page
        },
        { fullPage: true },
      )),
    )

    // 3. Imperial units: the preview line converts (200 ft · 74 mph).
    files.push(
      ...(await capturePreviews(
        browser,
        SLUG,
        'settings-imperial',
        async (kind: PreviewKind) => {
          const page = await openPreview(browser, kind)
          await page.addInitScript(seedSettings('imperial', 'light'))
          await mockSupabase(page)
          await page.goto(`${BASE_URL}/settings`)
          await waitForVisible(page, 'text=200 ft tall')
          return page
        },
        { fullPage: true },
      )),
    )

    // 4. Coaster detail in imperial: Height/Speed/Length specs convert.
    files.push(
      ...(await capturePreviews(
        browser,
        SLUG,
        'coaster-imperial',
        async (kind: PreviewKind) => {
          const page = await openPreview(browser, kind)
          await page.addInitScript(seedSettings('imperial', 'light'))
          const handle = await mockSupabase(page, {
            tables: { v_coaster_rankings: steelVengeance },
            rpcs,
          })
          await page.goto(`${BASE_URL}/coasters/steel-vengeance`)
          await waitForVisible(page, 'text=3,760 ft')
          console.log(`[coaster-imperial-${kind}] prod reads:`, JSON.stringify(handle.prodReads()))
          return page
        },
        { fullPage: true },
      )),
    )

    // NOTE: no design.html shot — the Dark mode section is ~2.5 screens
    // tall and the harness clips viewport-relative, so a single section
    // clip can't capture it. Reviewers can open /design.html locally;
    // the user-facing change is fully covered by the four shots above.
    console.log(prSnippet(SLUG, files))
  } finally {
    await browser.close()
  }
}

void main()
