import { Link, useParams } from 'react-router-dom'
import FewVotesBadge from '../components/FewVotesBadge'
import StatBlock from '../components/StatBlock'
import { MessageState } from '../components/ui'
import {
  capitalize,
  formatNumber,
  formatScore,
  useCoaster,
  useCoasterAliases,
  useManufacturers,
  useParks,
  yearFromDate,
} from '../lib/coasters'

export default function CoasterDetailPage() {
  const { slug } = useParams()
  const { data: coaster, isPending, isError } = useCoaster(slug)
  const parks = useParks()
  const manufacturers = useManufacturers()
  const aliases = useCoasterAliases(coaster?.id)

  if (isPending) {
    return <MessageState>Loading…</MessageState>
  }

  if (isError) {
    return <MessageState tone="danger">Couldn&apos;t load that coaster.</MessageState>
  }

  if (!coaster) {
    return <MessageState>Coaster not found.</MessageState>
  }

  const park = parks.data?.find((p) => p.id === coaster.park_id)
  const manufacturer = manufacturers.data?.find((m) => m.id === coaster.manufacturer_id)
  const location = [park?.city, park?.country].filter(Boolean).join(', ')
  const openingYear = yearFromDate(coaster.opening_date)

  return (
    <div>
      <p className="text-sm font-semibold uppercase tracking-[0.14em] text-accent-strong">
        {coaster.rank === null ? 'Not yet ranked' : `#${coaster.rank} on the board`}
      </p>
      <h1 className="display-heading mt-1 text-4xl text-ink sm:text-5xl">{coaster.name}</h1>
      <p className="mt-2 text-muted">
        {park && (
          <Link to={`/parks/${park.slug}`} className="font-medium hover:underline">
            {park.name}
          </Link>
        )}
        {location ? ` · ${location}` : ''}
        {manufacturer ? ` · ${manufacturer.name}` : ''}
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

      {aliases.data && aliases.data.length > 0 && (
        <p className="mt-2 text-xs text-muted">
          Also known as: {aliases.data.map((a) => a.name).join(' · ')}
        </p>
      )}

      <div className="mt-8">
        <Link to="/" className="text-sm font-medium text-ink underline-offset-4 hover:underline">
          ← Back to the board
        </Link>
      </div>
    </div>
  )
}
