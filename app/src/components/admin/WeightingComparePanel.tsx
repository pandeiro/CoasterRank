import { useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { FlaskConical } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { Button, Panel } from '../ui'
import { getAllCoastersAdmin, formatScore } from '../../lib/coasters'

// Admin-only weighting comparison (PLAN §5.1): refit Bradley-Terry in memory
// under the production default weighting vs admin-selected alternatives and
// show the rank differences side by side. Entirely read-only — the live board
// (coaster_ratings) is untouched; results live in this component's state only.

type VariantParams = { gamma: number; floor_pairs: number; ramp_k: number }

type VariantPreset = {
  key: string
  label: string
  blurb: string
  params: VariantParams
}

const PRESETS: VariantPreset[] = [
  {
    key: 'raw-counts',
    label: 'Raw counts',
    blurb:
      'Every opinion equal — no per-rider weighting at all (statistical ideal, but one big list outweighs the community).',
    params: { gamma: 0, floor_pairs: 0, ramp_k: 0 },
  },
  {
    key: 'old-default',
    label: 'Old default (one unit per rider)',
    blurb: 'What shipped before 2026-09-10: equal totals per rider, tiny lists over-concentrated.',
    params: { gamma: 1, floor_pairs: 0, ramp_k: 0 },
  },
  {
    key: 'evidence-no-floor',
    label: 'Evidence-weighted, no soft floor',
    blurb:
      'The default exponent without the phantom-pair floor — very short lists keep full-strength opinions.',
    params: { gamma: 0.5, floor_pairs: 0, ramp_k: 0 },
  },
  {
    key: 'evidence-ramp',
    label: 'Evidence-weighted + ramp',
    blurb: 'Exponent 0.5 with influence scaled by n/(n+8) — a softer on-ramp for short lists.',
    params: { gamma: 0.5, floor_pairs: 0, ramp_k: 8 },
  },
]

type CompareRow = { coaster_id: string; score: number; rank: number }

type VariantSummary = {
  spearman: number | null
  top10Overlap: number | null
  maxRankDelta: number | null
  meanAbsRankDelta: number | null
  compared: number
}

type CompareResponse = {
  default: { rows: CompareRow[] }
  variants: Array<{
    label: string
    params: VariantParams
    rows: CompareRow[]
    summary: VariantSummary
  }>
  topN: number
  durationMs: number
}

function Score({ score }: { score: number }) {
  // Board index: 100 = community average (raw BT strength × 100).
  return <span className="tabular-nums">{formatScore(score)}</span>
}

export default function WeightingComparePanel() {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(['raw-counts', 'old-default']),
  )
  const [result, setResult] = useState<CompareResponse | null>(null)

  const run = useMutation({
    mutationFn: async () => {
      const variants = PRESETS.filter((p) => selected.has(p.key)).map((p) => ({
        ...p.params,
        label: p.label,
      }))
      const { data, error } = await supabase.functions.invoke<CompareResponse>(
        'compare-weightings',
        { method: 'POST', body: { variants, topN: 25 } },
      )
      if (error) throw error
      return data!
    },
    onSuccess: (data) => setResult(data),
  })

  // Names for the result table; only fetched once a comparison has run.
  const names = useQuery({
    queryKey: ['coasters-admin-names'],
    queryFn: getAllCoastersAdmin,
    enabled: !!result,
    staleTime: Infinity,
  })
  const nameById = new Map((names.data ?? []).map((c) => [c.id, c.name]))

  const topRows = useMemo(() => {
    if (!result) return []
    const byId = new Map<string, { defaultRank: number; score: number }>()
    for (const r of result.default.rows.slice(0, result.topN)) {
      byId.set(r.coaster_id, { defaultRank: r.rank, score: r.score })
    }
    return [...byId.entries()].map(([coasterId, d]) => {
      const variantRanks = new Map<string, number>()
      for (const v of result.variants) {
        const row = v.rows.find((r) => r.coaster_id === coasterId)
        variantRanks.set(v.label, row?.rank ?? Number.POSITIVE_INFINITY)
      }
      return { coasterId, defaultRank: d.defaultRank, score: d.score, variantRanks }
    })
  }, [result])

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else if (next.size < 4) next.add(key)
      return next
    })
  }

  return (
    <Panel bleed className="p-3 sm:p-6">
      <div className="flex items-center gap-2">
        <FlaskConical size={18} className="text-accent-text" aria-hidden="true" />
        <h2 className="text-lg font-semibold text-ink">Weighting comparison</h2>
      </div>
      <p className="mt-1 text-sm text-muted">
        Refits the board in memory under the live default weighting vs selected alternatives.
        Read-only — the real board is never touched.
      </p>

      <div className="mt-4 space-y-2">
        {PRESETS.map((p) => (
          <label
            key={p.key}
            className="flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-surface p-3"
          >
            <input
              type="checkbox"
              checked={selected.has(p.key)}
              onChange={() => toggle(p.key)}
              disabled={run.isPending}
              className="mt-0.5 h-4 w-4 accent-coral"
            />
            <span>
              <span className="block text-sm font-medium text-ink">{p.label}</span>
              <span className="block text-xs text-muted">{p.blurb}</span>
            </span>
          </label>
        ))}
      </div>

      <Button
        type="button"
        onClick={() => run.mutate()}
        disabled={run.isPending || selected.size === 0}
        className="mt-4"
      >
        {run.isPending ? 'Fitting…' : 'Run comparison'}
      </Button>
      {selected.size >= 4 && (
        <p className="mt-2 text-xs text-muted">Maximum of 4 variants per run.</p>
      )}

      {run.isError && (
        <p className="mt-3 text-sm text-danger">Comparison failed: {run.error.message}</p>
      )}

      {result && (
        <div className="mt-5">
          <p className="text-xs text-muted">
            Fitted in {result.durationMs}ms &middot; top {result.topN} shown by default-weighting
            rank.
          </p>

          <div className="mt-2 space-y-2">
            {result.variants.map((v) => (
              <div key={v.label} className="rounded-lg bg-surface p-3 text-xs text-muted">
                <span className="font-semibold text-ink">{v.label}</span>
                {' — vs default: '}
                {v.summary.spearman !== null && (
                  <span>
                    Spearman {v.summary.spearman.toFixed(3)}
                    {' · '}
                  </span>
                )}
                {v.summary.top10Overlap !== null && (
                  <span>
                    top-10 overlap {Math.round(v.summary.top10Overlap * 10)}/10
                    {' · '}
                  </span>
                )}
                {v.summary.maxRankDelta !== null && (
                  <span>
                    max move {v.summary.maxRankDelta} pos
                    {v.summary.meanAbsRankDelta !== null &&
                      ` (avg ${v.summary.meanAbsRankDelta.toFixed(1)})`}
                  </span>
                )}
              </div>
            ))}
          </div>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th className="py-2 pr-2 font-semibold">#</th>
                  <th className="py-2 pr-2 font-semibold">Coaster</th>
                  <th className="py-2 pr-2 font-semibold">Score</th>
                  {result.variants.map((v) => (
                    <th key={v.label} className="py-2 pr-2 font-semibold">
                      {v.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {topRows.map((row) => (
                  <tr key={row.coasterId} className="border-b border-line/50">
                    <td className="py-1.5 pr-2 tabular-nums text-muted">{row.defaultRank}</td>
                    <td className="py-1.5 pr-2 font-medium text-ink">
                      {nameById.get(row.coasterId) ?? row.coasterId.slice(0, 8)}
                    </td>
                    <td className="py-1.5 pr-2 text-muted">
                      <Score score={row.score} />
                    </td>
                    {result.variants.map((v) => {
                      const vr = row.variantRanks.get(v.label) ?? Number.POSITIVE_INFINITY
                      const delta = row.defaultRank - vr
                      return (
                        <td key={v.label} className="py-1.5 pr-2 tabular-nums">
                          {Number.isFinite(vr) ? vr : '—'}
                          {delta !== 0 && Number.isFinite(vr) && (
                            <span
                              className={
                                delta > 0
                                  ? 'ml-1 text-xs text-success-text'
                                  : 'ml-1 text-xs text-danger-text'
                              }
                            >
                              {delta > 0 ? `↑${delta}` : `↓${-delta}`}
                            </span>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Panel>
  )
}
