// Percentiles + knee detection for the bench report. Pure functions (tested).
export interface RunSample {
  ts?: string
  label: string
  variant: string
  users: number
  rides: number
  R: number
  repeat: number
  ok: boolean
  invokeMs: number
  durationMs: number | null
  rpcMs: number | null
  rpcBytes: number | null
  pairs: number | null
  iterations: number | null
  error: string | null
  updated?: number | null
}

export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const rank = Math.ceil((p / 100) * sorted.length) - 1
  return sorted[Math.max(0, Math.min(sorted.length - 1, rank))] as number
}

export interface PointStats {
  label: string
  variant: string
  users: number
  rides: number
  R: number
  runs: number
  errors: number
  rpcP50: number | null
  rpcP95: number | null
  durationP50: number | null
  durationP95: number | null
  pairsMedian: number | null
  pairsMax: number | null
  iterationsMedian: number | null
  bytesMedian: number | null
}

export function summarize(label: string, samples: readonly RunSample[]): PointStats | null {
  if (samples.length === 0) return null
  const first = samples[0] as RunSample
  const oks = samples.filter((s) => s.ok)
  const rpc = oks.map((s) => s.rpcMs).filter((v): v is number => v !== null)
  const dur = oks.map((s) => s.durationMs).filter((v): v is number => v !== null)
  const pairs = oks.map((s) => s.pairs).filter((v): v is number => v !== null)
  const iters = oks.map((s) => s.iterations).filter((v): v is number => v !== null)
  const bytes = oks.map((s) => s.rpcBytes).filter((v): v is number => v !== null)
  return {
    label: first.label,
    variant: first.variant,
    users: first.users,
    rides: first.rides,
    R: first.R,
    runs: samples.length,
    errors: samples.length - oks.length,
    rpcP50: percentile(rpc, 50),
    rpcP95: percentile(rpc, 95),
    durationP50: percentile(dur, 50),
    durationP95: percentile(dur, 95),
    pairsMedian: percentile(pairs, 50),
    pairsMax: pairs.length ? Math.max(...pairs) : null,
    iterationsMedian: percentile(iters, 50),
    bytesMedian: percentile(bytes, 50),
  }
}

// The "knee": smallest R whose p95 latency crosses the threshold. The gateway
// empirically kills single calls around ~7s, so 5000ms is the safety margin.
export const KNEE_THRESHOLD_MS = 5000

export function findKnee(
  stats: readonly (PointStats | null)[],
  metric: (s: PointStats) => number | null,
): PointStats | null {
  let knee: PointStats | null = null
  for (const s of stats) {
    if (!s || knee) continue
    const v = metric(s)
    if (v !== null && v >= KNEE_THRESHOLD_MS) knee = s
  }
  return knee
}

export function firstErrorPoint(stats: readonly (PointStats | null)[]): PointStats | null {
  for (const s of stats) {
    if (s && s.errors > 0) return s
  }
  return null
}
