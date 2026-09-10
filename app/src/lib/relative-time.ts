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
