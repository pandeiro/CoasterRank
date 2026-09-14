/**
 * Scenario: countries previews — the /countries Easter egg (UI PR:
 * "countries: per-country top-five standings").
 *
 * Run: cd scripts && npx tsx src/e2e/scenarios/previews-countries.ts
 * (dev server must be up first: cd app && npm run dev -- --port 5199 --strictPort)
 *
 * State tier 2 (no session + mockSupabase): ranking rows, park list, and the
 * public_board_meta RPC are fixtures; the dev-server /api/ranking fetch misses
 * and the app falls back to the mocked Supabase path. Zero prod contact.
 *
 * Thirteen ranked fixture rides put ghosts at rank 14. Fixtures are tuned
 * so every state shows: the US leads on a full six-ride bench (top-five cap
 * in effect, avg 4.6, B&M the clear top builder), Japan follows (avg 9.8),
 * Germany's two-ride bench drops to third under ghost padding (avg 10.0),
 * and France brings a single ranked ride (avg 13.8).
 *
 * NOTE: the PNGs in docs/previews/countries/ predate ghost padding (they
 * show unpadded averages and short-bench badges) — re-run this scenario to
 * refresh them.
 */
import { config } from 'dotenv'
config({ path: new URL('../../../../.env', import.meta.url).pathname })

import { chromium } from 'playwright'
import { capturePreviews, mockSupabase, openPreview, prSnippet, waitForVisible } from '../previews'
import { ensureServer } from '../helpers'

const SLUG = 'countries'

type FixtureRow = {
  id: string
  name: string
  slug: string
  park: string
  parkSlug: string
  country: string
  rank: number
  score: number
  manufacturer: string
}

function row(r: FixtureRow) {
  return {
    id: r.id,
    park_id: `park-${r.parkSlug}`,
    name: r.name,
    slug: r.slug,
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
    park_name: r.park,
    park_slug: r.parkSlug,
    park_country: r.country,
    park_city: null,
    manufacturer_name: r.manufacturer,
    manufacturer_names: [r.manufacturer],
    aliases: [],
    score: r.score,
    comparisons: 423,
    participants: 131,
    first_place_votes: 0,
    rank: r.rank,
    rank_last_week: null,
  }
}

const rows = [
  // Germany: ghost-padded (3 + 5 + 14 + 14 + 14) / 5 = 10.0.
  row({ id: 'row-de-1', name: 'Wodan', slug: 'wodan', park: 'Europa-Park', parkSlug: 'europa-park', country: 'Germany', rank: 3, score: 1.31, manufacturer: 'Mack Rides' }),
  row({ id: 'row-de-2', name: 'Taron', slug: 'taron', park: 'Phantasialand', parkSlug: 'phantasialand', country: 'Germany', rank: 5, score: 1.27, manufacturer: 'Intamin' }),
  // United States: (1 + 2 + 4 + 7 + 9) / 5 = 4.6 — six ranked, so the
  // rank-14 sixth ride falls outside the average; B&M leads 3-1-1-1.
  row({ id: 'row-us-1', name: 'Steel Vengeance', slug: 'steel-vengeance', park: 'Cedar Point', parkSlug: 'cedar-point', country: 'United States', rank: 1, score: 1.42, manufacturer: 'Rocky Mountain Construction' }),
  row({ id: 'row-us-2', name: 'Fury 325', slug: 'fury-325', park: 'Carowinds', parkSlug: 'carowinds', country: 'United States', rank: 2, score: 1.38, manufacturer: 'Bolliger & Mabillard' }),
  row({ id: 'row-us-3', name: "Apollo's Chariot", slug: 'apollos-chariot', park: 'Busch Gardens Williamsburg', parkSlug: 'busch-gardens-williamsburg', country: 'United States', rank: 4, score: 1.29, manufacturer: 'Bolliger & Mabillard' }),
  row({ id: 'row-us-4', name: 'Millennium Force', slug: 'millennium-force', park: 'Cedar Point', parkSlug: 'cedar-point', country: 'United States', rank: 7, score: 1.24, manufacturer: 'Intamin' }),
  row({ id: 'row-us-5', name: 'Orion', slug: 'orion', park: 'Kings Island', parkSlug: 'kings-island', country: 'United States', rank: 9, score: 1.21, manufacturer: 'Bolliger & Mabillard' }),
  row({ id: 'row-us-6', name: 'The Voyage', slug: 'the-voyage', park: 'Holiday World', parkSlug: 'holiday-world', country: 'United States', rank: 14, score: 1.12, manufacturer: 'Gravity Group' }),
  // Japan: ghost-padded (6 + 8 + 10 + 11 + 14) / 5 = 9.8.
  row({ id: 'row-jp-1', name: 'Steel Dragon 2000', slug: 'steel-dragon-2000', park: 'Nagashima Spa Land', parkSlug: 'nagashima-spa-land', country: 'Japan', rank: 6, score: 1.26, manufacturer: 'Morgan' }),
  row({ id: 'row-jp-2', name: 'Eejanaika', slug: 'eejanaika', park: 'Fuji-Q Highland', parkSlug: 'fuji-q-highland', country: 'Japan', rank: 8, score: 1.22, manufacturer: 'S&S' }),
  row({ id: 'row-jp-3', name: 'Flying Dinosaur', slug: 'flying-dinosaur', park: 'Universal Studios Japan', parkSlug: 'universal-studios-japan', country: 'Japan', rank: 10, score: 1.19, manufacturer: 'Bolliger & Mabillard' }),
  row({ id: 'row-jp-4', name: 'Thunder Dolphin', slug: 'thunder-dolphin', park: 'Tokyo Dome City', parkSlug: 'tokyo-dome-city', country: 'Japan', rank: 11, score: 1.17, manufacturer: 'Intamin' }),
  // France: a single ranked ride, ghost-padded (13 + 14 * 4) / 5 = 13.8.
  row({ id: 'row-fr-1', name: 'OzIris', slug: 'oziris', park: 'Parc Astérix', parkSlug: 'parc-asterix', country: 'France', rank: 13, score: 1.14, manufacturer: 'Bolliger & Mabillard' }),
]

const parkList = [...new Map(rows.map((r) => [r.park_slug, {
  id: `park-${r.park_slug}`,
  name: r.park_name,
  slug: r.park_slug,
  country: r.park_country,
  region: null,
  city: null,
}])).values()]

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
    // The entry point: the board hero with the linked "4 countries" segment.
    files.push(
      ...(await capturePreviews(
        browser,
        SLUG,
        'board-status',
        async (kind) => {
          const page = await openPreview(browser, kind)
          await mockSupabase(page, {
            tables: { v_coaster_rankings: rows, parks: parkList, manufacturers: [] },
            rpcs,
          })
          await page.goto('http://localhost:5199/')
          await waitForVisible(page, 'text=4 countries')
          return page
        },
        { clip: '[data-board-hero]' },
      )),
    )

    // The page itself: full-page layout in both viewports.
    files.push(
      ...(await capturePreviews(
        browser,
        SLUG,
        'countries',
        async (kind) => {
          const page = await openPreview(browser, kind)
          await mockSupabase(page, {
            tables: { v_coaster_rankings: rows, parks: parkList, manufacturers: [] },
            rpcs,
          })
          await page.goto('http://localhost:5199/countries')
          await waitForVisible(page, 'text=avg 4.6')
          return page
        },
        { fullPage: true },
      )),
    )
    console.log(prSnippet(SLUG, files))
  } finally {
    await browser.close()
  }
}

void main()
