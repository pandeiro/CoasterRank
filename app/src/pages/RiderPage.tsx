import { Link, Navigate, useLocation, useParams } from 'react-router-dom'
import { Helmet } from 'react-helmet-async'
import { Heart, Map, MapPin, RollerCoaster } from 'lucide-react'
import Avatar from '../components/ui/Avatar'
import RiderRideList from '../components/RiderRideList'
import { MessageState, Panel } from '../components/ui'
import { useAuth } from '../lib/auth-context'
import { MANUFACTURER_ABBREVIATIONS } from '../lib/abbreviations'
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
  // Enthusiast-short builder name for the "X fan" line (B&M, RMC, GCI, CCI);
  // the full name stays on the title attribute, same contract as the board.
  const builderName = topBuilder?.name ?? null
  const builderAbbr = builderName ? (MANUFACTURER_ABBREVIATIONS[builderName] ?? builderName) : null
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

      {/* Hero — bare identity + four stat lines (no card chrome, no
          eyebrow): the name leads, Lucide glyphs in brand tokens lead each
          stat. Mobile condenses to a 2x2 grid so the top 10 still fits one
          screen; sm+ tucks the lines into the right-hand gap. */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-4 sm:gap-5">
          <Avatar
            src={profile.avatar_url}
            userId={profile.username}
            size={90}
            className="shrink-0"
          />
          <div className="min-w-0">
            <h1 className="display-heading truncate text-3xl text-ink sm:text-4xl">
              {displayName}
            </h1>
            <p className="mt-1 text-sm text-muted">
              @{profile.username}
              {memberSince !== null && <> · member since {memberSince}</>}
            </p>
          </div>
        </div>
        <div className="grid min-w-0 grid-cols-2 gap-x-3 gap-y-1 border-t border-line/70 pt-3 text-sm leading-snug sm:flex sm:w-60 sm:shrink-0 sm:flex-col sm:border-l sm:border-t-0 sm:pl-5 sm:pt-0">
          <p className="flex min-w-0 items-center gap-1.5" data-testid="rider-stats-rides">
            <RollerCoaster size={15} className="shrink-0 text-coral-text" aria-hidden="true" />
            <span className="truncate">
              <span className="font-semibold tabular-nums text-ink">{rides.length}</span>{' '}
              <span className="text-muted">{rides.length === 1 ? 'ride' : 'rides'}</span>
            </span>
          </p>
          <p className="flex min-w-0 items-center gap-1.5" data-testid="rider-stats-parks">
            <Map size={15} className="shrink-0 text-accent-text" aria-hidden="true" />
            <span className="truncate">
              <span className="font-semibold tabular-nums text-ink">{parkCount}</span>{' '}
              <span className="text-muted">{parkCount === 1 ? 'park' : 'parks'}</span>
            </span>
          </p>
          {topPark && (
            <p
              className="flex min-w-0 items-center gap-1.5"
              data-testid="rider-stats-top-park"
              title={`Top park: ${topPark.name} (${topPark.count} rides)`}
            >
              <MapPin size={15} className="shrink-0 text-accent-text" aria-hidden="true" />
              <span className="truncate">
                <span className="font-medium text-ink">{topPark.name}</span>{' '}
                <span className="text-xs tabular-nums text-muted">· {topPark.count}</span>
              </span>
            </p>
          )}
          {topBuilder && builderName && builderAbbr && (
            <p
              className="flex min-w-0 items-center gap-1.5"
              data-testid="rider-stats-top-builder"
              title={`${builderName} (${topBuilder.count} of top 10)`}
            >
              <Heart size={15} className="shrink-0 text-coral" aria-hidden="true" />
              <span className="truncate">
                <span className="font-medium text-ink">{builderAbbr} fan</span>{' '}
                <span className="text-xs tabular-nums text-muted">
                  · {topBuilder.count} {topBuilder.count === 1 ? 'coaster' : 'coasters'}
                </span>
              </span>
            </p>
          )}
        </div>
      </div>

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
          pitch it to visitors who can actually sign up. Accent-tinted card
          (same treatment as the coaster detail top card — plain div, not
          Panel, so the tint wins), two columns with the button standing
          alone on the right to save vertical space. */}
      {!user && (
        <div className="mt-8 rounded-xl border border-accent/30 bg-accent/10 p-5 shadow-panel sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <h2 className="display-heading text-2xl text-ink">Build your own ranking</h2>
              <p className="mt-1 max-w-md text-sm text-muted">
                Rank the coasters you&apos;ve ridden and get a shareable page just like this one. Or{' '}
                <Link to="/" className="font-medium text-ink underline-offset-4 hover:underline">
                  see the live board
                </Link>
                .
              </p>
            </div>
            <Link
              to="/signup"
              className="inline-flex shrink-0 items-center justify-center self-start rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-accent-strong sm:self-center"
            >
              Rank My Rides
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
