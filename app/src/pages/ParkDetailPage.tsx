import { Suspense, lazy, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Helmet } from 'react-helmet-async'
import CoasterTable from '../components/CoasterTable'
import ParkDetailSkeleton from '../components/ParkDetailSkeleton'
import { MessageState, Panel } from '../components/ui'
import { useAllCoasters, usePark } from '../lib/coasters'
import { useIsAdmin } from '../lib/useIsAdmin'

// Admin-only quick-edit: code-split so non-admins never download the form.
// Mounted only for admins (useIsAdmin gates the button AND the lazy chunk).
const ParkEditModal = lazy(() => import('../components/admin/ParkEditModal'))

export default function ParkDetailPage() {
  const { slug } = useParams()
  const park = usePark(slug)
  const coasters = useAllCoasters()
  // Hook first (unconditional): anonymous users skip the profile query
  // entirely; authed users share Layout's ['profile', userId] cache entry.
  const isAdmin = useIsAdmin()
  const [adminEditOpen, setAdminEditOpen] = useState(false)
  const [adminError, setAdminError] = useState<string | null>(null)

  const parkCoasters = useMemo(() => {
    const parkData = park.data
    if (!coasters.data || !parkData) return []
    return coasters.data.filter((c) => c.park_id === parkData.id)
  }, [coasters.data, park.data])

  if (park.isPending || coasters.isPending) {
    return <ParkDetailSkeleton />
  }

  if (park.isError || coasters.isError) {
    return <MessageState tone="danger">Couldn&apos;t load that park.</MessageState>
  }

  if (!park.data) {
    return <MessageState>Park not found.</MessageState>
  }

  const location = [park.data.city, park.data.region, park.data.country].filter(Boolean).join(' · ')
  // Rows arrive ordered by BT score, so the first ranked row is the park's
  // best — the same "community ranking first" beat as the coaster detail page.
  const topCoaster = parkCoasters.find((c) => c.rank !== null)

  // Rank-free title (ranks move weekly); the description carries the standing —
  // same convention as CoasterDetailPage.
  const pageUrl = `${window.location.origin}/parks/${park.data.slug}`
  const title = `${park.data.name} — CoasterRank`
  const metaDescription =
    topCoaster && topCoaster.rank !== null
      ? `${park.data.name}${location ? ` (${location})` : ''} — ${parkCoasters.length} coaster${parkCoasters.length === 1 ? '' : 's'} ranked by the CoasterRank community. Top: ${topCoaster.name} (#${topCoaster.rank} on the board).`
      : `${park.data.name}${location ? ` (${location})` : ''} — ${parkCoasters.length} coaster${parkCoasters.length === 1 ? '' : 's'} on CoasterRank. Rank the ones you've ridden.`
  // AmusementPark entity + the park's lineup as an ItemList (top 10 by
  // community score — parkCoasters arrives in BT-score order). Client-rendered
  // JSON-LD, like the coaster page; social unfurls still get the SPA shell.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'AmusementPark',
    name: park.data.name,
    url: pageUrl,
    ...(location
      ? {
          address: {
            '@type': 'PostalAddress',
            ...(park.data.city ? { addressLocality: park.data.city } : {}),
            ...(park.data.region ? { addressRegion: park.data.region } : {}),
            ...(park.data.country ? { addressCountry: park.data.country } : {}),
          },
        }
      : {}),
    ...(parkCoasters.length > 0
      ? {
          containsPlace: parkCoasters.slice(0, 10).map((c) => ({
            '@type': 'RollerCoaster',
            name: c.name,
            url: `${window.location.origin}/coasters/${c.slug}`,
          })),
        }
      : {}),
  }

  return (
    <div>
      <Helmet>
        <title>{title}</title>
        <meta name="description" content={metaDescription} />
        <link rel="canonical" href={pageUrl} />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="CoasterRank" />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={metaDescription} />
        <meta property="og:url" content={pageUrl} />
        <meta name="twitter:card" content="summary" />
        <meta name="twitter:title" content={title} />
        <meta name="twitter:description" content={metaDescription} />
      </Helmet>
      {/* JSON-LD lives in the body (valid for crawlers) rather than Helmet:
          react-helmet-async drops script children, so head injection is
          unreliable here. */}
      <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
      <Panel className="p-5 sm:p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent-text">Park</p>
        <h1 className="display-heading mt-1 text-3xl text-ink sm:text-4xl">{park.data.name}</h1>
        <p className="mt-1 text-sm text-muted">
          {location ? `${location} · ` : ''}
          {parkCoasters.length} coasters
        </p>
        {isAdmin && (
          <p className="mt-2">
            <button
              type="button"
              onClick={() => {
                setAdminError(null)
                setAdminEditOpen(true)
              }}
              className="text-sm font-medium text-accent-text underline-offset-4 hover:underline"
            >
              Edit as admin
            </button>
          </p>
        )}
        {adminError && <p className="mt-2 text-sm text-danger">{adminError}</p>}
        {topCoaster && topCoaster.rank !== null && (
          <p className="mt-2 text-sm text-muted">
            Top coaster in this park:{' '}
            <Link
              to={`/coasters/${topCoaster.slug}`}
              className="font-medium text-ink hover:underline"
            >
              {topCoaster.name}
            </Link>{' '}
            — #{topCoaster.rank} on the board
          </p>
        )}
      </Panel>
      <div className="mt-4 sm:mt-6">
        {parkCoasters.length === 0 ? (
          <MessageState>No coasters from this park on the board yet.</MessageState>
        ) : (
          <CoasterTable rows={parkCoasters} showPark={false} />
        )}
      </div>
      {isAdmin && adminEditOpen && (
        <Suspense fallback={null}>
          <ParkEditModal
            initial={park.data}
            mode="edit"
            onClose={() => setAdminEditOpen(false)}
            onSaved={() => setAdminEditOpen(false)}
            onError={setAdminError}
          />
        </Suspense>
      )}
    </div>
  )
}
