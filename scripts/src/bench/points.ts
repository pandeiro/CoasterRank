// The R-sweep grid. R = U · n̄(n̄−1)/2 raw pair rows — the x-axis of the
// knee analysis. The brief's corners (50×50, 100×100, 200×250) are anchors;
// the rest interpolate the curve between them.
export interface GridPoint {
  label: string
  users: number
  rides: number
}

export const GRID: readonly GridPoint[] = [
  { label: '50x50', users: 50, rides: 50 },
  { label: '60x60', users: 60, rides: 60 },
  { label: '80x80', users: 80, rides: 80 },
  { label: '100x100', users: 100, rides: 100 },
  { label: '150x150', users: 150, rides: 150 },
  { label: '200x200', users: 200, rides: 200 },
  { label: '200x250', users: 200, rides: 250 },
]

export function estimateR(users: number, rides: number): number {
  return users * ((rides * (rides - 1)) / 2)
}

export function defaultRepeats(users: number, rides: number): number {
  return estimateR(users, rides) < 1_000_000 ? 5 : 3
}

// Stop rule: 3 consecutive failed invokes at one point → skip larger points
// (the gateway cliff has been found; bigger points only waste minutes).
export const MAX_CONSECUTIVE_FAILURES = 3
