/**
 * Shared browser-QA helpers for on-demand Playwright scenarios (run with
 * `npx tsx src/e2e/scenarios/<name>.ts`).
 *
 * This is the boilerplate layer of the e2e pattern — NOT a regression suite.
 * Scenarios are thin gesture-and-assert scripts a human or agent runs
 * deliberately when touching the relevant UI. Product behavior knowledge
 * (gotchas, false alarms) lives in the repo skill `.agents/skills/mobile-drag-qa`.
 *
 * Two rules that are easy to forget and expensive to relearn:
 *  1. Synthetic users are a possibility, not a presence — call
 *     `requireSyntheticUser()` first. If none exists it tells you to ASK the
 *     user before seeding (production DB write).
 *  2. Never restore product state with scripted gestures — dnd-kit
 *     auto-scroll makes multi-slot drags land unpredictably. Scenarios that
 *     reorder should drag back via the same helper (single-slot, measured
 *     pitch) or use the app's own API.
 */
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { SYNTHETIC_PASSWORD, syntheticEmail } from '../testride/markers'

export const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5199'
/** Canonical synthetic QA user (login-ready, no email verification needed). */
export const QA_USER = syntheticEmail('mock-0001')
export const QA_PASSWORD = SYNTHETIC_PASSWORD

const START_SERVER_COMMAND = 'cd app && npm run dev -- --port 5199 --strictPort'

/**
 * Confirms the synthetic QA user exists by attempting a Supabase password
 * sign-in. Read-only (no DB writes, no seeding). Throws with instructions if
 * the user is missing or env is unset.
 */
export async function requireSyntheticUser(): Promise<void> {
  const url = process.env.VITE_SUPABASE_URL
  const anon = process.env.VITE_SUPABASE_ANON_KEY
  if (!url || !anon) {
    throw new Error('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY missing — run from the repo .env (dotenv).')
  }
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: anon },
    body: JSON.stringify({ email: QA_USER, password: QA_PASSWORD }),
  })
  if (!res.ok) {
    throw new Error(
      `Synthetic user ${QA_USER} is missing or its password changed. ` +
        'Ask the user before creating test data: `cd scripts && npm run testride:seed -- --apply` ' +
        'is a PRODUCTION DB WRITE (see docs/TEST_DATA.md).',
    )
  }
}

/** Verifies the dev server is up; throws the exact start command if not. */
export async function ensureServer(): Promise<void> {
  try {
    const res = await fetch(BASE_URL)
    if (!res.ok) throw new Error(String(res.status))
  } catch {
    throw new Error(`No dev server at ${BASE_URL}. Start it first: ${START_SERVER_COMMAND}`)
  }
}

/**
 * matchMedia stub pinning pointer media features. Playwright's mobile
 * emulation reports pointer: fine/coarse nondeterministically across
 * contexts; anything the app gates on pointer type must be pinned. Methods
 * are delegated explicitly — a `Object.create(mql)` stub throws
 * `TypeError: Illegal invocation` when native methods are called.
 */
const PIN_POINTER_MEDIA = `
  const orig = window.matchMedia.bind(window)
  window.matchMedia = (q) => {
    const res = orig(q)
    let override = null
    if (q.includes('pointer: coarse')) override = true
    else if (q.includes('pointer: fine')) override = false
    if (override === null) return res
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

export interface Diagnostics {
  /** Errors collected so far (console error entries + uncaught page errors). */
  errors(): string[]
}

/** Attaches console/pageerror collection. Call before any navigation. */
export function captureDiagnostics(page: Page): Diagnostics {
  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(`pageerror: ${err}`))
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return
    const text = msg.text()
    // Benign: transient 401/429 resource loads from the auth-token race on
    // fresh sessions (the retry succeeds; the page recovers).
    if (/Failed to load resource/.test(text) && /\b(401|429)\b/.test(text)) return
    errors.push(`console: ${text}`)
  })
  return { errors: () => [...errors] }
}

/** Touch-capable mobile context with pointer media features pinned to coarse. */
export async function launchTouchContext(browser: Browser): Promise<BrowserContext> {
  const ctx = await browser.newContext({
    viewport: { width: 375, height: 812 },
    isMobile: true,
    hasTouch: true,
  })
  await ctx.addInitScript(PIN_POINTER_MEDIA)
  return ctx
}

export async function login(page: Page, email = QA_USER, password = QA_PASSWORD): Promise<void> {
  await page.goto(`${BASE_URL}/login`)
  await page.waitForLoadState('networkidle')
  await page.fill('#email', email)
  await page.fill('#password', password)
  await page.getByRole('button', { name: /log in/i }).click()
  // Wait for the auth redirect by URL — networkidle races it.
  await page.waitForURL(/\/(me)?$/, { timeout: 20_000 })
  if (!page.url().endsWith('/me')) {
    await page.goto(`${BASE_URL}/me`)
    await page.waitForURL(/\/me/, { timeout: 20_000 })
  }
  await page.waitForLoadState('networkidle')
  // login() targets /me; wait for the ranked list (or the confirm-email gate
  // for users with no rides) rather than a fixed delay — the rides query can
  // land well after networkidle.
  await page.waitForSelector('ul.space-y-2, [data-testid="confirm-gate"]', {
    timeout: 20_000,
  })
  await page.waitForTimeout(300)
}

/**
 * Long-press drag via CDP touch events (Playwright's touchscreen only taps).
 * Holds past dnd-kit's 200ms TouchSensor activation delay, then moves in
 * small steps. Returns the scroll position before the move so callers can
 * assert the scroll guard held.
 */
export async function longPressDrag(
  page: Page,
  from: { x: number; y: number },
  delta: { x: number; y: number },
  opts: { holdMs?: number; steps?: number; stepDelayMs?: number } = {},
): Promise<{ scrollYBefore: number; scrollYAfter: number }> {
  const { holdMs = 350, steps = 12, stepDelayMs = 40 } = opts
  const cdp = await page.context().newCDPSession(page)
  const scrollYBefore = await page.evaluate(() => window.scrollY)
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: from.x, y: from.y }],
  })
  await page.waitForTimeout(holdMs)
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: from.x + (delta.x * i) / steps, y: from.y + (delta.y * i) / steps }],
    })
    await page.waitForTimeout(stepDelayMs)
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  const scrollYAfter = await page.evaluate(() => window.scrollY)
  await cdp.detach()
  return { scrollYBefore, scrollYAfter }
}

/**
 * Names of the ranked rows, in order. Matches both the linked (desktop) and
 * plain-text (touch) name renderings.
 */
export async function rankedNames(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const ul = document.querySelector('ul.space-y-2')
    if (!ul) throw new Error('ranked list (ul.space-y-2) not found — are you on /me, logged in?')
    return [...ul.querySelectorAll('a.font-semibold, span.font-semibold')].map(
      (el) => el.textContent?.trim() ?? '',
    )
  })
}

/** Bounding-box center of the nth ranked row's drag handle. */
export async function dragHandleCenter(page: Page, index: number): Promise<{ x: number; y: number }> {
  const handle = page.getByRole('button', { name: 'Drag to reorder' }).nth(index)
  const box = await handle.boundingBox()
  if (!box) throw new Error(`drag handle ${index} has no bounding box`)
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

/** Measured pixel pitch between ranked rows (handles two-line mobile cards). */
export async function rowPitch(page: Page, index = 0): Promise<number> {
  return page.evaluate((i) => {
    const ul = document.querySelector('ul.space-y-2')
    if (!ul) throw new Error('ranked list not found')
    const rows = [...ul.querySelectorAll(':scope > li')]
    const a = rows[i]?.getBoundingClientRect()
    const b = rows[i + 1]?.getBoundingClientRect()
    if (!a || !b) throw new Error(`need rows ${i} and ${i + 1} to measure pitch`)
    return Math.abs(b.top - a.top)
  }, index)
}

/** Throws if the page has horizontal overflow (the negative-margin bug class). */
export async function assertNoHorizontalOverflow(page: Page): Promise<void> {
  const { sw, cw } = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    cw: document.documentElement.clientWidth,
  }))
  if (sw > cw) throw new Error(`horizontal overflow: scrollWidth ${sw} > clientWidth ${cw}`)
}

/** Desktop mouse drag of a ranked row from one index to another. */
export async function mouseDragRow(
  page: Page,
  fromIndex: number,
  toIndex: number,
): Promise<void> {
  const from = await dragHandleCenter(page, fromIndex)
  const to = await dragHandleCenter(page, toIndex)
  // Center-to-center: dnd-kit's collision detection uses the dragged rect
  // against other rows' rest-layout rects, so landing on the target handle's
  // center is deterministic (pitch arithmetic + overshoot is not).
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  const steps = 10
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps, {
      steps: 2,
    })
    await page.waitForTimeout(50)
  }
  await page.waitForTimeout(150)
  await page.mouse.up()
  await page.waitForTimeout(400)
}
