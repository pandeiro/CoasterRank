// Lighthouse CI — advisory regression tracking (see docs/PLAN.md §9.x).
//
// Posture: everything here is `warn`, never `error`. This job is NOT in
// branch protection and must never block a merge — lab scores on shared
// runners are too noisy for hard gates, and authed routes are deliberately
// excluded (seeding a confirmed session in CI is fragile; authed surfaces
// get axe/component coverage + occasional manual runs instead).
//
// What's measured: the two first-impression routes, anon, desktop —
// `/` (community board) and a real 90-ride rider share page (the newcomer
// funnel). `numberOfRuns: 3` medians out run-to-run variance.
//
// Ratchet rule: when an audit holds green for ~2 weeks, promote that one
// audit to `error` (and only then consider adding the job to required
// checks). Never leave a `warn` without an owner + review date.
const base = (process.env.LHCI_URL || 'https://coasterrank.app').replace(/\/+$/, '')
const rider = process.env.LHCI_RIDER || 'pandeiro'

module.exports = {
  ci: {
    collect: {
      url: [`${base}/`, `${base}/riders/${rider}`],
      numberOfRuns: 3,
      settings: {
        preset: 'desktop',
        throttlingMethod: 'simulate',
      },
    },
    assert: {
      preset: 'lighthouse:no-pwa',
      assertions: {
        // Category overviews — warnings, not contracts (scores reweight
        // between Lighthouse releases; the audits below are the signal).
        'categories:performance': ['warn', { minScore: 0.85 }],
        'categories:accessibility': ['warn', { minScore: 0.9 }],
        'categories:best-practices': ['warn', { minScore: 0.9 }],
        'categories:seo': ['warn', { minScore: 0.9 }],
        // Targeted audits from the Sep-2026 baseline run.
        'color-contrast': ['warn', {}],
        'image-aspect-ratio': ['warn', {}],
        'unused-javascript': 'warn',
        // Report-Only never satisfies this audit (it wants an enforced
        // policy) — stays warn until CSP itself is enforced, and must not be
        // promoted to error before that.
        'csp-xss': 'warn',
        'robots-txt': 'warn',
        'largest-contentful-paint': ['warn', { maxNumericValue: 2500 }],
        'cumulative-layout-shift': ['warn', { maxNumericValue: 0.15 }],
        'total-blocking-time': ['warn', { maxNumericValue: 300 }],
        // Documented wontfix — the build uploads hidden sourcemaps to
        // Sentry then deletes them, so this audit can never pass.
        'missing-source-maps': 'off',
      },
    },
    upload: {
      target: 'temporary-public-storage',
    },
  },
}
