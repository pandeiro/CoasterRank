export type AnalyticsEventType = 'signup' | 'submission' | 'share'

/**
 * Fire-and-forget analytics signal. The Worker derives country from the edge
 * (CF-IPCountry / request.cf.country) and handles kill-switch + Telegram.
 * Failures are swallowed — analytics must never break the user flow.
 */
export function fireAnalyticsEvent(
  type: AnalyticsEventType,
  payload: Record<string, unknown>,
): void {
  try {
    void fetch('/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, ...payload }),
      keepalive: true,
    }).catch(() => {})
  } catch {
    // Synchronous throw (e.g. no window) — ignore.
  }
}
