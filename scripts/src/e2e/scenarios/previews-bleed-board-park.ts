/**
 * Scenario: bleed-board-park previews — full-bleed table/header bands on
 * mobile for the board and park detail pages (UI PR: "bleed: board + park").
 *
 * Run: cd scripts && npx tsx src/e2e/scenarios/previews-bleed-board-park.ts
 * (dev server must be up first: cd app && npm run dev -- --port 5199 --strictPort)
 *
 * State tier 2 (no session + mockSupabase): logged-out board and park views;
 * ranking rows, park list, and the public_board_meta RPC are fixtures. The
 * park page's single-park query shares the /rest/v1/parks path with the
 * board-data park list, so a predicate route registered after mockSupabase
 * serves the object fixture for the slug query. Zero prod contact expected.
 */
import { config } from 'dotenv'
config({ path: new URL('../../../../.env', import.meta.url).pathname })

import { chromium } from 'playwright'
import { capturePreviews, mockSupabase, openPreview, prSnippet, waitForVisible } from '../previews'
import { ensureServer } from '../helpers'

const SLUG = 'bleed-board-park'

const PARK_ID = '00000000-0000-4000-8000-0000000000cp'

function row(
  id: string,
  name: string,
  slug: string,
  rank: number,
  score: number,
  manufacturer: string,
) {
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
    manufacturer_name: manufacturer,
    manufacturer_names: [manufacturer],
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
  row(
    '00000000-0000-4000-8000-0000000000sv',
    'Steel Vengeance',
    'steel-vengeance',
    1,
    1.529,
    'Rocky Mountain Construction',
  ),
  row('00000000-0000-4000-8000-0000000000mv', 'Maverick', 'maverick', 2, 1.31, 'Intamin'),
  row(
    '00000000-0000-4000-8000-0000000000mg',
    'Magnum XL-200',
    'magnum-xl-200',
    3,
    0.87,
    'Arrow Dynamics',
  ),
]

const parkList = [
  {
    id: PARK_ID,
    name: 'Cedar Point',
    slug: 'cedar-point',
    country: 'USA',
    region: 'Ohio',
    city: 'Sandusky',
  },
]

const parkSingle = {
  id: PARK_ID,
  name: 'Cedar Point',
  slug: 'cedar-point',
  country: 'USA',
  region: 'Ohio',
  city: 'Sandusky',
  lat: null,
  lng: null,
  source: 'preview',
  external_id: null,
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
    files.push(
      ...(await capturePreviews(
        browser,
        SLUG,
        'board',
        async (kind) => {
          const page = await openPreview(browser, kind)
          await mockSupabase(page, {
            tables: { v_coaster_rankings: rows, parks: parkList, manufacturers: [] },
            rpcs,
          })
          await page.goto('http://localhost:5199/')
          await waitForVisible(page, 'text=Steel Vengeance')
          return page
        },
        { fullPage: false },
      )),
    )

    files.push(
      ...(await capturePreviews(
        browser,
        SLUG,
        'park',
        async (kind) => {
          const page = await openPreview(browser, kind)
          await mockSupabase(page, {
            tables: { v_coaster_rankings: rows, parks: parkList, manufacturers: [] },
            rpcs,
          })
          // Single-park query (usePark) shares the parks path — predicate
          // route wins for the slug query, list fixture serves board data.
          await page.route(
            (url) => url.pathname.endsWith('/rest/v1/parks') && url.search.includes('slug=eq.'),
            (route) => route.fulfill({ json: parkSingle }),
          )
          await page.goto('http://localhost:5199/parks/cedar-point')
          await waitForVisible(page, 'text=Top coaster in this park')
          return page
        },
        { fullPage: false },
      )),
    )
    console.log(prSnippet(SLUG, files))
  } finally {
    await browser.close()
  }
}

void main()
