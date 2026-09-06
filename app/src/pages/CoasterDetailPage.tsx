import { Link, useParams } from 'react-router-dom'
import FewVotesBadge from '../components/FewVotesBadge'
import StatBlock from '../components/StatBlock'
import { MessageState } from '../components/ui'
import {
  capitalize,
  firstPlaceLabel,
  formatNumber,
  formatScore,
  useCoaster,
  yearFromDate,
} from '../lib/coasters'

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
  const firstPlace = firstPlaceLabel(coaster.first_place_votes, coaster.participants)

  return (
    <div>
      <p className="text-sm font-semibold uppercase tracking-[0.14em] text-accent-text">
        {coaster.rank === null ? 'Not yet ranked' : `#${coaster.rank} on the board`}
      </p>
      <h1 className="display-heading mt-1 text-4xl text-ink sm:text-5xl">{coaster.name}</h1>
      <p className="mt-2 text-muted">
        {coaster.park_name && coaster.park_slug && (
          <Link to={`/parks/${coaster.park_slug}`} className="font-medium hover:underline">
            {coaster.park_name}
          </Link>
        )}
        {location ? ` · ${location}` : ''}
        {coaster.manufacturer_name ? ` · ${coaster.manufacturer_name}` : ''}
      </p>
      <div className="mt-2">
        {coaster.comparisons === null ? (
          <span className="text-sm text-muted">No ratings yet</span>
        ) : (
          <FewVotesBadge comparisons={coaster.comparisons} />
        )}
      </div>

      <dl className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatBlock
          label="Score"
          value={coaster.score === null ? '—' : formatScore(coaster.score)}
        />
        <StatBlock
          label="Comparisons"
          value={coaster.comparisons === null ? '—' : formatNumber(coaster.comparisons)}
        />
        <StatBlock
          label="Participants"
          value={coaster.participants === null ? '—' : formatNumber(coaster.participants)}
        />
        <StatBlock
          label="#1 votes"
          value={firstPlace ? `${firstPlace.votes} (${firstPlace.pct}%)` : '—'}
        />
        <StatBlock
          label="Height"
          value={coaster.height_m === null ? '—' : `${coaster.height_m} m`}
        />
        <StatBlock
          label="Speed"
          value={coaster.speed_kmh === null ? '—' : `${coaster.speed_kmh} km/h`}
        />
        <StatBlock
          label="Length"
          value={coaster.length_m === null ? '—' : `${coaster.length_m} m`}
        />
        <StatBlock
          label="Inversions"
          value={coaster.inversions === null ? '—' : String(coaster.inversions)}
        />
        <StatBlock label="Status" value={capitalize(coaster.status)} />
        <StatBlock label="Material" value={capitalize(coaster.material)} />
      </dl>

      {(coaster.model || coaster.type || openingYear) && (
        <p className="mt-4 text-sm text-muted">
          {[coaster.model, coaster.type, openingYear].filter(Boolean).join(' · ')}
        </p>
      )}

      {coaster.aliases && coaster.aliases.length > 0 && (
        <p className="mt-2 text-xs text-muted">Also known as: {coaster.aliases.join(' · ')}</p>
      )}

      <div className="mt-8">
        <Link to="/" className="text-sm font-medium text-ink underline-offset-4 hover:underline">
          ← Back to the board
        </Link>
      </div>
    </div>
  )
}
