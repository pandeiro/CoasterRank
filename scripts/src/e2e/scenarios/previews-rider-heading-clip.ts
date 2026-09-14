/**
 * Scenario: rider heading clip previews — the /riders/:username display name
 * in Racing Sans One, whose left side-bearing overhangs the em box (a
 * leading lowercase "p" clipped under truncate's overflow-hidden).
 *
 * Run: cd scripts && npx tsx src/e2e/scenarios/previews-rider-heading-clip.ts
 * (dev server must be up first: cd app && npm run dev -- --port 5199 --strictPort)
 *
 * State tier 2 (no session + mockSupabase): only the `public_rider_page` RPC
 * is mocked, with a lowercase-leading display name to exercise the glyph
 * edge. Clipped to the h1 so the PR shows the edge, not the whole page.
 * Prod contact: none expected; prodReads is printed to verify.
 */
import { config } from 'dotenv'
config({ path: new URL('../../../../.env', import.meta.url).pathname })

import { chromium } from 'playwright'
import { capturePreviews, mockSupabase, openPreview, prSnippet, waitForVisible } from '../previews'
import { ensureServer } from '../helpers'

const SLUG = 'rider-heading-clip'

const RIDER = {
  profile: {
    username: 'preview_rider',
    display_name: 'preview rider',
    avatar_url: null,
    og_image_url: null,
    member_since: '2021-06-15T00:00:00Z',
  },
  rides: [
    {
      coaster_id: 'preview-coaster-1',
      rank: 1,
      name: 'Steel Vengeance',
      slug: 'steel-vengeance',
      material: 'steel',
      status: 'operating',
      park_name: 'Cedar Point',
      park_slug: 'cedar-point',
      manufacturer_name: 'Rocky Mountain Construction',
      manufacturer_names: ['Rocky Mountain Construction'],
      score: 1.5,
    },
    {
      coaster_id: 'preview-coaster-2',
      rank: 2,
      name: 'Fury 325',
      slug: 'fury-325',
      material: 'steel',
      status: 'operating',
      park_name: 'Carowinds',
      park_slug: 'carowinds',
      manufacturer_name: 'Bolliger & Mabillard',
      manufacturer_names: ['Bolliger & Mabillard'],
      score: 1.4,
    },
  ],
}

async function main(): Promise<void> {
  await ensureServer() // dev server on :5199
  const browser = await chromium.launch()
  try {
    const files = await capturePreviews(
      browser,
      SLUG,
      'heading',
      async (kind) => {
        const page = await openPreview(browser, kind)
        const handle = await mockSupabase(page, {
          rpcs: { public_rider_page: RIDER },
        })
        await page.goto('http://localhost:5199/riders/preview_rider')
        await waitForVisible(page, 'main')
        await waitForVisible(page, 'h1')
        console.log(`[${SLUG}/heading-${kind}] prodReads:`, JSON.stringify(handle.prodReads()))
        return page
      },
      { clip: 'h1', clipPad: 24 },
    )
    console.log(prSnippet(SLUG, files))
  } finally {
    await browser.close()
  }
}

void main()
