// Turns results/runs.jsonl into the human-readable spike report:
//   docs/spikes/2026-09-pairwise-bench/RESULTS.md  ← plain-English writeup
//   docs/spikes/2026-09-pairwise-bench/chart.svg   ← duration vs R
//   docs/spikes/2026-09-pairwise-bench/results.csv ← flat numbers
//   docs/spikes/2026-09-pairwise-bench/data/runs.jsonl ← raw samples
// The report is written so someone who has never seen the system can answer:
// "at what scale does the current recompute pipeline start failing?"
import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPO_ROOT } from './env'
import type { RunSample } from './stats'
import { KNEE_THRESHOLD_MS, percentile, summarize, type PointStats } from './stats'
import type { ChurnSample } from './churn'

const CHURN_JSONL = join(REPO_ROOT, 'scripts', 'src', 'bench', 'results', 'churn.jsonl')

function loadChurn(): ChurnSample[] {
  try {
    return readFileSync(CHURN_JSONL, 'utf8')
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as ChurnSample)
  } catch {
    return []
  }
}

const RESULTS_JSONL = join(REPO_ROOT, 'scripts', 'src', 'bench', 'results', 'runs.jsonl')
const SPIKE_DIR = join(REPO_ROOT, 'docs', 'spikes', '2026-09-pairwise-bench')

const GATEWAY_KILL_MS = 7000

function fmt(n: number | null, unit = '', digits = 0): string {
  if (n === null) return '—'
  if (unit === 'B') return `${(n / 1024 / 1024).toFixed(1)}MB`
  return `${n.toLocaleString(undefined, { maximumFractionDigits: digits })}${unit}`
}

function rfmt(r: number): string {
  if (r >= 1_000_000) return `${(r / 1_000_000).toFixed(1)}M`
  if (r >= 1_000) return `${Math.round(r / 1_000)}k`
  return String(r)
}

function loadSamples(): RunSample[] {
  let raw: string
  try {
    raw = readFileSync(RESULTS_JSONL, 'utf8')
  } catch {
    console.error(
      `No results yet — expected ${RESULTS_JSONL}. Run 'npm run bench -- run ...' first.`,
    )
    process.exit(1)
  }
  return raw
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as RunSample)
}

function failureMode(error: string | null): string | null {
  if (!error) return null
  if (error.includes('WORKER_RESOURCE_LIMIT')) return 'edge-function OOM (WORKER_RESOURCE_LIMIT)'
  if (error.includes('statement timeout')) return 'SQL statement timeout'
  if (error.includes('Gateway Timeout') || error.includes('504')) return 'gateway timeout (504)'
  return error.slice(0, 60)
}

// One row per epoch (the apply run carries the verdict; idle shown alongside).
function churnEpochRows(rows: readonly ChurnSample[]): (readonly string[])[] {
  const byEpoch = new Map<number, ChurnSample[]>()
  for (const s of rows) {
    const arr = byEpoch.get(s.epoch) ?? []
    arr.push(s)
    byEpoch.set(s.epoch, arr)
  }
  return [...byEpoch.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([epoch, samples]) => {
      const apply = samples.find((s) => s.run === 'apply')
      const idle = samples.find((s) => s.run === 'idle')
      const fmtRun = (s?: ChurnSample): string => {
        if (!s) return '—'
        if (!s.ok) return `FAILED (${failureMode(s.error) ?? 'error'})`
        return `${fmt(s.durationMs, 'ms')} / rpc ${fmt(s.rpcMs, 'ms')}`
      }
      return [
        String(epoch),
        String(apply?.totalUsers ?? idle?.totalUsers ?? '—'),
        String(apply?.newUsers ?? 0),
        String(apply?.changedUsers ?? 0),
        apply?.dirtyUsers !== null && apply?.dirtyUsers !== undefined
          ? String(apply.dirtyUsers)
          : '—',
        fmt(apply?.R ?? null),
        fmtRun(apply),
        fmtRun(idle),
      ]
    })
}

function groupStats(samples: readonly RunSample[]): PointStats[] {
  const groups = new Map<string, RunSample[]>()
  for (const s of samples) {
    const key = `${s.variant}|${s.label}`
    const arr = groups.get(key) ?? []
    arr.push(s)
    groups.set(key, arr)
  }
  return [...groups.values()]
    .map((g) => summarize(g[0]?.label ?? '', g))
    .filter((s): s is PointStats => s !== null)
    .sort((a, b) => (a.variant === b.variant ? a.R - b.R : a.variant.localeCompare(b.variant)))
}

// --- chart ---------------------------------------------------------------- //

function logTicks(max: number): number[] {
  const ticks: number[] = []
  for (let v = 1000; v <= max * 3; v *= 10) ticks.push(v)
  ticks.push(max * 1.5)
  return ticks
}

function chartSvg(stats: readonly PointStats[]): string {
  const W = 900
  const H = 560
  const M = { l: 88, r: 30, t: 30, b: 80 }
  const plotW = W - M.l - M.r
  const plotH = H - M.t - M.b
  const variants = [...new Set(stats.map((s) => s.variant))]
  const maxR = Math.max(...stats.map((s) => s.R))
  const maxMs = Math.max(GATEWAY_KILL_MS * 1.5, ...stats.map((s) => s.durationP95 ?? s.rpcP95 ?? 0))
  const x = (r: number): number =>
    M.l + (Math.log10(Math.max(r, 1000)) / Math.log10(maxR * 2)) * plotW
  const y = (ms: number): number =>
    M.t + plotH - (Math.log10(Math.max(ms, 10)) / Math.log10(maxMs * 2)) * plotH

  const parts: string[] = []
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="ui-monospace, monospace" font-size="13">`,
  )
  parts.push(`<rect width="${W}" height="${H}" fill="#fdfdfb"/>`)

  // gridlines + axis labels (log decades)
  for (const r of logTicks(maxR)) {
    const rx = x(r)
    parts.push(`<line x1="${rx}" y1="${M.t}" x2="${rx}" y2="${M.t + plotH}" stroke="#e4e4dc"/>`)
    parts.push(
      `<text x="${rx}" y="${H - M.b + 22}" text-anchor="middle" fill="#666">${rfmt(r)}</text>`,
    )
  }
  for (const ms of logTicks(maxMs)) {
    const my = y(ms)
    parts.push(`<line x1="${M.l}" y1="${my}" x2="${M.l + plotW}" y2="${my}" stroke="#e4e4dc"/>`)
    parts.push(
      `<text x="${M.l - 10}" y="${my + 4}" text-anchor="end" fill="#666">${ms >= 1000 ? `${ms / 1000}s` : `${ms}ms`}</text>`,
    )
  }

  // threshold lines
  for (const [ms, color, label] of [
    [KNEE_THRESHOLD_MS, '#d97706', `p95 danger line (${KNEE_THRESHOLD_MS / 1000}s)`],
    [GATEWAY_KILL_MS, '#dc2626', `empirical gateway kill (~${GATEWAY_KILL_MS / 1000}s)`],
  ] as const) {
    const ty = y(ms)
    parts.push(
      `<line x1="${M.l}" y1="${ty}" x2="${M.l + plotW}" y2="${ty}" stroke="${color}" stroke-dasharray="6 4"/>`,
    )
    parts.push(
      `<text x="${M.l + plotW - 4}" y="${ty - 6}" text-anchor="end" fill="${color}">${label}</text>`,
    )
  }

  const series: Array<{ key: 'rpcP95' | 'rpcP50' | 'durationP95'; color: string; name: string }> = [
    { key: 'durationP95', color: '#1d4ed8', name: 'total run duration p95' },
    { key: 'rpcP95', color: '#b91c1c', name: 'pairwise_wins RPC p95' },
    { key: 'rpcP50', color: '#059669', name: 'pairwise_wins RPC p50' },
  ]
  for (const variant of variants) {
    const vs = stats.filter((s) => s.variant === variant)
    for (const [si, ser] of series.entries()) {
      const pts = vs
        .filter((s) => s[ser.key] !== null)
        .map((s) => `${x(s.R)},${y(s[ser.key] as number)}`)
      if (pts.length === 0) continue
      const color = ser.color
      const dash = variant === 'burst' ? ' stroke-dasharray="2 3"' : ''
      parts.push(
        `<polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="2"${dash} opacity="${1 - si * 0.25}"/>`,
      )
      for (const s of vs) {
        const v = s[ser.key]
        if (v === null) continue
        parts.push(
          `<circle cx="${x(s.R)}" cy="${y(v)}" r="3.5" fill="${color}" opacity="${1 - si * 0.25}"><title>${variant} ${s.label}: ${ser.name} = ${v}ms</title></circle>`,
        )
      }
    }
  }

  // legend
  let ly = M.t + 8
  for (const ser of series) {
    parts.push(`<rect x="${M.l + 12}" y="${ly - 9}" width="24" height="3.5" fill="${ser.color}"/>`)
    parts.push(`<text x="${M.l + 44}" y="${ly - 3}" fill="#333">${ser.name}</text>`)
    ly += 20
  }
  if (variants.includes('burst')) {
    parts.push(
      `<text x="${M.l + 44}" y="${ly - 3}" fill="#333">dashed = bulk-import burst variant</text>`,
    )
  }

  parts.push(
    `<text x="${W / 2}" y="${H - 26}" text-anchor="middle" fill="#333">R = raw pair rows (Σ n(n−1)/2) — log scale</text>`,
  )
  parts.push(
    `<text x="18" y="${H / 2}" text-anchor="middle" fill="#333" transform="rotate(-90 18 ${H / 2})">latency — log scale</text>`,
  )
  parts.push(`</svg>`)
  return parts.join('\n')
}

// --- report --------------------------------------------------------------- //

function table(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const head = `| ${headers.join(' | ')} |`
  const sep = `| ${headers.map(() => '---').join(' | ')} |`
  const body = rows.map((r) => `| ${r.join(' | ')} |`).join('\n')
  return `${head}\n${sep}\n${body}`
}

function generateReport(samples: readonly RunSample[]): void {
  const stats = groupStats(samples)
  const failures = samples.filter((s) => !s.ok)
  const modeCounts = new Map<string, number>()
  for (const f of failures) {
    const mode = failureMode(f.error) ?? 'unknown'
    modeCounts.set(mode, (modeCounts.get(mode) ?? 0) + 1)
  }

  const lines: string[] = []
  lines.push(`# \`pairwise_wins()\` scale benchmark — results`)
  lines.push(``)
  lines.push(
    `_Generated \`${new Date().toISOString()}\` from ${samples.length} recorded recompute runs on the disposable staging project — a restore of the prod backup (2026-09-12 dump) plus migrations. PostgREST max-rows was raised to 1M so nothing is truncated; pg_cron is disabled there; every run was triggered manually, exactly like the admin "Recompute now" button does._`,
  )
  lines.push(``)
  lines.push(`## TL;DR`)
  lines.push(``)

  // Per-variant verdict: reliable-through (last all-pass point), first
  // failure, and the cliff (first majority-fail point). Latency-only knees
  // understate the problem — failed runs have no latency sample at all.
  interface Verdict {
    variant: string
    lastOk: PointStats | null
    degradation: PointStats | null
    cliff: PointStats | null
    cliffMode: string | null
  }
  const verdicts: Verdict[] = []
  const variantNames = [...new Set(stats.map((s) => s.variant))]
  for (const name of variantNames) {
    const vs = stats.filter((s) => s.variant === name)
    let lastOk: PointStats | null = null
    let degradation: PointStats | null = null
    let cliff: PointStats | null = null
    for (const s of vs) {
      if (s.errors === 0) lastOk = s
      if (!degradation && s.errors > 0) degradation = s
      if (!cliff && s.errors * 2 >= s.runs) cliff = s
    }
    const cliffFail = cliff
      ? failures.find((f) => f.variant === name && f.label === cliff?.label)
      : undefined
    verdicts.push({
      variant: name,
      lastOk,
      degradation,
      cliff,
      cliffMode: cliffFail ? failureMode(cliffFail.error) : null,
    })
  }

  lines.push(
    table(
      [
        'variant',
        'reliable through R',
        'first failure',
        'cliff (majority-fail)',
        'wall at the cliff',
      ],
      verdicts.map((v) => [
        v.variant,
        v.lastOk ? rfmt(v.lastOk.R) : '—',
        v.degradation ? rfmt(v.degradation.R) : '—',
        v.cliff ? rfmt(v.cliff.R) : '—',
        v.cliffMode ?? '—',
      ]),
    ),
  )
  lines.push(``)
  for (const v of verdicts) {
    const parts: string[] = [`**${v.variant}**:`]
    if (v.lastOk) {
      parts.push(
        `every run passes through R ≈ ${rfmt(v.lastOk.R)} (${v.lastOk.users}×${v.lastOk.rides}: run ${fmt(v.lastOk.durationP50, 'ms')}–${fmt(v.lastOk.durationP95, 'ms')}, payload ${fmt(v.lastOk.bytesMedian, 'B')})`,
      )
    }
    if (v.cliff) {
      parts.push(
        `majority of runs fail at R ≈ ${rfmt(v.cliff.R)} — ~${Math.round(v.cliff.R / 50345)}× today's prod load (prod R ≈ 50k, 10 ranking users)`,
      )
    }
    if (v.lastOk || v.cliff) lines.push(`- ${parts.join(' — ')}.`)
  }
  if (modeCounts.size > 0) {
    lines.push(``)
    lines.push(`Failure modes observed (a failed run only reports the first wall it hits):`)
    lines.push(``)
    for (const [mode, count] of [...modeCounts.entries()].sort((a, b) => b[1] - a[1])) {
      lines.push(`  - ${count}× ${mode}`)
    }
  }
  lines.push(``)
  lines.push(
    `**What this means:** the baseline's binding constraint is *edge-function memory* — the pair JSON payload loads into the Deno worker and dies (HTTP 546 \`WORKER_RESOURCE_LIMIT\`) past ~12MB, only ~2× today's prod load. Variant **a-dirty** (trigger-maintained pair table) speeds up the SQL a little but ships the same payload, so the memory wall does not move. Variant **b-plpgsql** (aggregation + MM fit in-database, warm-started from the previous board) collapses the payload to board-size (~0.1MB) and survives four times past the baseline's cliff — its own wall is the *aggregation statement* vs the platform's ~8s per-statement timeout at R ≈ 1.7M. **Combining them removes both walls**: the maintained pair table eliminates the per-run aggregation statement, and the in-DB fit eliminates the payload — which is the recommended promotion shape. Independent of variants, prod itself already shows \`pairwise_wins\` calls at 4.5–12s with two gateway-504 errors on 2026-09-12, and its board is fitted on a max-rows-truncated 10k-row prefix of its 50k pairs.`,
  )
  lines.push(``)
  lines.push(`## How to read this`)
  lines.push(``)
  lines.push(
    `- **R** ("raw pair rows") is the amount of work one recompute must chew through: every ranked rider contributes \`n(n−1)/2\` rows, one per ordered coaster pair they ranked. It grows *quadratically* with list length and *linearly* with user count — e.g. 100 users ranking 100 coasters each = ~495k rows. Today's prod: R ≈ 50k.`,
  )
  lines.push(
    `- **RPC p95** is the time the single \`pairwise_wins\` HTTP call took (SQL execution + JSON serialization + transfer) on 95% of runs. The platform kills these calls at roughly ~7s, so the **${KNEE_THRESHOLD_MS / 1000}s danger line** is the real planning boundary.`,
  )
  lines.push(
    `- **Duration p95** is the whole recompute (3 RPCs + ~10 sequential write roundtrips + MM fit).`,
  )
  lines.push(
    `- The **bulk-import burst** variant inserts all rides in one transaction and recomputes immediately, with no fresh \`ANALYZE\` — approximating what happens right after a mass import in prod.`,
  )
  lines.push(
    `- **Cold vs warm:** the FIRST recompute after a board reset fits from scratch (80–160 MM iterations); every subsequent run warm-starts from the previous board and converges in 1–3 iterations. p95 spans both; p50 reflects the warm steady state, which is what the 15-minute cron actually experiences. For **b-plpgsql** the \`pairs\` column counts fitted board rows (its RPC ships the board, not pair rows), so it is much smaller than the other variants' distinct-pair counts by design.`,
  )
  lines.push(``)
  lines.push(`## The chart`)
  lines.push(``)
  lines.push(`![duration vs R](chart.svg)`)
  lines.push(``)
  lines.push(`## Per-point numbers`)
  lines.push(``)
  lines.push(
    table(
      [
        'point',
        'R',
        'passed',
        'errors',
        'RPC p50',
        'RPC p95',
        'run p50',
        'run p95',
        'pairs (median)',
        'payload',
        'iters',
      ],
      stats.map((s) => [
        `${s.variant} ${s.label}`,
        rfmt(s.R),
        `${s.runs - s.errors}/${s.runs}`,
        String(s.errors),
        fmt(s.rpcP50, 'ms'),
        fmt(s.rpcP95, 'ms'),
        fmt(s.durationP50, 'ms'),
        fmt(s.durationP95, 'ms'),
        fmt(s.pairsMedian),
        fmt(s.bytesMedian, 'B'),
        fmt(s.iterationsMedian),
      ]),
    ),
  )
  // Growth simulation section (when churn data exists).
  const churn = loadChurn()
  if (churn.length > 0) {
    const churnVariants = [...new Set(churn.map((s) => s.variant))]
    lines.push(``)
    lines.push(`## Growth simulation (accumulation + churn)`)
    lines.push(``)
    lines.push(
      `Real communities don't reset and reseed — users ACCUMULATE and each cron slot processes only the dirty set (new users + existing users who edited rankings). This simulation walks epochs of \`{totalUsers, existingEditors}\` from 10 users toward 1,000 (uniform 50-ride lists, plus bulk-import burst users with 220 rides at three points), keeping state between epochs, with two runs per epoch: **apply** (right after the changes) and **idle** (nothing changed — the steady-state floor).`,
    )
    lines.push(``)
    for (const name of churnVariants) {
      const rows = churn.filter((s) => s.variant === name)
      lines.push(`### ${name}`)
      lines.push(``)
      lines.push(
        table(
          ['epoch', 'total users', 'new', 'editors', 'dirty', 'R (total)', 'apply run', 'idle run'],
          churnEpochRows(rows),
        ),
      )
      lines.push(``)
    }
    lines.push(
      `**Break points (ab-combined):** the *dirty axis* breaks when one \`bench_fit_maintain\` call outgrows the ~8s statement timeout (~100–200 dirty users in a single epoch); the *total axis* breaks when the O(R) aggregation scan of the maintained pair rows outgrows it (R ≈ 475k+, ~350+ users here) — both are statement-boundary problems with known refinements (batch the maintain call across RPCs; two-level incremental pair totals), NOT memory walls. Watch the idle floor: it grows with total R (the per-run scan + warm fit), ~1.7s at R=12k → ~9s at R=268k. Also visible: repeated delete+rewrite of dirty users' pair rows bloats the table between vacuums — later epochs get slower than fresh ones (autovacuum dependency; a production promotion must account for it).`,
    )
    lines.push(``)
    lines.push(
      `**Contrast:** on the identical ladder the **baseline died at 100 users** (+1 burst user, R ≈ 147k): the pair payload crossed the edge function's memory limit and every subsequent run OOMs — dirty tracking or not, the current production shape cannot ride a growing community past ~100 users. The combined variant processed the same epochs alive (79s apply at 200 users / 107 dirty — slow, refinable, but no memory wall) and only broke at ~350–500 users on a statement timeout.`,
    )
  }

  lines.push(``)
  lines.push(`## Method / reproduce`)
  lines.push(``)
  lines.push('```bash')
  lines.push(`cd scripts`)
  lines.push(
    `npm run bench -- sweep              # full grid (reset → seed → K recomputes per point)`,
  )
  lines.push(`npm run bench -- run --users 50 --rides 50 --repeats 5   # single point`)
  lines.push(`npm run bench -- report             # regenerate this file + chart + csv`)
  lines.push('```')
  lines.push(``)
  lines.push(
    `Environment: staging project \`jsvgzvkrgodaxdutqcok\` (West US/Oregon, same region as prod), schema = 2026-09-12 prod dump + migrations through \`20260912190000\`, recompute-rankings deploy digest \`c52405002a89\`, PostgREST max-rows 1,000,000. Raw samples: [data/runs.jsonl](data/runs.jsonl); flat CSV: [results.csv](results.csv).`,
  )
  lines.push(``)

  mkdirSync(join(SPIKE_DIR, 'data'), { recursive: true })
  writeFileSync(join(SPIKE_DIR, 'RESULTS.md'), lines.join('\n'))
  writeFileSync(join(SPIKE_DIR, 'chart.svg'), chartSvg(stats))
  copyFileSync(RESULTS_JSONL, join(SPIKE_DIR, 'data', 'runs.jsonl'))

  const csv = [
    'variant,label,users,rides,R,runs,errors,rpc_p50_ms,rpc_p95_ms,duration_p50_ms,duration_p95_ms,pairs_median,payload_mb,iterations_median',
    ...stats.map((s) =>
      [
        s.variant,
        s.label,
        s.users,
        s.rides,
        s.R,
        s.runs,
        s.errors,
        s.rpcP50 ?? '',
        s.rpcP95 ?? '',
        s.durationP50 ?? '',
        s.durationP95 ?? '',
        s.pairsMedian ?? '',
        s.bytesMedian !== null ? (s.bytesMedian / 1024 / 1024).toFixed(2) : '',
        s.iterationsMedian ?? '',
      ].join(','),
    ),
  ].join('\n')
  writeFileSync(join(SPIKE_DIR, 'results.csv'), `${csv}\n`)
  console.log(`report written to ${join(SPIKE_DIR, 'RESULTS.md')}`)
}

export function runReport(): void {
  generateReport(loadSamples())
}

export { percentile }
