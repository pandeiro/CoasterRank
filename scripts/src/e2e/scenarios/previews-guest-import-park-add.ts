/**
 * Scenario: guest-import-park-add previews — the /rank workbench's search +
 * full import entry points (v2.2), the guest import review screen with its
 * cap copy, the park bulk-add picker in board Mark Mode, and /me's
 * "Add from park" button (UI PR: guest import + park bulk-add,
 * docs/product/GUEST_UX.md v2.2).
 *
 * Run: cd scripts && npx tsx src/e2e/scenarios/previews-guest-import-park-add.ts
 * (dev server must be up first: cd app && npm run dev -- --port 5199 --strictPort)
 *
 * State tier 2 (no real session for guest shots + mockSupabase): zero prod
 * writes. Guest state rides localStorage (cr.guest-rides.v1); the /me shot
 * uses a fake session with mocked profiles/user_rides. Only anon pass-through
 * reads of the public catalog touch prod — logged via prodReads().
 */
import { config } from 'dotenv'
config({ path: new URL('../../../../.env', import.meta.url).pathname })

import { chromium, type Page } from 'playwright'
import { capturePreviews, mockSupabase, openPreview, prSnippet, waitForVisible } from '../previews'
import { ensureServer } from '../helpers'

const SLUG = 'guest-import-park-add'
const BASE = 'http://localhost:5199'

const PARK_CP = '00000000-0000-4000-8000-0000000000cp'
const PARK_CAR = '00000000-0000-4000-8000-0000000000ca'
const ID_SV = '00000000-0000-4000-8000-0000000000sv'
const ID_MV = '00000000-0000-4000-8000-0000000000mv'
const ID_MG = '00000000-0000-4000-8000-0000000000mg'
const ID_FURY = '00000000-0000-4000-8000-0000000000fy'
const ID_CHS = '00000000-0000-4000-8000-0000000000cs'
const FAKE_ID = '00000000-0000-4000-8000-0000000000aa'

function row(
  id: string,
  name: string,
  slug: string,
  parkId: string,
  parkName: string,
  parkCity: string,
  rank: number,
  manufacturer: string,
) {
  return {
    id,
    park_id: parkId,
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
    park_name: parkName,
    park_slug: parkName.toLowerCase().replace(/[^a-z]+/g, '-'),
    park_country: 'United States',
    park_city: parkCity,
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

const rows = [
  row(
    ID_SV,
    'Steel Vengeance',
    'steel-vengeance',
    PARK_CP,
    'Cedar Point',
    'Sandusky',
    1,
    'Rocky Mountain Construction',
  ),
  row(ID_MV, 'Maverick', 'maverick', PARK_CP, 'Cedar Point', 'Sandusky', 2, 'Intamin'),
  row(
    ID_MG,
    'Magnum XL-200',
    'magnum-xl-200',
    PARK_CP,
    'Cedar Point',
    'Sandusky',
    3,
    'Arrow Dynamics',
  ),
  row(
    ID_FURY,
    'Fury 325',
    'fury-325',
    PARK_CAR,
    'Carowinds',
    'Charlotte',
    4,
    'Rocky Mountain Construction',
  ),
  row(
    ID_CHS,
    'Copperhead Strike',
    'copperhead-strike',
    PARK_CAR,
    'Carowinds',
    'Charlotte',
    40,
    'Mack Rides',
  ),
]

const parkList = [
  {
    id: PARK_CP,
    name: 'Cedar Point',
    slug: 'cedar-point',
    country: 'United States',
    region: 'Ohio',
    city: 'Sandusky',
  },
  {
    id: PARK_CAR,
    name: 'Carowinds',
    slug: 'carowinds',
    country: 'United States',
    region: 'North Carolina',
    city: 'Charlotte',
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
function guestPayload(
  ordered: {
    id: string
    name: string
    parkId: string
    parkName: string
    parkCity: string
    rank: number | null
    mfg: string | null
  }[],
): string {
  const now = Date.now()
  const items = Object.fromEntries(
    ordered.map((r) => [
      r.id,
      {
        coaster_id: r.id,
        name: r.name,
        slug: r.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        park_id: r.parkId,
        park_slug: r.parkName.toLowerCase().replace(/[^a-z]+/g, '-'),
        park_name: r.parkName,
        park_country: 'United States',
        manufacturer_name: r.mfg,
        material: 'steel',
        status: 'operating',
        board_rank: r.rank,
        added_at: now,
      },
    ]),
  )
  return JSON.stringify({
    version: 1,
    orderedIds: ordered.map((r) => r.id),
    items,
    orderLocked: true,
    createdAt: now,
    updatedAt: now,
  })
}

function cpRows(): Parameters<typeof guestPayload>[0] {
  return rows
    .filter((r) => r.park_id === PARK_CP)
    .map((r) => ({
      id: r.id,
      name: r.name,
      parkId: r.park_id,
      parkName: r.park_name ?? '',
      parkCity: r.park_city ?? '',
      rank: r.rank,
      mfg: r.manufacturer_name,
    }))
}

/** 149 filler rides (one under the cap) — deliberately NOT the rows the
 *  shot pastes, so they land as fresh matches, not "already ranked". */
function capPayload(): string {
  const filler = Array.from({ length: 149 }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    name: `Filler Coaster ${i + 1}`,
    parkId: PARK_CP,
    parkName: 'Cedar Point',
    parkCity: 'Sandusky',
    rank: null,
    mfg: null,
  }))
  return guestPayload(filler)
}

async function seedGuest(page: Page, payload: string): Promise<void> {
  await page.addInitScript(
    ({ key, value }: { key: string; value: string }) => {
      window.localStorage.setItem(key, value)
    },
    { key: GUEST_KEY, value: payload },
  )
}

/** Opens the import modal (empty state CTA or footer button) and parses a
 *  pasted list. */
async function openImportReview(page: Page, pasted: string): Promise<void> {
  await page
    .getByRole('button', { name: /import (list|a spreadsheet)/i })
    .first()
    .click()
  await waitForVisible(page, 'text=Drop a CSV file here')
  await page.getByLabel(/or paste rows/i).fill(pasted)
  await page.locator('button', { hasText: 'Parse pasted rows' }).click()
  await waitForVisible(page, 'text=Review import')
}

async function main(): Promise<void> {
  await ensureServer()
  const browser = await chromium.launch()
  const files: string[] = []
  try {
    // 1. /rank empty state: explainer + Rank My Rides + Import a spreadsheet
    //    (import is no longer a signup incentive — it's a first-class CTA).
    files.push(
      ...(await capturePreviews(
        browser,
        SLUG,
        '01-rank-empty-import',
        async (kind) => {
          const page = await openPreview(browser, kind)
          const handle = await mockSupabase(page, { tables: boardTables, rpcs })
          await page.goto(`${BASE}/rank`)
          await waitForVisible(page, 'text=Nothing marked yet')
          console.log(`[01 ${kind}] prod reads:`, JSON.stringify(handle.prodReads()))
          return page
        },
        { fullPage: false },
      )),
    )

    // 2. The /rank workbench with a seeded list: CoasterSearchBar above the
    //    cards, banner + footer carrying the import entries.
    files.push(
      ...(await capturePreviews(
        browser,
        SLUG,
        '02-rank-workbench-search',
        async (kind) => {
          const page = await openPreview(browser, kind)
          const handle = await mockSupabase(page, { tables: boardTables, rpcs })
          await seedGuest(page, guestPayload(cpRows()))
          await page.goto(`${BASE}/rank`)
          await waitForVisible(page, 'text=New Rider Ranking')
          await waitForVisible(page, 'text=Steel Vengeance')
          console.log(`[02 ${kind}] prod reads:`, JSON.stringify(handle.prodReads()))
          return page
        },
        { fullPage: false },
      )),
    )

    // 3. Guest import review (empty list): 2 matched + 1 not found, the
    //    append-only review with no Merge fieldset. Desktop only — the modal
    //    is the subject.
    files.push(
      ...(await capturePreviews(
        browser,
        SLUG,
        '03-guest-import-review',
        async (kind) => {
          const page = await openPreview(browser, kind)
          const handle = await mockSupabase(page, { tables: boardTables, rpcs })
          await page.goto(`${BASE}/rank`)
          await waitForVisible(page, 'text=Nothing marked yet')
          await openImportReview(page, 'Steel Vengeance\nMaverick\nMadeup Coaster XYZ')
          await waitForVisible(page, 'text=2 matched')
          console.log(`[03 ${kind}] prod reads:`, JSON.stringify(handle.prodReads()))
          return page
        },
        { fullPage: false },
      )),
    )

    // 4. Over-cap review: 149 seeded rides + a 2-row paste → "Import first 1
    //    of 2 coasters" + the anti-spam note. Desktop only.
    files.push(
      ...(await capturePreviews(
        browser,
        SLUG,
        '04-import-cap-note',
        async (kind) => {
          const page = await openPreview(browser, kind)
          const handle = await mockSupabase(page, { tables: boardTables, rpcs })
          await seedGuest(page, capPayload())
          await page.goto(`${BASE}/rank`)
          await waitForVisible(page, 'text=New Rider Ranking')
          await openImportReview(page, 'Steel Vengeance\nMaverick')
          await waitForVisible(page, 'text=/Import first 1 of 2 coasters/i')
          console.log(`[04 ${kind}] prod reads:`, JSON.stringify(handle.prodReads()))
          return page
        },
        { fullPage: false },
      )),
    )

    // 5. Park bulk-add picker in board Mark Mode: "Add from a park" opens
    //    the picker; Cedar Point expanded with per-coaster checkboxes.
    files.push(
      ...(await capturePreviews(
        browser,
        SLUG,
        '05-park-picker-board',
        async (kind) => {
          const page = await openPreview(browser, kind)
          const handle = await mockSupabase(page, { tables: boardTables, rpcs })
          await page.goto(`${BASE}/`)
          await waitForVisible(page, 'text=Steel Vengeance')
          await page.locator('button', { hasText: 'Rank My Rides' }).first().click()
          await waitForVisible(page, 'text=Step 1 of 2')
          // The park entry lives in the FilterBar, next to search — the same
          // slot as on /me and /rank (v2.2 parity).
          await page.getByRole('button', { name: 'Add coasters from a park' }).first().click()
          await waitForVisible(page, 'text=Add coasters from a park')
          await page
            .locator('#modal-content')
            .getByRole('searchbox', { name: /search parks/i })
            .fill('cedar point')
          await waitForVisible(page, 'text=coasters on the board')
          console.log(`[05 ${kind}] modal lis:`, await page.locator('#modal-content li').count())
          await page
            .locator('#modal-content li', { hasText: 'coasters on the board' })
            .first()
            .getByRole('button')
            .click()
          await waitForVisible(page, 'text=Steel Vengeance')
          console.log(`[05 ${kind}] prod reads:`, JSON.stringify(handle.prodReads()))
          return page
        },
        { fullPage: false },
      )),
    )

    // 6. /me sticky bar: "Add from park" beside "Import list" (fake session,
    //    mocked owned tables). Desktop + mobile (icon-only buttons on mobile).
    files.push(
      ...(await capturePreviews(
        browser,
        SLUG,
        '06-me-park-button',
        async (kind) => {
          const page = await openPreview(browser, kind, {
            session: { id: FAKE_ID, email: 'preview@coasterrank.dev', username: 'preview_rider' },
          })
          const handle = await mockSupabase(page, {
            tables: {
              profiles: {
                id: FAKE_ID,
                username: 'preview_rider',
                display_name: 'Preview Rider',
                avatar_url: null,
                is_admin: false,
                public_list: false,
                og_image_url: null,
              },
              // /me embeds each ride's coaster row (manufacturers pinned-FK
              // + parks embeds) — fixture the full shape it selects.
              user_rides: [
                {
                  coaster_id: ID_SV,
                  rank: 1,
                  coasters: {
                    id: ID_SV,
                    name: 'Steel Vengeance',
                    slug: 'steel-vengeance',
                    status: 'operating',
                    material: 'steel',
                    park_id: PARK_CP,
                    manufacturers: { name: 'Rocky Mountain Construction' },
                    parks: { name: 'Cedar Point', country: 'United States' },
                  },
                },
                {
                  coaster_id: ID_MV,
                  rank: 2,
                  coasters: {
                    id: ID_MV,
                    name: 'Maverick',
                    slug: 'maverick',
                    status: 'operating',
                    material: 'steel',
                    park_id: PARK_CP,
                    manufacturers: { name: 'Intamin' },
                    parks: { name: 'Cedar Point', country: 'United States' },
                  },
                },
              ],
            },
            rpcs: { ...rpcs, share_nudge_eligibility: { eligible: false } },
          })
          await page.goto(`${BASE}/me`)
          await waitForVisible(page, 'text=My Coasters')
          await waitForVisible(page, 'text=Steel Vengeance')
          console.log(`[06 ${kind}] prod reads:`, JSON.stringify(handle.prodReads()))
          return page
        },
        { fullPage: false },
      )),
    )
  } finally {
    await browser.close()
  }
  console.log('\nPaste into the PR body:\n')
  console.log(prSnippet(SLUG, files))
}

void main()
