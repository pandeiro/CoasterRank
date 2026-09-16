// Signup-page notice persistence (the "Why email confirmation?" blurb).
//
// The board's floating signup CTA card (engagement-timed nudge) was removed
// in the v2.2 follow-up — funnel affordances are now static: the header's
// Sign up link + Rank My Rides pill, and the /rank empty state's CTAs. Only
// this dismissible notice remains.

export const WHY_EMAIL_STORAGE_KEY = 'cr.signup-why-email.dismissed'

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
