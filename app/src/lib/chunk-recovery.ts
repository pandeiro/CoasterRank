// Stale-chunk recovery for deploys.
//
// Every deploy atomically swaps the hashed asset set on Cloudflare Workers,
// so a tab opened before a deploy lazily imports chunk URLs that no longer
// exist. The SPA fallback (not_found_handling = "single-page-application")
// answers those requests with index.html (200, text/html), which Chrome et
// al. reject as a dynamic-import failure. Reload fixes it — the fresh HTML
// references the new hashes — so the recovery here is: detect the failure,
// reload once (guarded against loops via sessionStorage), and keep the
// failure out of Sentry (known, self-healing; see sentry.ts beforeSend).
//
// Message shapes observed in the wild:
//  - Chrome:  "Failed to fetch dynamically imported module: <url>"
//  - Firefox: "error loading dynamically imported module <url>"
//  - Safari:  "Importing a module script failed."
//  - Vite preload helper (css/asset preloads): "Unable to preload CSS for <url>"
//  - Legacy bundler loaders: "Loading chunk 4 failed." / "Loading css chunk …"
const CHUNK_LOAD_ERROR_RE =
  /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|unable to preload|loading (?:css )?chunk .{0,40}failed/i

export function isChunkLoadError(error: unknown): boolean {
  if (!error) return false

  // Check top-level message
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : error && typeof error === 'object' && 'message' in error
          ? String((error as { message: unknown }).message)
          : ''

  if (CHUNK_LOAD_ERROR_RE.test(message)) return true

  // Recursively check the cause chain (e.g. Sentry wrapped errors,
  // or modern JS 'cause' property).
  if (error instanceof Error && error.cause !== undefined) {
    return isChunkLoadError(error.cause)
  }

  return false
}

// sessionStorage key proving a chunk-error reload was already attempted this
// boot. Lives only until the next healthy mount (main.tsx clears it), so each
// deploy-window failure gets its own one-shot recovery without loop risk.
const GUARD_KEY = 'cr:chunk-reload'

export function hasChunkReloadGuard(): boolean {
  try {
    return sessionStorage.getItem(GUARD_KEY) !== null
  } catch {
    return false
  }
}

export function clearChunkReloadGuard(): void {
  try {
    sessionStorage.removeItem(GUARD_KEY)
  } catch {
    // Storage unavailable (e.g. some private modes) — nothing to clear.
  }
}

/**
 * Attempts the one-shot recovery for a suspected stale-chunk failure.
 * Returns true if a reload was triggered. Deliberately refuses to reload
 * when storage is unavailable: without the guard the reload could loop.
 */
export function reloadForChunkError(error: unknown): boolean {
  if (!isChunkLoadError(error)) return false
  try {
    if (sessionStorage.getItem(GUARD_KEY)) return false
    sessionStorage.setItem(GUARD_KEY, new Date().toISOString())
    window.location.reload()
  } catch {
    return false
  }
  return true
}
