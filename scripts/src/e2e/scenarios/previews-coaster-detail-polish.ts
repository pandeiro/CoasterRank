/**
 * Scenario: coaster-detail-polish previews — 8-cell spec grid, explainer
 * icon fix, and detail-page skeletons (UI PR: "Coaster Detail polish").
 *
 * Run: cd scripts && npx tsx src/e2e/scenarios/previews-coaster-detail-polish.ts
 * Requires: worktree app dev server on :5199
 *   (cd ../app && npm run dev -- --port 5199 --strictPort)
 *
 * State tier 2 (fake session + mockSupabase): every Supabase surface the
 * detail pages touch is fulfilled locally — zero prod contact. The
 * single-row view queries (`slug=eq.`) and the board-data list queries share
 * a table path, so predicate routes tell them apart (maybeSingle takes an
 * object, list queries take arrays). Loading shots delay the single-row
 * response and screenshot inside the delay window; the try/catch around the
 * delayed fulfill tolerates the context closing right after the shot.
 */
import { config } from 'dotenv'
config({ path: new URL('../../../../.env', import.meta.url).pathname })

import { chromium, type Browser, type Page, type Route } from 'playwright'
import {
  capturePreviews,
  mockSupabase,
  openPreview,
  prSnippet,
  visibleFirst,
  waitForVisible,
  type PreviewKind,
} from '../previews'
import { ensureServer } from '../helpers'
import type { RankingRow } from '../../../../app/src/lib/board-types'

const SLUG = 'coaster-detail-polish'
const FAKE_ID = '00000000-0000-4000-8000-0000000000aa'
const DETAIL_URL = 'http://localhost:5199/coasters/steel-vengeance'
const PARK_URL = 'http://localhost:5199/parks/cedar-point'
// Longer than settle + screenshot (<2s), short enough to keep runs snappy.
const SKELETON_DELAY_MS = 10_000

// Realistic board-shaped row exercising every new cell: physical specs plus
// track (model), material, opening year, and status.
const row: RankingRow = {
  id: '00000000-0000-4000-8000-0000000000sv',
  park_id: '00000000-0000-4000-8000-0000000000cp',
  name: 'Steel Vengeance',
  slug: 'steel-vengeance',
  manufacturer_id: null,
  model: 'I-Box Track',
  opening_date: '2018-05-05',
  status: 'operating',
  material: 'steel',
  height_m: 62,
  speed_kmh: 120,
  length_m: 1750,
  inversions: 4,
  type: 'Steel',
  park_name: 'Cedar Point',
  park_slug: 'cedar-point',
  park_country: 'United States',
  park_city: 'Sandusky',
  manufacturer_name: 'Rocky Mountain Construction',
  aliases: ['Mean Streak'],
  score: 2.5,
  comparisons: 423,
  participants: 131,
  first_place_votes: 42,
  rank: 3,
  rank_last_week: 5,
}

const parkRow = {
  id: '00000000-0000-4000-8000-0000000000cp',
  name: 'Cedar Point',
  slug: 'cedar-point',
  country: 'United States',
  region: 'Ohio',
  city: 'Sandusky',
}

function freshMeta() {
  return [{ last_recomputed_at: new Date(Date.now() - 6 * 60_000).toISOString() }]
}

function fakeProfile() {
  return {
    id: FAKE_ID,
    username: 'preview_rider',
    display_name: 'Preview Rider',
    avatar_url: null,
    is_admin: false,
    public_list: false,
    og_image_url: null,
  }
}

const isSingleRow = (url: URL) => url.search.includes('slug=eq.')

/**
 * Local fixtures for every surface the detail pages touch: the single-row
 * view queries (object), the board-data list queries the Layout search bar
 * fires (arrays), the owned tables, and the meta RPC. With everything local,
 * prodReads stays empty.
 */
async function mockDetailData(page: Page): Promise<void> {
  await mockSupabase(page, {
    tables: { user_rides: [], profiles: fakeProfile() },
    rpcs: { public_board_meta: freshMeta() },
  })
  // Newest-first matching: register the general list routes before the
  // single-row overrides so the slug=eq. requests hit the object fixtures.
  await page.route(
    (url) => url.href.includes('/rest/v1/v_coaster_rankings') && !isSingleRow(url),
    (route) => route.fulfill({ json: [row] }),
  )
  await page.route(
    (url) => url.href.includes('/rest/v1/parks') && !isSingleRow(url),
    (route) => route.fulfill({ json: [parkRow] }),
  )
  await page.route(
    (url) => url.href.includes('/rest/v1/v_coaster_rankings') && isSingleRow(url),
    (route) => route.fulfill({ json: row }),
  )
  await page.route(
    (url) => url.href.includes('/rest/v1/parks') && isSingleRow(url),
    (route) => route.fulfill({ json: parkRow }),
  )
}

/** Same as mockDetailData, but the single-row view query hangs so the page
 * holds its skeleton; the shot happens inside the delay window. */
async function mockDelayedSingle(page: Page, table: 'v_coaster_rankings' | 'parks'): Promise<void> {
  await mockDetailData(page)
  const body = table === 'v_coaster_rankings' ? row : parkRow
  await page.route(
    (url) => url.href.includes(`/rest/v1/${table}`) && isSingleRow(url),
    async (route: Route) => {
      try {
        await new Promise((resolve) => setTimeout(resolve, SKELETON_DELAY_MS))
        await route.fulfill({ json: body })
      } catch {
        // The capture closes the context right after the shot while this
        // fulfill is still pending — that is the expected path, not a failure.
      }
    },
  )
}

async function openSessionPage(browser: Browser, kind: PreviewKind): Promise<Page> {
  return openPreview(browser, kind, {
    session: { id: FAKE_ID, email: 'preview@coasterrank.dev', username: 'preview_rider' },
  })
}

async function openLoadedDetail(browser: Browser, kind: PreviewKind): Promise<Page> {
  const page = await openSessionPage(browser, kind)
  await mockDetailData(page)
  await page.goto(DETAIL_URL)
  await waitForVisible(page, 'main')
  await waitForVisible(page, 'text=Coaster details')
  return page
}

async function main(): Promise<void> {
  await ensureServer() // dev server on :5199
  const browser = await chromium.launch()
  try {
    // 1. Loaded detail page: 8-cell spec grid + fixed explainer button row.
    const detailFiles = await capturePreviews(
      browser,
      SLUG,
      '01-detail',
      (kind) => openLoadedDetail(browser, kind),
      { clip: 'main' },
    )

    // 2. Explainer popover open: the "How is this calculated?" button with
    // its icon, in context.
    const explainerFiles = await capturePreviews(
      browser,
      SLUG,
      '02-explainer',
      async (kind) => {
        const page = await openLoadedDetail(browser, kind)
        await visibleFirst(page, 'button:has-text("How is this calculated?")').click()
        await waitForVisible(page, 'text=Bradley-Terry model')
        return page
      },
      { clip: 'main' },
    )

    // 3. Coaster loading skeleton.
    const loadingFiles = await capturePreviews(
      browser,
      SLUG,
      '03-loading',
      async (kind) => {
        const page = await openSessionPage(browser, kind)
        await mockDelayedSingle(page, 'v_coaster_rankings')
        await page.goto(DETAIL_URL)
        await waitForVisible(page, '[aria-label="Loading coaster details"]')
        return page
      },
      { clip: 'main' },
    )

    // 4. Park loading skeleton.
    const parkLoadingFiles = await capturePreviews(
      browser,
      SLUG,
      '04-park-loading',
      async (kind) => {
        const page = await openSessionPage(browser, kind)
        await mockDelayedSingle(page, 'parks')
        await page.goto(PARK_URL)
        await waitForVisible(page, '[aria-label="Loading park details"]')
        return page
      },
      { clip: 'main' },
    )

    console.log(
      prSnippet(SLUG, [...detailFiles, ...explainerFiles, ...loadingFiles, ...parkLoadingFiles]),
    )
  } finally {
    await browser.close()
  }
}

void main()
