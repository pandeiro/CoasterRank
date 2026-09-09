// Signup CTA tuning + persistence (board floating footer).
//
// How the gate counts (so the numbers below make sense):
//   - A 1-second ticker runs while the board is mounted. Each tick looks
//     back: "did the visitor scroll, tap, click, or type within the last
//     ACTIVITY_WINDOW_MS?" If yes, +1 ENGAGED second. Pauses don't reset the
//     count — they just don't add to it. So ENGAGED_SECONDS = 20 means ~20s
//     of actual fiddling (longer in wall-clock if the visitor idles).
//   - Separately, the visitor must have scrolled past MIN_SCROLL_PX once
//     (filters out rubber-band/bounce noise — everything else counts).
// Either both land, or nothing shows. A background tab can idle forever and
// never trip either half.
//
// RETURN fast path: once the visitor has scrolled past the minimum (armed
// for this tab only — sessionStorage, so it never leaks across visits),
// leaving for a coaster/park page and coming back shows the card after a
// short settle delay, no re-earning. A return trip is itself the strongest
// engagement signal we've got.
//
// Preview shortcuts (logged-out only):
//   /?cta=show   — show the card immediately (skips dwell, scroll AND the
//                  dismissed flag; nothing is written to storage)
//   /?cta=reset  — clear the dismissed flag, then gate normally
// Console reset: localStorage.removeItem('cr.signup-cta.dismissed')

// Engaged seconds required (cumulative, not consecutive).
export const SIGNUP_CTA_ENGAGED_SECONDS = 16

// Recency window (ms): a tick counts as engaged if any scroll / pointer /
// key / touch activity happened within this long before the tick.
export const SIGNUP_CTA_ACTIVITY_WINDOW_MS = 10_000

// Minimum scroll (px) that counts as "has scrolled". ~One nudge — anything
// beyond bounce noise.
export const SIGNUP_CTA_MIN_SCROLL_PX = 48

// Settle delay (ms) before the return-trip card appears — lets the board
// paint settle so the entrance animation reads instead of competing with
// the route transition.
export const SIGNUP_CTA_RETURN_DELAY_MS = 800

export const SIGNUP_CTA_ARMED_KEY = 'cr.signup-cta.armed'

export const SIGNUP_CTA_STORAGE_KEY = 'cr.signup-cta.dismissed'
export const WHY_EMAIL_STORAGE_KEY = 'cr.signup-why-email.dismissed'

/** Rotating copy — one pair picked per mount. Two separate lines so the
 *  break always falls BETWEEN the phrases (never mid-phrase on narrow
 *  screens). Edit copy here. */
export const SIGNUP_CTA_HEADLINES = [
  { question: 'Ridden any of these?', followUp: 'Rank them — shape the board.' },
  { question: 'Something here underrated?', followUp: 'Your list fixes that.' },
  { question: 'Have a top 10?', followUp: 'Cast your vote — shape the board.' },
] as const

/** Whether the visitor already dismissed the CTA (persists "never again"). */
export function readSignupCtaDismissed(): boolean {
  try {
    return window.localStorage.getItem(SIGNUP_CTA_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function persistSignupCtaDismissed(): void {
  try {
    window.localStorage.setItem(SIGNUP_CTA_STORAGE_KEY, '1')
  } catch {
    // Storage unavailable — the card just won't remember dismissal.
  }
}

/** Dev escape hatch: interpret the board's `cta` search param.
 *  `show` renders the card immediately (skips dwell, scroll AND the
 *  dismissed flag; nothing is written to storage), `reset` clears the
 *  dismissed flag and gates normally. Read from React Router's search params,
 *  not window.location, so memory-router tests can drive it. */
export function parseCtaPreviewMode(params: URLSearchParams): 'show' | 'reset' | null {
  const mode = params.get('cta')
  if (mode === 'show' || mode === 'reset') return mode
  return null
}

export function clearSignupCtaDismissed(): void {
  try {
    window.localStorage.removeItem(SIGNUP_CTA_STORAGE_KEY)
  } catch {
    // ignore
  }
}

/** Whether the visitor already dismissed the "why email?" nudge on signup. */
export function readWhyEmailDismissed(): boolean {
  try {
    return window.localStorage.getItem(WHY_EMAIL_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function persistWhyEmailDismissed(): void {
  try {
    window.localStorage.setItem(WHY_EMAIL_STORAGE_KEY, '1')
  } catch {
    // ignore
  }
}

/** Whether the visitor has scrolled past the minimum-scroll gate. */
export function hasScrolledPastMinimum(): boolean {
  return window.scrollY >= SIGNUP_CTA_MIN_SCROLL_PX
}

/**
 * Tab-scoped "this visitor was engaged" flag. Armed the first time the
 * visitor scrolls past the minimum on the board; read on each board mount
 * to fast-path the return trip. sessionStorage (not localStorage): it must
 * survive the detail-page round trip but never leak into the next visit.
 */
export function readSignupCtaArmed(): boolean {
  try {
    return window.sessionStorage.getItem(SIGNUP_CTA_ARMED_KEY) === '1'
  } catch {
    return false
  }
}

export function armSignupCta(): void {
  try {
    window.sessionStorage.setItem(SIGNUP_CTA_ARMED_KEY, '1')
  } catch {
    // Storage unavailable — the return fast path just won't fire.
  }
}

export function clearSignupCtaArmed(): void {
  try {
    window.sessionStorage.removeItem(SIGNUP_CTA_ARMED_KEY)
  } catch {
    // ignore
  }
}
