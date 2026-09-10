/**
 * Capture harness for UX PR previews (skill: .agents/skills/ux-pr-previews).
 *
 * Screenshot-oriented sibling of helpers.ts: desktop+mobile viewport pairs,
 * fake authenticated sessions, Supabase interception, and stable capture.
 * Per-feature scenarios (scripts/src/e2e/scenarios/previews-<slug>.ts) supply
 * the fixtures and the navigation; this module owns the boilerplate.
 *
 * Field-tested mechanics you must not re-derive:
 *  1. The app renders CSS-gated duplicate layouts (e.g. `hidden md:block`
 *     desktop twins), so a bare `page.waitForSelector(sel)` can wait forever
 *     on the DOM-first hidden copy. Always wait/clip through
 *     `waitForVisible()` / `visibleFirst()` (visible-filtered `.first`).
 *  2. A fake session sends `Authorization: Bearer <fake>` on every REST call
 *     and Supabase's gateway rejects the invalid JWT BEFORE RLS — even reads
 *     that are anon-open 401. Pass-through calls therefore get the
 *     Authorization header swapped back to the anon key. Tables the fake user
 *     "owns" (profiles, user_rides, …) 401 even as anon (no anon policy) and
 *     MUST be mocked; RPCs have no anon EXECUTE by default — also mock them.
 *     The public catalog (coasters, parks, …) passes through fine as anon.
 *  3. PostgREST fixtures: list queries take arrays; `.single()`/`.maybeSingle()`
 *     queries take a single OBJECT (the client unwraps `vnd.pgrst.object`).
 *  4. Route precedence: Playwright consults routes NEWEST-first and the first
 *     handler that fulfills wins, so mockSupabase() registers its catch-alls
 *     FIRST and fixtures AFTER; scenario handlers registered after this call
 *     override everything it set up.
 *  5. Pass-through is always anon, so accidental writes fail RLS — but don't
 *     rely on that: capture flows must be read-only by construction.
 *     `mockSupabase()`'s return value logs which tables were read from prod.
 */
import { execSync } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
  type Route,
} from 'playwright'
import { BASE_URL, captureDiagnostics } from './helpers'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

/** Standard PR-preview viewport pair (skill convention; 1x scale keeps PNGs small). */
export const PREVIEW_VIEWPORTS = {
  desktop: { width: 1280, height: 800 },
  mobile: { width: 390, height: 844 },
} as const

export type PreviewKind = keyof typeof PREVIEW_VIEWPORTS
const PREVIEW_KINDS = ['desktop', 'mobile'] as const

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} missing — load the repo .env (dotenv) before importing.`)
  return value
}

function requireSupabaseBase(): string {
  return requireEnv('VITE_SUPABASE_URL').replace(/\/$/, '')
}

// ---------------------------------------------------------------------------
// Fake session
// ---------------------------------------------------------------------------

export interface PreviewSession {
  /** Fake auth.users id (any UUID; must match ids in your profile fixtures). */
  id: string
  email: string
  username?: string
  /** Default true — omit to preview the unconfirmed gate. */
  confirmed?: boolean
}

/** Base64url-encode a UTF-8 string. */
function b64url(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url')
}

/** Unsigned-ish JWT: clients never verify the signature; shape is what matters. */
function fakeJwt(payload: Record<string, unknown>): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  return `${header}.${b64url(JSON.stringify(payload))}.preview-signature`
}

/** supabase-js default localStorage key: `sb-<project-ref>-auth-token`. */
function authStorageKey(): string {
  const ref = new URL(requireSupabaseBase()).hostname.split('.')[0]
  return `sb-${ref}-auth-token`
}

/**
 * A far-future v2 session payload. getSession() reads storage synchronously
 * and skips the refresh network call while `expires_at` is in the future —
 * no auth round-trip ever happens (auth/v1 is route-aborted anyway).
 */
function sessionPayload(spec: PreviewSession): Record<string, unknown> {
  const nowSeconds = Math.floor(Date.now() / 1000)
  const yearFromNow = nowSeconds + 365 * 24 * 60 * 60
  const iso = new Date().toISOString()
  return {
    access_token: fakeJwt({
      sub: spec.id,
      email: spec.email,
      role: 'authenticated',
      iat: nowSeconds,
      exp: yearFromNow,
    }),
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: yearFromNow,
    refresh_token: 'preview-refresh-token',
    user: {
      id: spec.id,
      aud: 'authenticated',
      role: 'authenticated',
      email: spec.email,
      email_confirmed_at: spec.confirmed === false ? null : iso,
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: { synthetic: true, ...(spec.username ? { username: spec.username } : {}) },
      created_at: iso,
      updated_at: iso,
    },
  }
}

// ---------------------------------------------------------------------------
// Supabase interception
// ---------------------------------------------------------------------------

export interface SupabaseMocks {
  /**
   * Rest-table fixtures. Value = the PostgREST response body: an array for
   * list queries, a single object for `.single()`/embedded-one queries.
   */
  tables?: Record<string, unknown>
  /** RPC fixtures (`/rest/v1/rpc/<fn>`); value = response body (any JSON). */
  rpcs?: Record<string, unknown>
}

export interface SupabaseMockHandle {
  /** What this page actually read from prod (anon pass-through), for the log. */
  prodReads(): { table: string; count: number }[]
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Exact resource match: table/rpc name at path end, then query string or EOL. */
function restPattern(table: string): RegExp {
  return new RegExp(`^${escapeRegExp(requireSupabaseBase())}/rest/v1/${table}(\\?|$)`)
}

/**
 * Routes Supabase traffic for `page`:
 *  - fixtures fulfill locally (zero prod contact),
 *  - everything else under /rest/v1 and /storage/v1 passes through to prod
 *    with the Authorization header swapped to the anon key (see module note 2),
 *  - /auth/v1 and /functions/v1 are aborted (a fake session has no business
 *    calling them; register a scenario handler after this call if you need one).
 *
 * Register scenario-specific routes AFTER calling this — routes are matched
 * newest-first, so the most recent handler wins.
 */
export async function mockSupabase(
  page: Page,
  mocks: SupabaseMocks = {},
): Promise<SupabaseMockHandle> {
  const anon = requireEnv('VITE_SUPABASE_ANON_KEY')
  const base = requireSupabaseBase()
  const prodReadCounts = new Map<string, number>()

  /** Swap the fake Bearer back to anon so anon-RLS reads succeed (note 2). */
  const passthroughAnon = async (route: Route, table: string): Promise<void> => {
    prodReadCounts.set(table, (prodReadCounts.get(table) ?? 0) + 1)
    const headers = await route.request().allHeaders()
    const response = await route.fetch({
      headers: { ...headers, apikey: anon, authorization: `Bearer ${anon}` },
    })
    await route.fulfill({ response })
  }

  // Order matters (note 4): catch-alls first, fixtures after — newest wins.
  await page.route(`${base}/rest/v1/**`, async (route) => {
    const url = route.request().url()
    const rpcName = url.match(/\/rest\/v1\/rpc\/([^/?]+)/)?.[1]
    const table = rpcName
      ? `rpc/${rpcName}`
      : (url.match(/\/rest\/v1\/([^/?]+)/)?.[1] ?? '(unknown)')
    await passthroughAnon(route, table)
  })
  await page.route(`${base}/storage/v1/**`, async (route) => {
    await passthroughAnon(route, '(storage)')
  })
  await page.route(`${base}/auth/v1/**`, (route) => route.abort('aborted'))
  await page.route(`${base}/functions/v1/**`, (route) => route.abort('aborted'))

  const fulfillFixture = async (route: Route, body: unknown): Promise<void> => {
    await route.fulfill({ json: body })
  }
  for (const [table, body] of Object.entries(mocks.tables ?? {})) {
    await page.route(restPattern(table), (route) => fulfillFixture(route, body))
  }
  for (const [fn, body] of Object.entries(mocks.rpcs ?? {})) {
    await page.route(restPattern(`rpc/${fn}`), (route) => fulfillFixture(route, body))
  }

  return {
    prodReads: () => [...prodReadCounts.entries()].map(([table, count]) => ({ table, count })),
  }
}

// ---------------------------------------------------------------------------
// Context / page factory
// ---------------------------------------------------------------------------

/**
 * matchMedia stub pinning ONE pointer media feature. Playwright's mobile
 * emulation reports pointer fine/coarse nondeterministically across contexts;
 * pinning coarse for mobile contexts and fine for desktop contexts keeps every
 * `(pointer: …)` gate deterministic. Methods are delegated explicitly — an
 * `Object.create(mql)` stub throws `TypeError: Illegal invocation`.
 */
function pointerPinScript(pinned: 'coarse' | 'fine'): string {
  return `
    const orig = window.matchMedia.bind(window)
    window.matchMedia = (q) => {
      const res = orig(q)
      if (!/pointer:\\s*(?:${pinned}|${pinned === 'coarse' ? 'fine' : 'coarse'})/.test(q)) return res
      const override = q.includes('pointer: ${pinned}')
      return {
        matches: override, media: res.media, onchange: null,
        addEventListener: (...a) => res.addEventListener(...a),
        removeEventListener: (...a) => res.removeEventListener(...a),
        addListener: (cb) => res.addListener && res.addListener(cb),
        removeListener: (cb) => res.removeListener && res.removeListener(cb),
        dispatchEvent: (ev) => res.dispatchEvent(ev),
      }
    }
  `
}

export interface OpenPreviewOptions {
  session?: PreviewSession
}

/** Fresh preview context: pinned pointer media + optional fake auth session. */
export async function newPreviewContext(
  browser: Browser,
  kind: PreviewKind,
  opts: OpenPreviewOptions = {},
): Promise<BrowserContext> {
  const ctx = await browser.newContext({
    viewport: { ...PREVIEW_VIEWPORTS[kind] },
    deviceScaleFactor: 1,
    ...(kind === 'mobile' ? { isMobile: true, hasTouch: true } : {}),
  })
  await ctx.addInitScript(pointerPinScript(kind === 'mobile' ? 'coarse' : 'fine'))
  if (opts.session) {
    const key = authStorageKey()
    const session = sessionPayload(opts.session)
    await ctx.addInitScript(
      (payload: { key: string; session: unknown }) => {
        window.localStorage.setItem(payload.key, JSON.stringify(payload.session))
      },
      { key, session },
    )
  }
  return ctx
}

/** Convenience: newPreviewContext + a page. Register mockSupabase() routes
 * BEFORE your first page.goto — navigation must not race route registration. */
export async function openPreview(
  browser: Browser,
  kind: PreviewKind,
  opts: OpenPreviewOptions = {},
): Promise<Page> {
  const ctx = await newPreviewContext(browser, kind, opts)
  return ctx.newPage()
}

// ---------------------------------------------------------------------------
// Waits & capture
// ---------------------------------------------------------------------------

/** Visible-filtered `.first` locator — see module note 1 (duplicate layouts). */
export function visibleFirst(page: Page, selector: string): Locator {
  return page.locator(selector).filter({ visible: true }).first()
}

/** Waits for a VISIBLE match (bare waitForSelector stalls on hidden DOM twins). */
export async function waitForVisible(
  page: Page,
  selector: string,
  timeoutMs = 15_000,
): Promise<void> {
  await visibleFirst(page, selector).waitFor({ state: 'visible', timeout: timeoutMs })
}

export interface ShootOptions {
  /** Full-page capture (default true). Ignored when `clip` is set. */
  fullPage?: boolean
  /** CSS selector to clip to (its first visible match's box + `clipPad`). */
  clip?: string
  /** Padding around the clip box, px (default 12). */
  clipPad?: number
  /** Freeze animations/transitions/caret before the shot (default true). */
  freezeAnimations?: boolean
  /** Extra settle time after fonts+scroll, ms (default 250). */
  settleMs?: number
}

/** Fonts loaded, scrolled to top, animations frozen, small settle delay. */
export async function settle(page: Page, opts: ShootOptions = {}): Promise<void> {
  if (opts.freezeAnimations !== false) {
    await page.addStyleTag({
      content:
        '*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }',
    })
  }
  await page.evaluate(() => document.fonts.ready)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(opts.settleMs ?? 250)
}

/** Absolute output path for a preview PNG. */
export function previewFile(slug: string, name: string, kind: PreviewKind): string {
  return join(REPO_ROOT, 'docs', 'previews', slug, `${name}-${kind}.png`)
}

/**
 * Screenshots one shot per preview kind. `open(kind)` builds the page for that
 * kind (context + session + mocks + goto + waits) and returns it; pages are
 * closed afterwards. Writes `docs/previews/<slug>/<name>-{desktop,mobile}.png`.
 */
export async function capturePreviews(
  browser: Browser,
  slug: string,
  name: string,
  open: (kind: PreviewKind) => Promise<Page>,
  opts: ShootOptions = {},
): Promise<string[]> {
  const paths: string[] = []
  const diagnostics: string[] = []
  for (const kind of PREVIEW_KINDS) {
    const page = await open(kind)
    const diags = captureDiagnostics(page)
    try {
      const outPath = previewFile(slug, name, kind)
      await settle(page, opts)
      await mkdir(dirname(outPath), { recursive: true })
      if (opts.clip) {
        const box = await visibleFirst(page, opts.clip).boundingBox()
        if (!box) throw new Error(`clip target has no visible box: ${opts.clip}`)
        const pad = opts.clipPad ?? 12
        const x = Math.max(0, box.x - pad)
        const y = Math.max(0, box.y - pad)
        await page.screenshot({
          path: outPath,
          clip: { x, y, width: box.width + pad * 2, height: box.height + pad * 2 },
        })
      } else {
        await page.screenshot({ path: outPath, fullPage: opts.fullPage !== false })
      }
      paths.push(outPath)
      const errors = diags.errors()
      if (errors.length > 0) {
        // Expected noise under fake sessions: aborted /auth/v1 + /functions/v1
        // requests surface as "Failed to load resource" — note, don't fail.
        console.warn(`[${slug}/${name}-${kind}] console/page errors during capture:`)
        for (const error of errors) console.warn(`  - ${error}`)
        diagnostics.push(`${kind}: ${errors.length}`)
      }
    } finally {
      await page.context().close()
    }
  }
  for (const path of paths) console.log(`saved ${path}`)
  if (diagnostics.length === 0) console.log('capture clean: no console/page errors')
  return paths
}

// ---------------------------------------------------------------------------
// PR-body markdown
// ---------------------------------------------------------------------------

function gitOutput(command: string): string {
  return execSync(command, { encoding: 'utf8' }).trim()
}

/** Current branch name (raw URLs must name the PR head branch to render). */
export function currentBranch(): string {
  return gitOutput('git rev-parse --abbrev-ref HEAD')
}

/** `owner/repo` from the origin remote (handles ssh + https forms). */
function originSlug(): string {
  const url = gitOutput('git remote get-url origin')
  return url
    .replace(/^git@github\.com:/, '')
    .replace(/^https?:\/\/github\.com\//, '')
    .replace(/\.git$/, '')
}

export function previewUrl(slug: string, file: string, branch?: string): string {
  const name = file.split('/').pop() ?? file
  return `https://raw.githubusercontent.com/${originSlug()}/${branch ?? currentBranch()}/docs/previews/${slug}/${name}`
}

/**
 * Ready-to-paste PR-body markdown: one embed line per file, plus the in-repo
 * path comment. Reference these in the PR body so GitHub renders them (camo).
 * Note: branch-raw URLs rot after the branch is deleted post-merge — the files
 * stay in the repo at the same path, so that is cosmetic.
 */
export function prSnippet(slug: string, files: string[], branch?: string): string {
  const lines = files.map((file) => {
    const alt = (file.split('/').pop() ?? file).replace(/\.png$/, '').replace(/-/g, ' ')
    return `![${alt}](${previewUrl(slug, file, branch)})`
  })
  return ['', '<!-- previews: docs/previews/' + slug + ' -->', ...lines, ''].join('\n')
}
