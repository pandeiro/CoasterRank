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
    const url = new URL(request.url)

    // These prefixes are declared in wrangler.toml `run_worker_first` so they
    // always hit the Worker. For now just serve the static asset (SPA shell).
    // TODO: implement /api and /riders logic
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/riders/')) {
      // Fall through to assets — keeps behavior identical to not having a Worker
      // until real logic lands. Returns 404 if no matching asset (expected for now).
      return env.ASSETS.fetch(request)
    }

    return env.ASSETS.fetch(request)
  },
}
