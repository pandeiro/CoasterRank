/**
 * Scenario: button-height-fix previews — the home filter toolbar and the
 * My Coasters search+import row at desktop+mobile viewports, showing the
 * icon-only buttons edge-aligned with their adjacent search inputs.
 *
 * Run: cd scripts && npx tsx src/e2e/scenarios/previews-button-height-fix.ts
 * (worktree app dev server must be up first:
 *  cd ../app && npm run dev -- --port 5199 --strictPort)
 *
 * State tier 2 (mockSupabase): board shot is logged-out with ranking rows,
 * park list, and the public_board_meta RPC as fixtures; the /me shot uses a
 * fake confirmed session with an empty user_rides list (zero ranked shows
 * the search row immediately). Prod contact: anon pass-through only;
 * prodReads is printed to verify.
 */
import { config } from 'dotenv'
config({ path: new URL('../../../../.env', import.meta.url).pathname })

import { chromium } from 'playwright'
import { capturePreviews, mockSupabase, openPreview, prSnippet, waitForVisible } from '../previews'
import { BASE_URL, ensureServer } from '../helpers'

const SLUG = 'button-height-fix'
const FAKE_ID = '00000000-0000-4000-8000-0000000000aa'

const PARK_ID = '00000000-0000-4000-8000-0000000000cp'

function boardRow(id: string, name: string, slug: string, rank: number, manufacturer: string) {
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
    score: 1.5 - rank * 0.1,
    comparisons: 423,
    participants: 131,
    first_place_votes: 42,
    rank,
    rank_last_week: rank,
  }
}

const boardMocks = {
  tables: {
    v_coaster_rankings: [
      boardRow(
        '00000000-0000-4000-8000-0000000000sv',
        'Steel Vengeance',
        'steel-vengeance',
        1,
        'Rocky Mountain Construction',
      ),
      boardRow('00000000-0000-4000-8000-0000000000mv', 'Maverick', 'maverick', 2, 'Intamin'),
      boardRow(
        '00000000-0000-4000-8000-0000000000mg',
        'Magnum XL-200',
        'magnum-xl-200',
        3,
        'Arrow Dynamics',
      ),
    ],
    parks: [{ id: PARK_ID, name: 'Cedar Point', slug: 'cedar-point', country: 'USA' }],
    manufacturers: [],
  },
  rpcs: {
    public_board_meta: [
      {
        last_recomputed_at: new Date(Date.now() - 6 * 60_000).toISOString(),
        real_user_count: 120,
        ranked_user_count: 80,
      },
    ],
  },
}

async function main(): Promise<void> {
  await ensureServer() // worktree dev server on :5199
  const browser = await chromium.launch()
  const files: string[] = []
  try {
    files.push(
      ...(await capturePreviews(
        browser,
        SLUG,
        'filterbar',
        async (kind) => {
          const page = await openPreview(browser, kind)
          const handle = await mockSupabase(page, boardMocks)
          await page.goto(`${BASE_URL}/`)
          await waitForVisible(page, 'input[aria-label="Filter coasters"]')
          await waitForVisible(page, 'text=Steel Vengeance')
          console.log(`[${SLUG}/filterbar-${kind}] prodReads:`, JSON.stringify(handle.prodReads()))
          return page
        },
        { fullPage: false },
      )),
    )

    files.push(
      ...(await capturePreviews(
        browser,
        SLUG,
        'my-coasters',
        async (kind) => {
          const page = await openPreview(browser, kind, {
            session: { id: FAKE_ID, email: 'preview@coasterrank.dev', username: 'preview_rider' },
          })
          const handle = await mockSupabase(page, {
            tables: {
              profiles: {
                id: FAKE_ID,
                username: 'preview_rider',
                display_name: null,
                avatar_url: null,
                is_admin: false,
                og_image_url: null,
                public_list: true,
              },
              user_rides: [],
            },
            rpcs: { share_nudge_eligibility: { eligible: false } },
          })
          await page.goto(`${BASE_URL}/me`)
          await waitForVisible(page, 'input[aria-label="Add coasters to your list"]')
          console.log(
            `[${SLUG}/my-coasters-${kind}] prodReads:`,
            JSON.stringify(handle.prodReads()),
          )
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
