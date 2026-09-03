import { Link } from 'react-router-dom'
import type { RiderRide } from '../lib/rider'

/**
 * Read-only ranked list for public rider pages. Unlike RankedCoasterItem there
 * is no drag/remove/mutation surface — rank is the primary visual signal,
 * matching the board's presentation (DECISIONS.md §Layout).
 */
function rankRowClass(rank: number): string {
  if (rank === 1) return 'bg-coral/[0.08] hover:bg-coral/[0.08]'
  if (rank === 2) return 'bg-coral/[0.06] hover:bg-coral/[0.06]'
  if (rank === 3) return 'bg-coral/[0.04] hover:bg-coral/[0.04]'
  return 'bg-surface-bright hover:bg-canvas'
}

function rankNumberClass(rank: number): string {
  if (rank <= 3) return 'bg-white text-accent-strong shadow-sm'
  return 'text-muted'
}

export default function RiderRideList({ rides }: { rides: RiderRide[] }) {
  return (
    <ol className="divide-y divide-line/70">
      {rides.map((ride) => {
        return (
          <li
            key={ride.coaster_id}
            className={`flex items-center gap-3 px-4 py-3 text-sm transition-colors ${rankRowClass(ride.rank)}`}
          >
            <span
              className={`display-heading flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-2xl ${rankNumberClass(ride.rank)}`}
            >
              {ride.rank}
            </span>
            <div className="min-w-0 flex-1">
              <Link
                to={`/coasters/${ride.slug}`}
                className="font-semibold text-ink underline-offset-4 hover:underline"
              >
                {ride.name}
              </Link>
              <span className="ml-2 text-xs text-muted">
                {ride.park_slug ? (
                  <Link to={`/parks/${ride.park_slug}`} className="hover:underline">
                    {ride.park_name}
                  </Link>
                ) : (
                  ride.park_name
                )}
              </span>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
