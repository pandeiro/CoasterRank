import { Link, useParams } from 'react-router-dom'
import RankingPanel from '../components/RankingPanel'
import { MessageState } from '../components/ui'
import { capitalize, useCoaster, yearFromDate } from '../lib/coasters'

export default function CoasterDetailPage() {
  const { slug } = useParams()
  const { data: coaster, isPending, isError } = useCoaster(slug)

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
      {/* Identity block (brief §1): park · location · manufacturer, then the
          name in display type. The community ranking lives in the panel
          below — before any spec data. */}
      <p className="text-sm text-muted">
        {coaster.park_name && coaster.park_slug && (
          <Link to={`/parks/${coaster.park_slug}`} className="font-medium text-ink hover:underline">
            {coaster.park_name}
          </Link>
        )}
        {location ? ` · ${location}` : ''}
        {coaster.manufacturer_name ? ` · ${coaster.manufacturer_name}` : ''}
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
        <div className="mt-6">
          <Link
            to={`/coasters/${slug}/suggest-edit`}
            className="text-sm font-medium text-muted underline-offset-4 transition-colors hover:text-ink hover:underline"
          >
            See something wrong? Suggest an edit
          </Link>
        </div>
      </section>
    </div>
  )
}
