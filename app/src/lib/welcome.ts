export const WELCOME_DISMISS_KEY = 'cr.welcome.dismissed'

/** Whether the user has already dismissed the first-run welcome nudge. */
export function readWelcomeDismissed(): boolean {
  try {
    return window.localStorage.getItem(WELCOME_DISMISS_KEY) === '1'
  } catch {
    return false
  }
}

export function persistWelcomeDismissed(): void {
  try {
    window.localStorage.setItem(WELCOME_DISMISS_KEY, '1')
  } catch {
    // Storage unavailable — the ?welcome=1 param is still cleared, so the
    // modal won't loop within the session.
  }
}
