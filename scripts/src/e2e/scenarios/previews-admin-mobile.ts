/**
 * Scenario: admin-mobile previews — the Admin console on small screens
 * (UI PR: "admin mobile polish").
 *
 * Run: cd scripts && npx tsx src/e2e/scenarios/previews-admin-mobile.ts
 * (dev server must be up first: cd app && npm run dev -- --port 5199 --strictPort)
 *
 * State tier 2 (fake admin session + mockSupabase): the fake admin profile,
 * board catalog slices, manufacturers, and the submission queue are fixture
 * mocks; the admin-users + admin-sharing-metrics Edge Functions are fulfilled
 * by scenario routes registered after mockSupabase (its /functions/v1 abort
 * would otherwise win). Zero prod contact expected; prodReads is printed.
 *
 * Shots:
 *  - admin-submissions: sticky section dropdown + submitter note with a long
 *    URL wrapping instead of breaking the card.
 *  - admin-users: full-width user rows with long emails/names fully visible.
 *  - admin-sharing: compact funnel + traffic cards.
 */
import { config } from 'dotenv'
config({ path: new URL('../../../../.env', import.meta.url).pathname })

import { chromium } from 'playwright'
import { capturePreviews, mockSupabase, openPreview, prSnippet, waitForVisible } from '../previews'
import { ensureServer } from '../helpers'

const SLUG = 'admin-mobile'
const FAKE_ID = '00000000-0000-4000-8000-0000000000ad'
const SUBMITTER_ID = '00000000-0000-4000-8000-0000000000aa'
const OTHER_SUBMITTER_ID = '00000000-0000-4000-8000-0000000000ab'
const SUPABASE_BASE = (process.env.VITE_SUPABASE_URL as string).replace(/\/$/, '')

const adminProfile = {
  id: FAKE_ID,
  username: 'preview_admin',
  display_name: 'Preview Admin',
  avatar_url: null,
  is_admin: true,
  public_list: false,
  og_image_url: null,
}

const catalogTables = {
  profiles: adminProfile,
  v_coaster_rankings: [],
  parks: [
    {
      id: '00000000-0000-4000-8000-0000000000cp',
      name: 'Cedar Point',
      slug: 'cedar-point',
      country: 'USA',
      region: null,
      city: 'Sandusky',
    },
  ],
  manufacturers: [],
}

const catalogRpcs = {
  public_board_meta: [{ last_recomputed_at: null, real_user_count: null, ranked_user_count: null }],
}

const submissionsFixture = [
  {
    id: '00000000-0000-4000-8000-0000000000s1',
    kind: 'new',
    coaster_id: null,
    coaster_name: 'Steel Vengeance',
    park_name: 'Cedar Point',
    park_id: '00000000-0000-4000-8000-0000000000cp',
    suggested_fields: {
      height_m: 62,
      speed_kmh: 120,
      length_m: 1700,
      inversions: 4,
      material: 'steel',
    },
    note: 'Source for the length figure: https://www.rollercoasterdatabase.com/very/long/path/segments/that/keep/going/and-going/steel-vengeance-track-length-survey-results?utm_source=admin-queue-demo-preview — please cross-check against the park site before approving.',
    submitted_by: SUBMITTER_ID,
    status: 'pending',
    reviewer_note: null,
    reviewed_by: null,
    created_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    reviewed_at: null,
    seen_by_submitter_at: null,
    profiles: { id: SUBMITTER_ID, avatar_url: null, username: 'coaster_fan_1999' },
  },
  {
    id: '00000000-0000-4000-8000-0000000000s2',
    kind: 'new',
    coaster_id: null,
    coaster_name: 'Maverick',
    park_name: 'Cedar Point',
    park_id: '00000000-0000-4000-8000-0000000000cp',
    suggested_fields: {
      height_m: 32,
      speed_kmh: 113,
      length_m: 1360,
      inversions: 2,
      material: 'steel',
    },
    note: 'Rode it last weekend — launch tunnel is running great.',
    submitted_by: OTHER_SUBMITTER_ID,
    status: 'pending',
    reviewer_note: null,
    reviewed_by: null,
    created_at: new Date(Date.now() - 5 * 3_600_000).toISOString(),
    reviewed_at: null,
    seen_by_submitter_at: null,
    profiles: { id: OTHER_SUBMITTER_ID, avatar_url: null, username: 'magnum_xl' },
  },
]

const usersPayload = {
  users: [
    {
      id: FAKE_ID,
      email: 'admin@coasterrank.dev',
      username: 'preview_admin',
      displayName: 'Preview Admin',
      avatarUrl: null,
      isAdmin: true,
      publicList: false,
      confirmed: true,
      invitedAt: null,
      synthetic: false,
      createdAt: '2026-06-01T12:00:00.000Z',
      ridesTotal: 40,
      ridesRanked: 38,
      submissionsMade: 3,
      submissionsReviewed: 12,
    },
    {
      id: '00000000-0000-4000-8000-0000000000u2',
      email: 'alexandra.montgomery-wellington.the.third@verylongdomainname.example.com',
      username: 'alexandra_coasters',
      displayName: 'Alexandra Montgomery-Wellington III',
      avatarUrl: null,
      isAdmin: false,
      publicList: true,
      confirmed: false,
      invitedAt: '2026-09-01T09:30:00.000Z',
      synthetic: false,
      createdAt: '2026-08-28T14:00:00.000Z',
      ridesTotal: 12,
      ridesRanked: 5,
      submissionsMade: 2,
      submissionsReviewed: 0,
    },
    {
      id: '00000000-0000-4000-8000-0000000000u3',
      email: 'testrider07@test.coasterrank.dev',
      username: null,
      displayName: null,
      avatarUrl: null,
      isAdmin: false,
      publicList: false,
      confirmed: true,
      invitedAt: null,
      synthetic: true,
      createdAt: '2026-09-05T18:00:00.000Z',
      ridesTotal: 25,
      ridesRanked: 25,
      submissionsMade: 0,
      submissionsReviewed: 0,
    },
  ],
  stats: {
    totalUsers: 3,
    confirmedUsers: 2,
    testUsers: 1,
    adminUsers: 1,
    rankedUsers: 2,
    signups7d: 1,
    signups30d: 3,
  },
  truncated: false,
}

function last30Days(): { day: string; count: number }[] {
  const days: { day: string; count: number }[] = []
  for (let i = 29; i >= 0; i -= 1) {
    const d = new Date(Date.now() - i * 86_400_000)
    days.push({ day: d.toISOString().slice(0, 10), count: (i * 7) % 5 })
  }
  return days
}

const sharingPayload = {
  generatedAt: new Date().toISOString(),
  window: {
    start: new Date(Date.now() - 30 * 86_400_000).toISOString(),
    end: new Date().toISOString(),
  },
  funnel: {
    totals: {
      total_users: 120,
      with_username: 80,
      eligible: 45,
      nudged: 20,
      sharing_on: 12,
    },
    sharers: [
      { username: 'coaster_fan_1999', ranked_count: 38, nudged: true },
      { username: 'magnum_xl', ranked_count: 21, nudged: false },
      { username: 'preview_admin', ranked_count: 38, nudged: true },
    ],
    signups_daily: last30Days(),
  },
  rum: {
    available: true,
    daily: last30Days().map((d) => ({ day: d.day, pageviews: d.count * 3, visits: d.count * 2 })),
    topPaths: [
      { path: '/riders/coaster_fan_1999', pageviews: 42, visits: 30 },
      { path: '/riders/magnum_xl', pageviews: 17, visits: 12 },
    ],
    topReferrers: [
      { host: '', pageviews: 50, visits: 40 },
      { host: 'reddit.com', pageviews: 9, visits: 7 },
    ],
  },
}

/**
 * The closed account sheet (translate-y-full below the viewport) leaks into
 * fullPage stitches. Hidden accounts-menu chrome, not page content — remove
 * it for the shots.
 */
async function hideClosedSheet(page: import('playwright').Page): Promise<void> {
  await page.addStyleTag({ content: '[data-testid="account-sheet"] { display: none !important; }' })
}

async function main(): Promise<void> {
  await ensureServer()
  const browser = await chromium.launch()
  const files: string[] = []
  try {
    // 1. Submissions queue (sticky dropdown + long-URL note wrapping).
    files.push(
      ...(await capturePreviews(
        browser,
        SLUG,
        'admin-submissions',
        async (kind) => {
          const page = await openPreview(browser, kind, {
            session: { id: FAKE_ID, email: 'admin@coasterrank.dev', username: 'preview_admin' },
          })
          const handle = await mockSupabase(page, {
            tables: { ...catalogTables, coaster_submissions: submissionsFixture },
            rpcs: catalogRpcs,
          })
          await page.goto('http://localhost:5199/admin/submissions')
          await waitForVisible(page, 'text=Submission Queue')
          await waitForVisible(page, 'text=Submitter note:')
          await hideClosedSheet(page)
          void handle
          return page
        },
        { fullPage: true },
      )),
    )

    // 2. Users list (full-width rows, unwrapped user data).
    files.push(
      ...(await capturePreviews(
        browser,
        SLUG,
        'admin-users',
        async (kind) => {
          const page = await openPreview(browser, kind, {
            session: { id: FAKE_ID, email: 'admin@coasterrank.dev', username: 'preview_admin' },
          })
          await mockSupabase(page, { tables: catalogTables, rpcs: catalogRpcs })
          await page.route(`${SUPABASE_BASE}/functions/v1/admin-users*`, (route) =>
            route.fulfill({ json: usersPayload }),
          )
          await page.goto('http://localhost:5199/admin/users')
          await waitForVisible(page, 'text=Synthetic test users')
          await waitForVisible(page, 'text=Alexandra Montgomery')
          await waitForVisible(page, 'text=verylongdomainname')
          await hideClosedSheet(page)
          return page
        },
        { fullPage: true },
      )),
    )

    // 3. Sharing funnel (compact cards).
    files.push(
      ...(await capturePreviews(
        browser,
        SLUG,
        'admin-sharing',
        async (kind) => {
          const page = await openPreview(browser, kind, {
            session: { id: FAKE_ID, email: 'admin@coasterrank.dev', username: 'preview_admin' },
          })
          await mockSupabase(page, { tables: catalogTables, rpcs: catalogRpcs })
          await page.route(`${SUPABASE_BASE}/functions/v1/admin-sharing-metrics*`, (route) =>
            route.fulfill({ json: sharingPayload }),
          )
          await page.goto('http://localhost:5199/admin/sharing')
          await waitForVisible(page, 'text=Current sharers')
          await hideClosedSheet(page)
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
