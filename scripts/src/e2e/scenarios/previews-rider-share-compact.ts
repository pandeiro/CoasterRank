/**
 * Scenario: rider share compact-hero previews — the /riders/:username hero
 * with the Ranked/Parks/Top-park/Top-builder stats folded into the header's
 * right-hand stack (UI PR: "rider share: compact hero, no stats row").
 *
 * Run: cd scripts && npx tsx src/e2e/scenarios/previews-rider-share-compact.ts
 * (dev server must be up first: cd app && npm run dev -- --port 5199 --strictPort)
 *
 * State tier 2 (no session + mockSupabase): the page is a public share target
 * served by the `public_rider_page` RPC, so only that RPC is mocked — with a
 * 12-ride fixture (Cedar Point ×4 top park, B&M top builder via the
 * preference tiebreak). Captured logged-out: the signup CTA below the list is
 * what a real share visitor sees. Prod contact: anon pass-through only;
 * prodReads is printed to verify.
 */
import { config } from 'dotenv'
config({ path: new URL('../../../../.env', import.meta.url).pathname })

import { chromium } from 'playwright'
import { capturePreviews, mockSupabase, openPreview, prSnippet, waitForVisible } from '../previews'
import { ensureServer } from '../helpers'

const SLUG = 'rider-share-compact'

// Local structural mirror of the app's RiderPageData (lib/rider.ts) — kept
// local so this scenario doesn't pull vite-client modules into the scripts
// typecheck (ImportMeta.env).
type Ride = {
  coaster_id: string
  rank: number
  name: string
  slug: string
  material: string
  status: string
  park_name: string | null
  park_slug: string | null
  manufacturer_name: string | null
  manufacturer_names?: string[] | null
  score: number | null
}

type RiderPageData = {
  profile: {
    username: string
    display_name: string | null
    avatar_url: string | null
    og_image_url: string | null
    member_since: string | null
  }
  rides: Ride[]
}

function ride(
  rank: number,
  name: string,
  slug: string,
  parkName: string,
  parkSlug: string,
  manufacturerName: string,
  score: number,
  manufacturerNames?: string[],
): Ride {
  return {
    coaster_id: `preview-coaster-${rank}`,
    rank,
    name,
    slug,
    material: 'steel',
    status: 'operating',
    park_name: parkName,
    park_slug: parkSlug,
    manufacturer_name: manufacturerName,
    manufacturer_names: manufacturerNames ?? [manufacturerName],
    score,
  }
}

// 12 ranked / 8 parks. Top park Cedar Point (4). Top builder over the top 10
// by rank: B&M 4 (Fury, Leviathan, Orion, Diamondback, avg 1.125) beats
// Intamin 4 (avg 0.95) on the score tiebreak — exercises the preference path.
const RIDER: RiderPageData = {
  profile: {
    username: 'preview_rider',
    display_name: 'Preview Rider',
    avatar_url: null,
    og_image_url: null,
    member_since: '2021-06-15T00:00:00Z',
  },
  rides: [
    ride(
      1,
      'Steel Vengeance',
      'steel-vengeance',
      'Cedar Point',
      'cedar-point',
      'Rocky Mountain Construction',
      1.5,
    ),
    ride(2, 'Fury 325', 'fury-325', 'Carowinds', 'carowinds', 'Bolliger & Mabillard', 1.4),
    ride(3, 'Maverick', 'maverick', 'Cedar Point', 'cedar-point', 'Intamin', 1.3),
    ride(
      4,
      'Leviathan',
      'leviathan',
      "Canada's Wonderland",
      'canadas-wonderland',
      'Bolliger & Mabillard',
      1.2,
    ),
    ride(5, 'Millennium Force', 'millennium-force', 'Cedar Point', 'cedar-point', 'Intamin', 1.1),
    ride(6, 'Orion', 'orion', 'Kings Island', 'kings-island', 'Bolliger & Mabillard', 1.0),
    ride(
      7,
      'Diamondback',
      'diamondback',
      'Kings Island',
      'kings-island',
      'Bolliger & Mabillard',
      0.9,
    ),
    ride(8, 'Top Thrill 2', 'top-thrill-2', 'Cedar Point', 'cedar-point', 'Zamperla', 0.8, [
      'Zamperla',
      'Intamin',
    ]),
    ride(
      9,
      'Iron Gwazi',
      'iron-gwazi',
      'Busch Gardens Tampa',
      'busch-gardens-tampa',
      'Rocky Mountain Construction',
      0.7,
    ),
    ride(
      10,
      'VelociCoaster',
      'velocicoaster',
      'Universal Islands of Adventure',
      'universal-islands-of-adventure',
      'Intamin',
      0.6,
    ),
    ride(
      11,
      'El Toro',
      'el-toro',
      'Six Flags Great Adventure',
      'six-flags-great-adventure',
      'Intamin',
      0.5,
    ),
    ride(
      12,
      'Twisted Timbers',
      'twisted-timbers',
      'Kings Dominion',
      'kings-dominion',
      'Rocky Mountain Construction',
      0.4,
    ),
  ],
}

async function main(): Promise<void> {
  await ensureServer() // dev server on :5199
  const browser = await chromium.launch()
  try {
    const files = await capturePreviews(
      browser,
      SLUG,
      'rider-page',
      async (kind) => {
        // No session: the share audience is logged out, so the growth-loop
        // CTA under the list renders — the realistic screenshot subject.
        const page = await openPreview(browser, kind)
        const handle = await mockSupabase(page, {
          rpcs: { public_rider_page: RIDER },
        })
        await page.goto('http://localhost:5199/riders/preview_rider')
        await waitForVisible(page, 'main')
        await waitForVisible(page, '[data-testid="rider-stats-volume"]')
        await waitForVisible(page, 'text=Build your own ranking')
        console.log(`[${SLUG}/rider-page-${kind}] prodReads:`, JSON.stringify(handle.prodReads()))
        return page
      },
      { fullPage: true },
    )
    console.log(prSnippet(SLUG, files))
  } finally {
    await browser.close()
  }
}

void main()
