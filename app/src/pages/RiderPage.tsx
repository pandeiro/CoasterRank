import { Link, useParams } from 'react-router-dom'
import { Helmet } from 'react-helmet-async'
import Avatar from '../components/ui/Avatar'
import RiderRideList from '../components/RiderRideList'
import StatBlock from '../components/StatBlock'
import { MessageState, Panel } from '../components/ui'
import { useAuth } from '../lib/auth-context'
import { riderPageUrl, useRiderPage } from '../lib/rider'
import { truncate } from '../lib/truncate'

function yearOf(iso: string | null): number | null {
  if (!iso) return null
  const year = Number(iso.slice(0, 4))
  return Number.isFinite(year) ? year : null
}

export default function RiderPage() {
  const { username } = useParams()
  const { user } = useAuth()
  const { data, isPending, isError } = useRiderPage(username)

  if (isPending) {
    return <MessageState>Loading…</MessageState>
  }

  if (isError) {
    return <MessageState tone="danger">Couldn&apos;t load that rider page.</MessageState>
  }

  if (!data) {
    return (
      <div className="py-12">
        <Helmet>
          <title>Rider not found — CoasterRank</title>
          <meta name="robots" content="noindex" />
        </Helmet>
        <MessageState>
          This rider page doesn&apos;t exist or isn&apos;t shared.{' '}
          <Link to="/" className="font-medium text-ink underline underline-offset-4">
            Back to the board
          </Link>
        </MessageState>
      </div>
    )
  }

  const { profile, rides } = data
  const displayName = profile.display_name || profile.username
  const pageUrl = riderPageUrl(profile.username)
  const title = `${displayName} (${`@${profile.username}`}) — CoasterRank`
  // Dynamic edge-rendered card (top 5 + summary, ≤5 min stale) — see the
  // /riders/:username/og.png route in worker.ts.
  const ogImage = `${window.location.origin}/riders/${profile.username}/og.png`
  const topPick = rides[0]
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

      {/* Hero */}
      <Panel className="flex items-center gap-4 p-5 sm:gap-5 sm:p-6">
        <Avatar src={profile.avatar_url} userId={profile.username} size={72} />
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
      </Panel>

      {/* Micro-stats */}
      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatBlock label="Ranked" value={rides.length} />
        <StatBlock label="Parks" value={parkCount} />
        <StatBlock label="#1 pick" value={topPick ? topPick.name : '—'} />
      </dl>

      {/* The list */}
      <div className="mt-6">
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
