// Relative-time formatting shared by the board's "Live ●" affordance
// (LiveStatusPopunder) and the detail pages' freshness markers
// (RankingPanel). Pure formatting, no data fetching — consumers re-render on
// a ~30s tick so labels stay honest without network traffic.
export function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const elapsedMs = Date.now() - then
  const minutes = Math.floor(elapsedMs / 60_000)
  if (minutes < 1) return 'just now'
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  if (minutes < 60) return rtf.format(-minutes, 'minute')
  const hours = Math.floor(elapsedMs / 3_600_000)
  if (hours < 24) return rtf.format(-hours, 'hour')
  return rtf.format(-Math.floor(elapsedMs / 86_400_000), 'day')
}

// The recompute pipeline's slot cadence (pg_cron `*/5`): refits land on
// 5-minute clock boundaries. BOARD_STALE_TIME_MS (lib/coasters) matches this
// by design; the constant lives here so the Live affordance can estimate the
// next refit from the clock alone — no board data, no network.
export const RECOMPUTE_CADENCE_MS = 5 * 60_000

// Milliseconds until the next refit slot boundary. Pure: the caller supplies
// the clock so tests can pin it (Date.now()-free).
export function msToNextRefit(nowMs: number, cadenceMs: number = RECOMPUTE_CADENCE_MS): number {
  return cadenceMs - (nowMs % cadenceMs)
}

// Human estimate for the popunder's "next refit" line: rounded up to whole
// minutes, collapsing to "within a minute" inside the last 60s (an estimate,
// not a promise — an idle community's slot skips and the estimate rolls to
// the next boundary).
export function nextRefitLabel(nowMs: number, cadenceMs: number = RECOMPUTE_CADENCE_MS): string {
  const remainingMs = msToNextRefit(nowMs, cadenceMs)
  if (remainingMs < 60_000) return 'within a minute'
  return `in ~${Math.ceil(remainingMs / 60_000)} min`
}
