import { Suspense, lazy, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Helmet } from 'react-helmet-async'
import CoasterDetailSkeleton from '../components/CoasterDetailSkeleton'
import RankingPanel from '../components/RankingPanel'
import { MessageState } from '../components/ui'
import type { RankingRow } from '../lib/board-types'
import { capitalize, formatScore, lineageNames, useCoaster, yearFromDate } from '../lib/coasters'
import { useIsAdmin } from '../lib/useIsAdmin'

// Admin-only quick-edit: code-split so non-admins never download the form.
// Mounted only for admins (useIsAdmin gates the button AND the lazy chunk).
const CoasterEditModal = lazy(() => import('../components/admin/CoasterEditModal'))

// Human-facing meta description: identity + community standing + physical
// stats, omitting whatever is unknown. The title stays rank-free (ranks move
// weekly); the description carries the standing.
function buildMetaDescription(coaster: RankingRow, location: string): string {
  const parkBit = coaster.park_name ? ` at ${coaster.park_name}` : ''
  const locationBit = location ? ` (${location})` : ''
  const standingBit =
    coaster.rank !== null && coaster.score !== null && coaster.comparisons !== null
      ? ` — ranked #${coaster.rank} on CoasterRank with a ${formatScore(coaster.score)} community score across ${coaster.comparisons} comparisons.`
      : ' — not yet ranked on CoasterRank.'
  const statBits = [
    coaster.height_m !== null ? `${coaster.height_m} m tall` : null,
    coaster.speed_kmh !== null ? `${coaster.speed_kmh} km/h` : null,
    coaster.length_m !== null ? `${coaster.length_m} m long` : null,
    coaster.inversions !== null
      ? `${coaster.inversions} inversion${coaster.inversions === 1 ? '' : 's'}`
      : null,
  ].filter(Boolean)
  const statsBit = statBits.length > 0 ? ` ${statBits.join(' · ')}.` : ''
  return `${coaster.name}${parkBit}${locationBit}${standingBit}${statsBit}`
}

// Schema.org RollerCoaster entity for crawlers that execute JS (Google indexes
// client-rendered JSON-LD; social unfurls still get the SPA shell — accepted,
// see the worker's rider-only prerender). Specs ride as additionalProperty
// PropertyValues (valid on Place, which RollerCoaster inherits); only known
// values are emitted.
function buildJsonLd(coaster: RankingRow, pageUrl: string, metaDescription: string) {
  const specs: Array<{ '@type': 'PropertyValue'; name: string; value: string }> = []
  const trackLabel = coaster.model ?? coaster.type
  if (trackLabel) specs.push({ '@type': 'PropertyValue', name: 'track', value: trackLabel })
  specs.push({ '@type': 'PropertyValue', name: 'material', value: capitalize(coaster.material) })
  specs.push({ '@type': 'PropertyValue', name: 'status', value: capitalize(coaster.status) })
  if (coaster.height_m !== null)
    specs.push({ '@type': 'PropertyValue', name: 'height', value: `${coaster.height_m} m` })
  if (coaster.speed_kmh !== null)
    specs.push({ '@type': 'PropertyValue', name: 'speed', value: `${coaster.speed_kmh} km/h` })
  if (coaster.length_m !== null)
    specs.push({ '@type': 'PropertyValue', name: 'length', value: `${coaster.length_m} m` })
  if (coaster.inversions !== null)
    specs.push({
      '@type': 'PropertyValue',
      name: 'inversions',
      value: String(coaster.inversions),
    })
  if (coaster.rank !== null)
    specs.push({ '@type': 'PropertyValue', name: 'communityRank', value: String(coaster.rank) })
  if (coaster.score !== null)
    specs.push({
      '@type': 'PropertyValue',
      name: 'communityScore',
      value: formatScore(coaster.score),
    })
  if (coaster.comparisons !== null)
    specs.push({
      '@type': 'PropertyValue',
      name: 'comparisons',
      value: String(coaster.comparisons),
    })

  return {
    '@context': 'https://schema.org',
    '@type': 'RollerCoaster',
    name: coaster.name,
    description: metaDescription,
    url: pageUrl,
    ...(coaster.park_name
      ? {
          containedInPlace: {
            '@type': 'AmusementPark',
            name: coaster.park_name,
            ...(coaster.park_city || coaster.park_country
              ? {
                  address: {
                    '@type': 'PostalAddress',
                    ...(coaster.park_city ? { addressLocality: coaster.park_city } : {}),
                    ...(coaster.park_country ? { addressCountry: coaster.park_country } : {}),
                  },
                }
              : {}),
          },
        }
      : {}),
    ...(coaster.opening_date ? { openingDate: coaster.opening_date } : {}),
    ...(lineageNames(coaster).length > 0
      ? {
          manufacturer: lineageNames(coaster).map((name) => ({
            '@type': 'Organization',
            name,
          })),
        }
      : {}),
    additionalProperty: specs,
  }
}

export default function CoasterDetailPage() {
  const { slug } = useParams()
  const { data: coaster, isPending, isError } = useCoaster(slug)
  // Hook first (unconditional): anonymous users skip the profile query
  // entirely; authed users share Layout's ['profile', userId] cache entry.
  const isAdmin = useIsAdmin()
  const [adminEditOpen, setAdminEditOpen] = useState(false)
  const [adminError, setAdminError] = useState<string | null>(null)

  if (isPending) {
    return <CoasterDetailSkeleton />
  }

  if (isError) {
    return <MessageState tone="danger">Couldn&apos;t load that coaster.</MessageState>
  }

  if (!coaster) {
    return <MessageState>Coaster not found.</MessageState>
  }

  // Park display fields (name/slug/city/country) are denormalized onto the
  // view row — no parks query needed on this page.
  const location = [coaster.park_city, coaster.park_country].filter(Boolean).join(', ')
  const openingYear = yearFromDate(coaster.opening_date)
  // Fully unfurled manufacturer lineage (the board shows "X et al").
  const manufacturerLineage = lineageNames(coaster)

  // All eight reference facts share one label-over-value grid (no card
  // chrome): the four physical specs plus track/material/opened/status.
  // `model` carries the track type ("I-Box Track"); `type` usually duplicates
  // material ("Steel"), so it's only a fallback when model is missing.
  // Unknown track/opening renders as an em dash like the other specs.
  const trackLabel = coaster.model ?? coaster.type
  const specs = [
    { label: 'Height', value: coaster.height_m === null ? '—' : `${coaster.height_m} m` },
    { label: 'Speed', value: coaster.speed_kmh === null ? '—' : `${coaster.speed_kmh} km/h` },
    { label: 'Length', value: coaster.length_m === null ? '—' : `${coaster.length_m} m` },
    { label: 'Inversions', value: coaster.inversions === null ? '—' : String(coaster.inversions) },
    { label: 'Track', value: trackLabel ?? '—' },
    { label: 'Material', value: capitalize(coaster.material) },
    { label: 'Opened', value: openingYear === null ? '—' : String(openingYear) },
    { label: 'Status', value: capitalize(coaster.status) },
  ]

  const pageUrl = `${window.location.origin}/coasters/${coaster.slug}`
  const title = coaster.park_name
    ? `${coaster.name} at ${coaster.park_name} — CoasterRank`
    : `${coaster.name} — CoasterRank`
  const metaDescription = buildMetaDescription(coaster, location)
  const jsonLd = buildJsonLd(coaster, pageUrl, metaDescription)

  return (
    <div>
      <Helmet>
        <title>{title}</title>
        <meta name="description" content={metaDescription} />
        <link rel="canonical" href={pageUrl} />
        <meta property="og:type" content="article" />
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

      {/* Identity block (brief §1): park · location · manufacturers (full
          lineage), then the name in display type. The community ranking
          lives in the panel below — before any spec data. */}
      <p className="text-sm text-muted">
        {coaster.park_name && coaster.park_slug && (
          <Link to={`/parks/${coaster.park_slug}`} className="font-medium text-ink hover:underline">
            {coaster.park_name}
          </Link>
        )}
        {location ? ` · ${location}` : ''}
        {manufacturerLineage.length > 0 ? ` · ${manufacturerLineage.join(' · ')}` : ''}
      </p>
      <h1 className="display-heading mt-1 text-4xl text-ink sm:text-5xl">{coaster.name}</h1>

      <RankingPanel coaster={coaster} />

      {/* Coaster Details (brief §6): demoted reference data — visually plain
          whitespace-separated pairs, clearly scoped below the ranking. */}
      <section aria-labelledby="coaster-details-heading" className="mt-8">
        <h2
          id="coaster-details-heading"
          className="text-xs font-semibold uppercase tracking-[0.16em] text-muted"
        >
          Coaster details
        </h2>
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
          {specs.map((spec) => (
            <div key={spec.label}>
              <dt className="text-xs uppercase tracking-[0.12em] text-muted">{spec.label}</dt>
              <dd className="mt-1 text-lg font-semibold text-ink">{spec.value}</dd>
            </div>
          ))}
        </dl>
        {coaster.aliases && coaster.aliases.length > 0 && (
          <p className="mt-5 text-xs text-muted">Also known as: {coaster.aliases.join(' · ')}</p>
        )}
        <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2">
          <Link
            to={`/coasters/${slug}/suggest-edit`}
            className="text-sm font-medium text-muted underline-offset-4 transition-colors hover:text-ink hover:underline"
          >
            See something wrong? Suggest an edit
          </Link>
          {isAdmin && (
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
          )}
        </div>
        {adminError && <p className="mt-2 text-sm text-danger">{adminError}</p>}
      </section>
      {isAdmin && adminEditOpen && (
        <Suspense fallback={null}>
          <CoasterEditModal
            initial={coaster}
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
