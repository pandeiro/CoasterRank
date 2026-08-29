import { Link } from 'react-router-dom'
import { capitalize } from '../lib/coasters'
import type { RiderRide } from '../lib/rider'
import { Badge } from './ui'

/**
 * Read-only ranked list for public rider pages. Unlike RankedCoasterItem there
 * is no drag/remove/mutation surface — rank is the primary visual signal,
 * matching the board's presentation (DECISIONS.md §Layout).
 */
export default function RiderRideList({ rides }: { rides: RiderRide[] }) {
  return (
    <ol className="divide-y divide-line/70">
      {rides.map((ride) => {
        const isTopThree = ride.rank <= 3
        return (
          <li
            key={ride.coaster_id}
            className="flex items-center gap-3 bg-surface-bright px-4 py-3 text-sm transition-colors hover:bg-canvas"
          >
            <span
              className={`display-heading w-10 shrink-0 text-center text-2xl ${
                isTopThree ? 'text-coral' : 'text-muted'
              }`}
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
            {ride.score !== null && (
              <span className="hidden shrink-0 font-mono text-xs text-muted sm:inline">
                {ride.score.toFixed(2)}
              </span>
            )}
            <Badge className="hidden shrink-0 sm:inline-flex">{capitalize(ride.material)}</Badge>
          </li>
        )
      })}
    </ol>
  )
}
