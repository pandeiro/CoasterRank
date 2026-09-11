// Admin "Sharing" tab: the share loop, measured with existing telemetry only
// (PLAN §11 — no anon-writable event tables, no ?ref= attribution).
//
// Funnel half = admin_sharing_funnel() via the admin-sharing-metrics Edge
// Function (cumulative state, not a daily series — there are no enable-event
// timestamps in the DB; share opt-ins only ping Telegram). Traffic half = CF
// Web Analytics (RUM) pageviews on /riders/* + the /@ alias (merged to the
// canonical /riders/:username row, each annotated with live profile state)
// over the last 30 days, humans only (bot: 0), overlaid against signups.
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import StatBlock from '../StatBlock'
import { Badge, Button, MessageState, Panel } from '../ui'
import { fetchSharingMetrics, type SharingMetrics } from '../../lib/sharingMetrics'

const FUNNEL_STAGES = [
  { key: 'totalUsers', label: 'Riders', hint: 'non-synthetic accounts' },
  { key: 'withUsername', label: 'Username claimed', hint: 'share URL exists' },
  { key: 'eligible', label: 'Eligible', hint: '5+ coasters ranked' },
  { key: 'nudged', label: 'Nudged', hint: 'share banner shown once' },
  { key: 'sharingOn', label: 'Sharing on', hint: 'public_list enabled' },
] as const

function pct(part: number, whole: number): string {
  if (!whole) return '—'
  return `${Math.round((part / whole) * 100)}%`
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString()
}

/** Two independently-scaled series as overlay polylines — sparkline style,
 * no axes; each line normalizes to its own max. */
function DualSparkline({
  a,
  b,
  labelA,
  labelB,
}: {
  a: number[]
  b: number[]
  labelA: string
  labelB: string
}) {
  const w = 560
  const h = 120
  const pad = 6
  const points = (series: number[], max: number) =>
    series
      .map((v, i) => {
        const x = pad + (i * (w - 2 * pad)) / Math.max(series.length - 1, 1)
        const y = h - pad - (v / max) * (h - 2 * pad)
        return `${x.toFixed(1)},${y.toFixed(1)}`
      })
      .join(' ')
  const maxA = Math.max(...a, 1)
  const maxB = Math.max(...b, 1)
  return (
    <div>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="w-full"
        role="img"
        aria-label={`${labelA} vs ${labelB}`}
      >
        <polyline
          points={points(b, maxB)}
          fill="none"
          strokeWidth={2.5}
          className="stroke-accent-text"
        />
        <polyline
          points={points(a, maxA)}
          fill="none"
          strokeWidth={2.5}
          strokeDasharray="4 3"
          className="stroke-coral-text"
        />
      </svg>
      <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <span>
          <span aria-hidden className="mr-1 inline-block h-0.5 w-4 align-middle bg-accent-text" />
          {labelB}
        </span>
        <span>
          <span
            aria-hidden
            className="mr-1 inline-block h-0 w-4 translate-y-[-3px] align-middle border-t-2 border-dashed border-coral-text"
          />
          {labelA}
        </span>
      </p>
    </div>
  )
}

/** Both series aligned to the same UTC day range, missing days = 0. */
function buildAlignedSeries(metrics: SharingMetrics): { signups: number[]; pageviews: number[] } {
  const start = metrics.window.start.slice(0, 10)
  const end = metrics.window.end.slice(0, 10)
  const days: string[] = []
  const cursor = new Date(`${start}T00:00:00Z`)
  while (days.length < 62) {
    days.push(cursor.toISOString().slice(0, 10))
    if (cursor.toISOString().slice(0, 10) >= end) break
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  const signupsByDay = new Map(metrics.funnel.signupsDaily.map((d) => [d.day, d.count]))
  const viewsByDay = metrics.rum.available
    ? new Map(metrics.rum.daily.map((d) => [d.day, d.pageviews]))
    : new Map()
  return {
    signups: days.map((day) => signupsByDay.get(day) ?? 0),
    pageviews: days.map((day) => viewsByDay.get(day) ?? 0),
  }
}

export default function SharingPanel() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['admin-sharing-metrics'],
    queryFn: fetchSharingMetrics,
  })

  const aligned = useMemo(() => (data ? buildAlignedSeries(data) : null), [data])

  if (isLoading) return <MessageState>Loading sharing metrics…</MessageState>
  if (isError || !data) {
    return (
      <MessageState tone="danger">
        <p className="mb-3">
          Failed to load sharing metrics: {error instanceof Error ? error.message : 'unknown error'}
        </p>
        <Button variant="outline" size="sm" onClick={() => void refetch()}>
          Retry
        </Button>
      </MessageState>
    )
  }

  const t = data.funnel.totals
  const rum = data.rum

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
        <StatBlock label="Riders" value={t.totalUsers} />
        <StatBlock label="Eligible (5+ ranked)" value={t.eligible} />
        <StatBlock label="Nudged" value={t.nudged} />
        <StatBlock label="Sharing on" value={t.sharingOn} />
      </div>

      <Panel bleed className="p-3 sm:p-5">
        <h2 className="display-heading text-lg text-ink">Funnel</h2>
        <p className="mt-1 text-xs leading-5 text-muted">
          Cumulative state, not a daily series — enable events are not stored (opt-ins only ping
          Telegram; PLAN §11). Percentages are share of the previous stage.
        </p>
        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-[0.1em] text-muted">
              <th className="pb-2 font-semibold">Stage</th>
              <th className="pb-2 text-right font-semibold">Count</th>
              <th className="pb-2 text-right font-semibold">% of prev.</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/60">
            {FUNNEL_STAGES.map((stage, i) => {
              const count = t[stage.key]
              const prev = i > 0 ? t[FUNNEL_STAGES[i - 1].key] : count
              return (
                <tr key={stage.key}>
                  <td className="py-2">
                    <span className="font-medium text-ink">{stage.label}</span>{' '}
                    <span className="hidden text-xs text-muted sm:inline">{stage.hint}</span>
                  </td>
                  <td className="py-2 text-right tabular-nums text-ink">{count}</td>
                  <td className="py-2 text-right tabular-nums text-muted">{pct(count, prev)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </Panel>

      <Panel bleed className="p-3 sm:p-5">
        <h2 className="display-heading text-lg text-ink">Current sharers</h2>
        {data.funnel.sharers.length === 0 ? (
          <p className="mt-2 text-sm text-muted">Nobody has sharing enabled yet.</p>
        ) : (
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-[0.1em] text-muted">
                <th className="pb-2 font-semibold">Rider</th>
                <th className="pb-2 text-right font-semibold">Ranked</th>
                <th className="pb-2 text-right font-semibold">Nudged</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {data.funnel.sharers.map((s) => (
                <tr key={s.username}>
                  <td className="min-w-0 py-2 break-words [overflow-wrap:anywhere]">
                    <Link to={`/riders/${s.username}`} className="link-brand" target="_blank">
                      @{s.username}
                    </Link>
                  </td>
                  <td className="py-2 text-right tabular-nums text-ink">{s.rankedCount}</td>
                  <td className="py-2 text-right">
                    <Badge tone={s.nudged ? 'accent' : 'neutral'}>{s.nudged ? 'yes' : 'no'}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel bleed className="p-3 sm:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="display-heading text-lg text-ink">Shared-page traffic (30d)</h2>
          <p className="text-xs text-muted">
            Web Analytics · {formatDate(data.window.start)} – {formatDate(data.window.end)} UTC
          </p>
        </div>
        {!rum.available ? (
          <MessageState>
            <p className="font-medium">Web Analytics unavailable</p>
            <p className="mt-1 text-xs leading-5">{rum.reason}</p>
          </MessageState>
        ) : (
          <>
            {rum.topPaths.length === 0 ? (
              <p className="mt-3 text-sm text-muted">
                No human pageviews on shared pages yet — share a link and watch this space.
              </p>
            ) : (
              <div className="mt-3 grid gap-4 lg:grid-cols-2 lg:gap-5">
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-[0.1em] text-muted">
                    Top pages
                  </h3>
                  <p className="mt-1 text-xs leading-5 text-muted">
                    /riders/* + /@ alias merged to canonical. Visits = entries from outside the site
                    — in-app clicks add views only.
                    {rum.sampleIntervalMax != null && rum.sampleIntervalMax > 1 && (
                      <> Counts are ~×{rum.sampleIntervalMax}-sampled estimates.</>
                    )}
                  </p>
                  <table className="mt-2 w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-[0.1em] text-muted">
                        <th className="pb-2 font-semibold">Page</th>
                        <th className="pb-2 text-right font-semibold">Views</th>
                        <th className="pb-2 text-right font-semibold">Visits</th>
                        <th className="pb-2 text-right font-semibold">State</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line/60">
                      {rum.topPaths.map((p) => (
                        <tr key={p.path}>
                          <td className="min-w-0 py-2 pr-3 break-words [overflow-wrap:anywhere]">
                            {p.path.startsWith('/riders/') ? (
                              <Link to={p.path} className="link-brand" target="_blank">
                                {p.path}
                              </Link>
                            ) : (
                              <span className="font-mono text-xs text-ink-soft">{p.path}</span>
                            )}
                          </td>
                          <td className="py-2 text-right tabular-nums text-ink">{p.pageviews}</td>
                          <td className="py-2 pl-3 text-right text-xs tabular-nums text-muted">
                            {p.visits}
                          </td>
                          <td className="py-2 pl-3 text-right">
                            {p.status == null ? (
                              <span className="text-xs text-muted">—</span>
                            ) : (
                              <Badge
                                tone={
                                  p.status === 'sharing'
                                    ? 'accent'
                                    : p.status === 'private'
                                      ? 'neutral'
                                      : 'danger'
                                }
                                title={
                                  p.status === 'sharing'
                                    ? 'Profile is publicly shared'
                                    : p.status === 'private'
                                      ? 'Profile exists but sharing is off'
                                      : 'No live profile — deleted or never shared (still inside the 30d window)'
                                }
                              >
                                {p.status === 'sharing'
                                  ? 'sharing'
                                  : p.status === 'private'
                                    ? 'private'
                                    : 'gone'}
                              </Badge>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-[0.1em] text-muted">
                    Referrer hosts
                  </h3>
                  <table className="mt-2 w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-[0.1em] text-muted">
                        <th className="pb-2 font-semibold">Referrer</th>
                        <th className="pb-2 text-right font-semibold">Views</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line/60">
                      {rum.topReferrers.map((r) => (
                        <tr key={r.host}>
                          <td className="py-2 font-medium text-ink">{r.host || '(direct)'}</td>
                          <td className="py-2 text-right tabular-nums text-ink">{r.pageviews}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {aligned && (
              <div className="mt-5">
                <h3 className="text-xs font-semibold uppercase tracking-[0.1em] text-muted">
                  Signups vs shared-page views
                </h3>
                <DualSparkline
                  a={aligned.signups}
                  b={aligned.pageviews}
                  labelA="Signups (dashed)"
                  labelB="Shared-page views"
                />
              </div>
            )}
          </>
        )}
      </Panel>

      <Panel bleed className="p-3 text-xs leading-5 text-muted sm:p-5">
        <p className="font-semibold uppercase tracking-[0.1em] text-muted">Not visible here</p>
        <p className="mt-1">
          Copy clicks, nudge accepts/dismisses, and per-link attribution are not captured anywhere
          (deliberately — PLAN §11). Crawler-side unfurl counts (prerender serves, og.png renders)
          live in Workers Logs; share opt-in pings live in Telegram. RUM counts are browser-sampled
          estimates, so treat small numbers as directional.
        </p>
      </Panel>
    </div>
  )
}
