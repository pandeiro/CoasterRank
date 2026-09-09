import { Navigate, useLocation } from 'react-router-dom'

// /@username vanity alias — must mirror RIDER_AT_PATH_RE in worker.ts and
// USERNAME_RE in lib/validation. Shared links are sometimes %-encoded
// (@ → %40) by chat apps; decode before matching, malformed escapes → 404.
const AT_PATH_RE = /^\/@([A-Za-z0-9_]{3,20})\/?$/

export default function NotFoundPage() {
  const location = useLocation()

  // Alias hit: <Navigate> resolves within the same router render pass —
  // no 404 flash, no network round trip. The address bar canonicalizes to
  // /riders/:username (query + hash preserved); /@username exists as the
  // short share form.
  let path = location.pathname
  try {
    path = decodeURIComponent(path)
  } catch {
    // Malformed escape → falls through to the 404 below.
  }
  const alias = AT_PATH_RE.exec(path.replace(/\/+$/, ''))
  if (alias) {
    return (
      <Navigate
        to={{
          pathname: `/riders/${alias[1].toLowerCase()}`,
          search: location.search,
          hash: location.hash,
        }}
        replace
      />
    )
  }

  return (
    <div className="py-24 text-center">
      <p className="text-sm font-semibold uppercase tracking-[0.16em] text-accent-text">404</p>
      <h1 className="display-heading mt-2 text-4xl text-ink">Page not found</h1>
      <p className="mt-2 text-muted">That page doesn&apos;t exist or has moved.</p>
    </div>
  )
}
