/**
 * Scenario: coaster-manufacturer-heading previews — manufacturer moved off
 * the identity eyebrow (now park + place only) into the specs section
 * heading, replacing the generic "Coaster details" label.
 *
 * Run: cd scripts && npx tsx src/e2e/scenarios/previews-coaster-manufacturer.ts
 * Requires: worktree app dev server on :5199
 *   (cd ../app && npm run dev -- --port 5199 --strictPort)
 *
 * State tier 2 (fake session + mockSupabase): every Supabase surface the
 * detail page touches is fulfilled locally — zero prod contact. Mirrors the
 * mockDetailData approach from previews-coaster-detail-polish.ts.
 */
import { config } from 'dotenv'
config({ path: new URL('../../../../.env', import.meta.url).pathname })

import { chromium, type Browser, type Page } from 'playwright'
import {
  capturePreviews,
  mockSupabase,
  openPreview,
  prSnippet,
  waitForVisible,
  type PreviewKind,
} from '../previews'
import { ensureServer } from '../helpers'
import type { RankingRow } from '../../../../app/src/lib/board-types'

const SLUG = 'coaster-manufacturer-heading'
const FAKE_ID = '00000000-0000-4000-8000-0000000000aa'
const DETAIL_URL = 'http://localhost:5199/coasters/steel-vengeance'

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

async function mockDetailData(page: Page): Promise<void> {
  await mockSupabase(page, {
    tables: { user_rides: [], profiles: fakeProfile() },
    rpcs: { public_board_meta: freshMeta() },
  })
  await page.route(
    (url) => url.href.includes('/rest/v1/v_coaster_rankings') && !isSingleRow(url),
    (route) => route.fulfill({ json: [row] }),
  )
  await page.route(
    (url) => url.href.includes('/rest/v1/v_coaster_rankings') && isSingleRow(url),
    (route) => route.fulfill({ json: row }),
  )
}

async function openLoadedDetail(browser: Browser, kind: PreviewKind): Promise<Page> {
  const page = await openPreview(browser, kind, {
    session: { id: FAKE_ID, email: 'preview@coasterrank.dev', username: 'preview_rider' },
  })
  await mockDetailData(page)
  await page.goto(DETAIL_URL)
  await waitForVisible(page, 'main')
  await waitForVisible(page, 'text=Rocky Mountain Construction')
  return page
}

async function main(): Promise<void> {
  await ensureServer() // dev server on :5199
  const browser = await chromium.launch()
  try {
    const detailFiles = await capturePreviews(
      browser,
      SLUG,
      '01-detail',
      (kind) => openLoadedDetail(browser, kind),
      { clip: 'main' },
    )

    console.log(prSnippet(SLUG, [...detailFiles]))
  } finally {
    await browser.close()
  }
}

void main()
