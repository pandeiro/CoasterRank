/**
 * Stub Cloudflare Worker — unified project with static assets.
 *
 * Current behavior: all routes serve static assets directly (free, no Worker
 * invocation) except paths in `run_worker_first` which are forced through
 * fetch(). This stub exists only to make `run_worker_first` valid — it
 * immediately hands off to the assets binding.
 *
 * Fast-follow: replace the two branches below with real logic:
 *  - `/riders/*` → bot-detection + OG HTML (check User-Agent, return prerendered head)
 *  - `/api/*` → Supabase cache / validation
 */

export interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Stub: both /api/* and /riders/* are forced through the Worker via
    // wrangler.toml `run_worker_first`. Intentionally identical branches
    // until fast-follow implements real logic (see TODOs above).
    // All paths currently proxy to static assets (SPA shell / 404).
    return env.ASSETS.fetch(request)
  },
}
