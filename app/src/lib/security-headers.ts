/**
 * Security headers for Worker responses (Lighthouse "Best Practices").
 *
 * Rollout posture: everything here is paternal-safe EXCEPT Content-Security-Policy,
 * which ships as `Content-Security-Policy-Report-Only` with NO `report-uri`
 * (no collector endpoint exists — violations surface in the dev console only).
 * Promote to enforced `Content-Security-Policy` only after a manual review of
 * console output across the main routes with zero violations; the policy below
 * already reflects the app's real needs (Vite external module scripts, React
 * inline `style=` props + worker `<style>` blocks, Google Fonts stylesheet +
 * font files, remote avatar/storage images incl. data-URI fallbacks, Supabase
 * HTTPS/WSS on unknown fork domains — hence the broad
 * `connect-src 'self' https: wss:`).
 *
 * Deliberately NOT set: `Cross-Origin-Embedder-Policy` (would break
 * cross-origin avatars/fonts that lack CORP) and enforced CSP (see above).
 * Source maps stay hidden/upload-then-delete by design — the Lighthouse
 * "missing source maps" audit is a documented wontfix, not a header problem.
 */

export const BASE_SECURITY_HEADERS: Record<string, string> = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'SAMEORIGIN',
  'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
}

export const CSP_REPORT_ONLY_VALUE =
  "default-src 'self'; " +
  "script-src 'self'; " +
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
  "font-src 'self' https://fonts.gstatic.com data:; " +
  "img-src 'self' data: https:; " +
  "connect-src 'self' https: wss:; " +
  "frame-ancestors 'self'; " +
  "object-src 'none'; " +
  "base-uri 'self'; " +
  "form-action 'self'"

export function securityHeaders(html: boolean): Record<string, string> {
  return html
    ? { ...BASE_SECURITY_HEADERS, 'Content-Security-Policy-Report-Only': CSP_REPORT_ONLY_VALUE }
    : { ...BASE_SECURITY_HEADERS }
}

/** Returns a clone of `response` with the security headers applied. */
export function withSecurityHeaders(response: Response, html: boolean): Response {
  const headers = new Headers(response.headers)
  const extra = securityHeaders(html)
  for (const [name, value] of Object.entries(extra)) {
    headers.set(name, value)
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
