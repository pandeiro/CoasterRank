/**
 * Scenario: guest-mark-rank previews — Mark Mode banner/dock on the board,
 * the /rank workbench, and the login merge modal (UI PR: guest mark & rank,
 * docs/GUEST_UX.md).
 *
 * Run: cd scripts && npx tsx src/e2e/scenarios/previews-guest-mark-rank.ts
 * (dev server must be up first: cd app && npm run dev -- --port 5199 --strictPort)
 *
 * State tier 2 (no real session + mockSupabase): zero prod writes. The merge
 * modal shot uses a fake session with a mocked user_rides table; guest state
 * rides localStorage (cr.guest-rides.v1), never the network. Only anon
 * pass-through reads of the public catalog (v_coaster_rankings, parks) touch
 * prod — logged via prodReads() below.
 */
import { config } from 'dotenv'
config({ path: new URL('../../../../.env', import.meta.url).pathname })

import { chromium, type Page } from 'playwright'
import { capturePreviews, mockSupabase, openPreview, prSnippet, waitForVisible } from '../previews'
import { ensureServer } from '../helpers'

const SLUG = 'guest-mark-rank'
const BASE = 'http://localhost:5199'

const PARK_ID = '00000000-0000-4000-8000-0000000000cp'
const ID_SV = '00000000-0000-4000-8000-0000000000sv'
const ID_MV = '00000000-0000-4000-8000-0000000000mv'
const ID_MG = '00000000-0000-4000-8000-0000000000mg'
const FAKE_ID = '00000000-0000-4000-8000-0000000000aa'

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
  row(ID_SV, 'Steel Vengeance', 'steel-vengeance', 1, 1.529, 'Rocky Mountain Construction'),
  row(ID_MV, 'Maverick', 'maverick', 2, 1.31, 'Intamin'),
  row(ID_MG, 'Magnum XL-200', 'magnum-xl-200', 3, 0.87, 'Arrow Dynamics'),
]

const parkList = [
  {
    id: PARK_ID,
    name: 'Cedar Point',
    slug: 'cedar-point',
    country: 'United States',
    region: 'Ohio',
    city: 'Sandusky',
  },
]

const rpcs = {
  public_board_meta: [
    {
      last_recomputed_at: new Date(Date.now() - 6 * 60_000).toISOString(),
      real_user_count: 120,
      ranked_user_count: 80,
    },
  ],
}

const boardTables = {
  v_coaster_rankings: rows,
  parks: parkList,
  manufacturers: [],
}

const GUEST_KEY = 'cr.guest-rides.v1'

/** Seeds the guest store exactly as lib/guest-rides.ts persists it. */
function guestPayload(ids: string[]): string {
  const now = Date.now()
  const items = Object.fromEntries(
    ids.map((id) => {
      const r = rows.find((row) => row.id === id)
      return [
        id,
        {
          coaster_id: id,
          name: r?.name ?? id,
          slug: r?.slug ?? id,
          park_id: PARK_ID,
          park_slug: 'cedar-point',
          park_name: 'Cedar Point',
          park_country: 'United States',
          manufacturer_name: r?.manufacturer_name ?? null,
          material: 'steel',
          status: 'operating',
          board_rank: r?.rank ?? null,
          added_at: now,
        },
      ]
    }),
  )
  return JSON.stringify({
    version: 1,
    orderedIds: ids,
    items,
    orderLocked: true,
    createdAt: now,
    updatedAt: now,
  })
}

async function seedGuest(page: Page, ids: string[]): Promise<void> {
  await page.addInitScript(
    ({ key, payload }: { key: string; payload: string }) => {
      window.localStorage.setItem(key, payload)
    },
    { key: GUEST_KEY, payload: guestPayload(ids) },
  )
}

async function main(): Promise<void> {
  await ensureServer()
  const browser = await chromium.launch()
  const files: string[] = []
  try {
    // 1. Board in Mark Mode: banner above the filters, two rows marked,
    //    dock with the live counter. Logged out (guest flow).
    files.push(
      ...(await capturePreviews(
        browser,
        SLUG,
        '01-mark-mode',
        async (kind) => {
          const page = await openPreview(browser, kind)
          const handle = await mockSupabase(page, { tables: boardTables, rpcs })
          await page.goto(`${BASE}/`)
          await waitForVisible(page, 'text=Steel Vengeance')
          await page.locator('button', { hasText: 'Rank My Rides' }).first().click()
          await waitForVisible(page, 'text=Step 1 of 2')
          const boxes = page.locator('input[type="checkbox"]').filter({ visible: true })
          await boxes.nth(0).click()
          await boxes.nth(1).click()
          await waitForVisible(page, 'text=Rank My Rides (2)')
          console.log(`[01 ${kind}] prod reads:`, JSON.stringify(handle.prodReads()))
          return page
        },
        { fullPage: false },
      )),
    )

    // 2. The /rank workbench: seeded guest list rendered by the same
    //    sortable cards as /me, banner + sticky save bar.
    files.push(
      ...(await capturePreviews(
        browser,
        SLUG,
        '02-rank-workbench',
        async (kind) => {
          const page = await openPreview(browser, kind)
          const handle = await mockSupabase(page, { tables: boardTables, rpcs })
          await seedGuest(page, [ID_SV, ID_MV, ID_MG])
          await page.goto(`${BASE}/rank`)
          await waitForVisible(page, 'text=New Rider Ranking')
          await waitForVisible(page, 'text=Steel Vengeance')
          console.log(`[02 ${kind}] prod reads:`, JSON.stringify(handle.prodReads()))
          return page
        },
        { fullPage: false },
      )),
    )

    // 3. Login merge modal (§4.4): fake session + local guest list against a
    //    ranked account → "You have coasters in progress".
    files.push(
      ...(await capturePreviews(
        browser,
        SLUG,
        '03-merge-modal',
        async (kind) => {
          const page = await openPreview(browser, kind, {
            session: {
              id: FAKE_ID,
              email: 'preview@coasterrank.dev',
              username: 'preview_rider',
            },
          })
          const handle = await mockSupabase(page, {
            tables: {
              user_rides: [{ coaster_id: ID_MV, rank: 1 }],
              // The fake session makes Layout fetch profiles — fixture it so
              // the fake id never touches prod.
              profiles: {
                id: FAKE_ID,
                username: 'preview_rider',
                display_name: 'Preview Rider',
                avatar_url: null,
                is_admin: false,
                public_list: false,
                og_image_url: null,
              },
              ...boardTables,
            },
            rpcs,
          })
          await seedGuest(page, [ID_SV, ID_MG])
          await page.goto(`${BASE}/login`)
          await waitForVisible(page, 'text=You have coasters in progress')
          console.log(`[03 ${kind}] prod reads:`, JSON.stringify(handle.prodReads()))
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
