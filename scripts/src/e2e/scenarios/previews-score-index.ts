/**
 * Scenario: score index-scale previews — coaster detail page hero rendering
 * the shared ×100 index score (UI PR: "score display: site-wide index scale").
 *
 * Run: cd scripts && npx tsx src/e2e/scenarios/previews-score-index.ts
 *
 * State tier 2 (fake session + mockSupabase): every table the fake user owns
 * (profiles, user_rides) plus the ranking view row + aliases are fixture
 * mocks; public_board_meta is mocked so the freshness marker reads "minutes
 * ago" deterministically. The only prod contact is whatever anon pass-through
 * the page triggers — none expected; prodReads is printed to verify.
 */
import { config } from 'dotenv'
config({ path: new URL('../../../../.env', import.meta.url).pathname })

import { chromium } from 'playwright'
import { capturePreviews, mockSupabase, openPreview, prSnippet, waitForVisible } from '../previews'
import { ensureServer } from '../helpers'
import type { RankingRow } from '../../../../app/src/lib/board-types'

const SLUG = 'score-index-scale'
const FAKE_ID = '00000000-0000-4000-8000-00000000000aa'

// Realistic board-shaped row: raw BT strength 1.029 must display as 102.9 —
// the same value the board's ScorePill shows for the same coaster.
const row: RankingRow = {
  id: '00000000-0000-4000-8000-0000000000sv',
  park_id: '00000000-0000-4000-8000-0000000000cp',
  name: 'Steel Vengeance',
  slug: 'steel-vengeance',
  manufacturer_id: null,
  model: 'Hyper-Hybrid',
  opening_date: '2018-05-05',
  status: 'operating',
  material: 'steel',
  height_m: 62,
  speed_kmh: 120,
  length_m: 1146,
  inversions: 4,
  type: 'Hyper-Hybrid',
  park_name: 'Cedar Point',
  park_slug: 'cedar-point',
  park_country: 'United States',
  park_city: 'Sandusky, Ohio',
  manufacturer_name: 'Rocky Mountain Construction',
  aliases: [],
  score: 1.029,
  comparisons: 423,
  participants: 131,
  first_place_votes: 42,
  rank: 3,
  rank_last_week: 5,
}

async function main(): Promise<void> {
  await ensureServer() // dev server on :5199
  const browser = await chromium.launch()
  try {
    const files = await capturePreviews(
      browser,
      SLUG,
      'detail-hero',
      async (kind) => {
        const page = await openPreview(browser, kind, {
          session: {
            id: FAKE_ID,
            email: 'preview@coasterrank.dev',
            username: 'preview_rider',
          },
        })
        await mockSupabase(page, {
          tables: {
            v_coaster_rankings: [row],
            coaster_aliases: [],
            user_rides: [],
            profiles: {
              id: FAKE_ID,
              username: 'preview_rider',
              display_name: 'Preview Rider',
              avatar_url: null,
              is_admin: false,
              public_list: false,
              og_image_url: null,
            },
          },
          rpcs: {
            public_board_meta: [
              { last_recomputed_at: new Date(Date.now() - 6 * 60_000).toISOString() },
            ],
          },
        })
        await page.goto('http://localhost:5199/coasters/steel-vengeance')
        await waitForVisible(page, 'main')
        return page
      },
      { clip: 'main' },
    )
    console.log(prSnippet(SLUG, files))
  } finally {
    await browser.close()
  }
}

void main()
