import { Link } from 'react-router-dom'
import { capitalize } from '../lib/coasters'
import type { RiderRide } from '../lib/rider'
import { Badge } from './ui'

/**
 * Read-only ranked list for public rider pages. Unlike RankedCoasterItem there
 * is no drag/remove/mutation surface — rank is the primary visual signal,
 * matching the board's presentation (DECISIONS.md §Layout).
 */
function rankNumberClass(rank: number): string {
  if (rank === 1) return 'bg-coral/10 text-accent-strong [text-shadow:0_1px_0_rgb(255_255_255)]'
  if (rank === 2) return 'bg-coral/5 text-accent-strong [text-shadow:0_1px_0_rgb(255_255_255)]'
  if (rank === 3) return 'bg-coral/2 text-accent-strong [text-shadow:0_1px_0_rgb(255_255_255)]'
  return 'text-muted'
}

export default function RiderRideList({ rides }: { rides: RiderRide[] }) {
  return (
    <ol className="divide-y divide-line/70">
      {rides.map((ride) => {
        return (
          <li
            key={ride.coaster_id}
            className="flex items-center gap-3 bg-surface-bright px-4 py-3 text-sm transition-colors hover:bg-canvas"
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
