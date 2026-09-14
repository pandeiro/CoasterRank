import { Link, Navigate, useLocation, useParams } from 'react-router-dom'
import { Helmet } from 'react-helmet-async'
import Avatar from '../components/ui/Avatar'
import RiderRideList from '../components/RiderRideList'
import { MessageState, Panel } from '../components/ui'
import { useAuth } from '../lib/auth-context'
import { manufacturerSpotlight, topSpotlight } from '../lib/og-svg'
import { riderPageUrl, useRiderPage, isValidRiderUsername } from '../lib/rider'
import { truncate } from '../lib/truncate'

function yearOf(iso: string | null): number | null {
  if (!iso) return null
  const year = Number(iso.slice(0, 4))
  return Number.isFinite(year) ? year : null
}

function RiderNotFound() {
  return (
    <div className="py-12">
      <Helmet>
        <title>Rider not found — CoasterRank</title>
        <meta name="robots" content="noindex" />
      </Helmet>
      <MessageState>This rider page doesn&apos;t exist or isn&apos;t shared.</MessageState>
    </div>
  )
}

export default function RiderPage() {
  const { username } = useParams()
  const location = useLocation()
  const { user } = useAuth()
  // Lowercase-tolerant: shared URLs get retyped with capitals and the DB
  // lookup is case-insensitive, but the client query gate is lowercase-only.
  const canonicalUsername = username?.toLowerCase()
  const { data, isPending, isError } = useRiderPage(canonicalUsername)

  // Invalid segments (too short, bad charset) must not-found, not spin: with
  // TanStack v5 a disabled query stays pending forever, so without this the
  // page shows Loading… indefinitely instead of not-found.
  if (!isValidRiderUsername(canonicalUsername)) {
    return <RiderNotFound />
  }

  // Case-canonicalize the address bar: usernames are lowercase-only by DB
  // contract (profiles_username_format_check), so the lowercase form IS the
  // canonical URL — no need to wait for the RPC. Same-render-pass replace,
  // search/hash preserved, consistent with the /@ alias redirect.
  if (username !== canonicalUsername) {
    return (
      <Navigate
        to={{
          pathname: `/riders/${canonicalUsername}`,
          search: location.search,
          hash: location.hash,
        }}
        replace
      />
    )
  }

  if (isPending) {
    return <MessageState>Loading…</MessageState>
  }

  if (isError) {
    return <MessageState tone="danger">Couldn&apos;t load that rider page.</MessageState>
  }

  if (!data) {
    return <RiderNotFound />
  }

  const { profile, rides } = data
  const displayName = profile.display_name || profile.username
  const pageUrl = riderPageUrl(profile.username)
  const title = `${displayName} (${`@${profile.username}`}) — CoasterRank`
  // Dynamic edge-rendered card (top 5 + summary, ≤5 min stale) — see the
  // /riders/:username/og.png route in worker.ts.
  const ogImage = `${window.location.origin}/riders/${profile.username}/og.png`
  // Spotlights mirror the OG card (og-image.ts): top park across all rides,
  // top builder from the top 10 by rank — preference, not volume. The builder
  // spotlight credits every lineage manufacturer, not just the primary. No
  // "#1 pick" stat; the ranked table right below already shows it.
  const topPark = topSpotlight(rides, 'park_name')
  const topBuilder = manufacturerSpotlight(rides, 10)
  const topNames = rides.slice(0, 3).map((r) => truncate(r.name, 40))
  const parkCount = new Set(rides.map((r) => r.park_name).filter(Boolean)).size
  const memberSince = yearOf(profile.member_since)
  const metaDescription =
    rides.length > 0
      ? `${rides.length} coaster${rides.length === 1 ? '' : 's'} ranked · Top: ${topNames.join(' · ')} · See ${displayName}'s full coaster ranking on CoasterRank.`
      : `See ${displayName}'s coaster ranking on CoasterRank.`

  return (
    <div className="mx-auto max-w-3xl">
      <Helmet>
        <title>{title}</title>
        <meta name="description" content={metaDescription} />
        {/* Rider pages are share targets for social unfurls, not search
            results — crawlers still read the OG tags below. */}
        <meta name="robots" content="noindex" />
        <link rel="canonical" href={pageUrl} />
        <meta property="og:type" content="profile" />
        <meta property="og:site_name" content="CoasterRank" />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={metaDescription} />
        <meta property="og:url" content={pageUrl} />
        <meta property="og:image" content={ogImage} />
        <meta property="profile:username" content={profile.username} />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={title} />
        <meta name="twitter:description" content={metaDescription} />
        <meta name="twitter:image" content={ogImage} />
      </Helmet>

      {/* Hero — identity on the left, the three summary stats tucked into
          the header's right-hand gap (one line each: volume, top park,
          builder preference) so a top-10 screenshot stays tight with no
          separate stats row. Stacks below the identity on mobile. */}
      <Panel className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:p-6">
        <div className="flex min-w-0 flex-1 items-center gap-4 sm:gap-5">
          <Avatar
            src={profile.avatar_url}
            userId={profile.username}
            size={72}
            className="shrink-0"
          />
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent-text">
              Rider ranking
            </p>
            <h1 className="display-heading mt-1 truncate text-3xl text-ink sm:text-4xl">
              {displayName}
            </h1>
            <p className="mt-1 text-sm text-muted">
              @{profile.username}
              {memberSince !== null && <> · member since {memberSince}</>}
            </p>
          </div>
        </div>
        <div className="min-w-0 space-y-0.5 border-t border-line/70 pt-3 text-sm leading-snug sm:w-60 sm:shrink-0 sm:border-l sm:border-t-0 sm:pl-5 sm:pt-0">
          <p className="truncate" data-testid="rider-stats-volume">
            <span className="font-semibold tabular-nums text-coral-text">{rides.length}</span>{' '}
            <span className="text-muted">{rides.length === 1 ? 'ride' : 'rides'} at </span>
            <span className="font-semibold tabular-nums text-accent-text">{parkCount}</span>{' '}
            <span className="text-muted">{parkCount === 1 ? 'park' : 'parks'}</span>
          </p>
          {topPark && (
            <p
              className="truncate"
              data-testid="rider-stats-top-park"
              title={`Top park: ${topPark.name} (${topPark.count} ridden)`}
            >
              <span className="text-muted">Top park · </span>
              <span className="font-medium text-ink">{topPark.name}</span>{' '}
              <span className="text-xs tabular-nums text-muted">· {topPark.count}</span>
            </p>
          )}
          {topBuilder && (
            <p
              className="truncate"
              data-testid="rider-stats-top-builder"
              title={`Likes ${topBuilder.name} (${topBuilder.count} in top 10)`}
            >
              <span aria-hidden="true" className="font-semibold text-coral">
                ♥{' '}
              </span>
              <span className="text-muted">Likes </span>
              <span className="font-medium text-ink">{topBuilder.name}</span>{' '}
              <span className="text-xs tabular-nums text-muted">· {topBuilder.count}</span>
            </p>
          )}
        </div>
      </Panel>

      {/* The list sits right under the hero now that the stats live inside
          it — mt-4 keeps the top 10 tight for screenshots. */}
      <div className="mt-4">
        {rides.length === 0 ? (
          <MessageState>No coasters ranked yet.</MessageState>
        ) : (
          <Panel className="overflow-hidden">
            <RiderRideList rides={rides} />
          </Panel>
        )}
      </div>

      {/* Growth loop: every shared visit is a signup opportunity — but only
          pitch it to visitors who can actually sign up. */}
      {!user && (
        <Panel className="mt-8 flex flex-col items-center gap-3 p-6 text-center">
          <h2 className="display-heading text-2xl text-ink">Build your own ranking</h2>
          <p className="max-w-md text-sm text-muted">
            Rank the coasters you&apos;ve ridden and get a shareable page just like this one.
          </p>
          <Link
            to="/signup"
            className="mt-1 rounded-full bg-coral-text px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-coral-text/90"
          >
            Sign up free
          </Link>
          <Link to="/" className="text-sm font-medium text-ink underline-offset-4 hover:underline">
            See the live board
          </Link>
        </Panel>
      )}
    </div>
  )
}
