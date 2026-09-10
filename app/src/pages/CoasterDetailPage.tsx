import { Suspense, lazy, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import RankingPanel from '../components/RankingPanel'
import { MessageState } from '../components/ui'
import { capitalize, lineageNames, useCoaster, yearFromDate } from '../lib/coasters'
import { useIsAdmin } from '../lib/useIsAdmin'

// Admin-only quick-edit: code-split so non-admins never download the form.
// Mounted only for admins (useIsAdmin gates the button AND the lazy chunk).
const CoasterEditModal = lazy(() => import('../components/admin/CoasterEditModal'))

export default function CoasterDetailPage() {
  const { slug } = useParams()
  const { data: coaster, isPending, isError } = useCoaster(slug)
  // Hook first (unconditional): anonymous users skip the profile query
  // entirely; authed users share Layout's ['profile', userId] cache entry.
  const isAdmin = useIsAdmin()
  const [adminEditOpen, setAdminEditOpen] = useState(false)
  const [adminError, setAdminError] = useState<string | null>(null)

  if (isPending) {
    return <MessageState>Loading…</MessageState>
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

  // One consolidated metadata line (brief §6) — folds the former orphaned
  // "I-Box Track · Steel · 2018" fragment and the separate Material card
  // into a single "Track · Material · Opened · Status" row. `model` carries
  // the track type ("I-Box Track"); `type` usually duplicates material
  // ("Steel"), so it's only a fallback when model is missing.
  const trackLabel = coaster.model ?? coaster.type
  const metadata = [
    trackLabel ? `Track: ${trackLabel}` : null,
    `Material: ${capitalize(coaster.material)}`,
    openingYear ? `Opened: ${openingYear}` : null,
    `Status: ${capitalize(coaster.status)}`,
  ]
    .filter(Boolean)
    .join(' · ')

  // Static specs, demoted to plain label-over-value pairs (no card chrome).
  const specs = [
    { label: 'Height', value: coaster.height_m === null ? '—' : `${coaster.height_m} m` },
    { label: 'Speed', value: coaster.speed_kmh === null ? '—' : `${coaster.speed_kmh} km/h` },
    { label: 'Length', value: coaster.length_m === null ? '—' : `${coaster.length_m} m` },
    { label: 'Inversions', value: coaster.inversions === null ? '—' : String(coaster.inversions) },
  ]

  return (
    <div>
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
        <p className="mt-5 text-sm text-muted">{metadata}</p>
        {coaster.aliases && coaster.aliases.length > 0 && (
          <p className="mt-2 text-xs text-muted">Also known as: {coaster.aliases.join(' · ')}</p>
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
