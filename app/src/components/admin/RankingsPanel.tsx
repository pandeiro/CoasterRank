import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { Button, Panel } from '../ui'
import { refreshBoardData } from '../../lib/coasters'

type RecomputeResponse = {
  updated: number
  durationMs: number
  iterations: number
  converged: boolean
  skipped?: boolean
}

// rpc_stats.fit — present on every run since the in-DB pipeline shipped
// (shadow + indb modes; absent on 'legacy' rolls-back). Timings are the
// wall-clock around each RPC group; the dirty counters describe the queue
// as this run saw it (PROMOTION §5.3).
type FitStats = {
  mode?: string
  maintain_ms?: number
  maintain_calls?: number
  maintain_batch_final?: number
  agg_ms?: number
  step_ms?: number
  step_calls?: number
  step_p_max_final?: number
  rows_ms?: number
  db_pairs?: number
  db_contributors?: number
  db_iterations?: number
  db_converged?: boolean
  dirty_processed?: number
  dirty_remaining?: number
  dirty_oldest?: string | null
}

// rpc_stats.parity — shadow mode only: the served (JS) fit vs the in-DB fit.
// board_match=true (max_log_delta < 1e-6, no board-membership drift) across
// the soak is the gate for flipping BT_FIT_MODE to 'indb'.
type ParityStats = {
  max_log_delta?: number
  js_pairs?: number
  db_pairs?: number
  board_match?: boolean
  js_only?: number
  db_only?: number
}

type RpcStats = {
  fit?: FitStats
  parity?: ParityStats
  pairwise_wins?: { ms?: number; bytes?: number; retries?: number }
}

type LastRunRow = {
  created_at: string
  duration_ms: number
  iterations: number
  pairs: number
  updated: number
  converged: boolean
  rpc_stats: RpcStats | null
}

type DirtyQueueState = { depth: number; oldest: string | null }

function formatTimeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatMs(ms: number | undefined): string {
  if (ms === undefined) return '—'
  return `${ms}ms`
}

function formatDelta(n: number | undefined): string {
  if (n === undefined) return '—'
  return n.toExponential(1)
}

// Admin-only recompute trigger + last-run status + dirty-queue monitor.
// Moved out of the AdminPage sidebar into its own tab so the cron-log queries
// only fire when it is open.
export default function RankingsPanel() {
  const queryClient = useQueryClient()

  const lastRun = useQuery({
    queryKey: ['cron-execution-logs', 'last-success'],
    queryFn: async () => {
      // maybeSingle: zero runs (fresh install) is expected, not an error.
      const { data, error } = await supabase
        .from('cron_execution_logs')
        .select('created_at, duration_ms, iterations, pairs, updated, converged, rpc_stats')
        .eq('status', 'success')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw error
      return (data ?? null) as LastRunRow | null
    },
  })

  const lastError = useQuery({
    queryKey: ['cron-execution-logs', 'last-error'],
    queryFn: async () => {
      // maybeSingle: zero past errors is the happy path, not an error.
      const { data, error } = await supabase
        .from('cron_execution_logs')
        .select('created_at, error_message, duration_ms, trigger_source')
        .eq('status', 'error')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw error
      return data as {
        created_at: string
        error_message: string
        duration_ms: number
        trigger_source: string
      } | null
    },
  })

  // Last idle skip (pg_cron no-op: no user_rides change since last success).
  // Expected on quiet communities — proves the pipeline is alive, not stuck.
  const lastSkip = useQuery({
    queryKey: ['cron-execution-logs', 'last-skip'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cron_execution_logs')
        .select('created_at')
        .eq('status', 'skipped')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw error
      return data as { created_at: string } | null
    },
  })

  // Live dirty queue (admin RLS on pair_dirty_users): depth + oldest entry.
  // This is the per-run floor's counterpart — a queue that never drains to
  // zero between slots means ride changes are not reaching the board. The
  // table (and its RLS policy) only exists after the pair-maintenance
  // migration; a deploy skew degrades to "no data" instead of erroring.
  const dirtyQueue = useQuery({
    queryKey: ['pair-dirty-users', 'queue-state'],
    queryFn: async (): Promise<DirtyQueueState> => {
      const [countRes, oldestRes] = await Promise.all([
        supabase.from('pair_dirty_users').select('user_id', { count: 'exact', head: true }),
        supabase
          .from('pair_dirty_users')
          .select('marked_at')
          .order('marked_at', { ascending: true })
          .limit(1)
          .maybeSingle(),
      ])
      if (countRes.error) throw countRes.error
      if (oldestRes.error) throw oldestRes.error
      return { depth: countRes.count ?? 0, oldest: oldestRes.data?.marked_at ?? null }
    },
    // Degrade gracefully on pre-migration projects (42P01 undefined_table).
    retry: false,
  })

  const recompute = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke<RecomputeResponse>(
        'recompute-rankings',
        { method: 'POST' },
      )
      if (error) throw error
      return data!
    },
    onSuccess: () => {
      // Bypass the /api/ranking edge cache — the whole point of this button
      // is to see fresh scores immediately.
      void refreshBoardData(queryClient).catch(() => {})
      queryClient.invalidateQueries({ queryKey: ['cron-execution-logs'] })
      queryClient.invalidateQueries({ queryKey: ['pair-dirty-users'] })
    },
  })

  const run = lastRun.data
  const fit = run?.rpc_stats?.fit
  const parity = run?.rpc_stats?.parity

  return (
    <Panel bleed className="p-3 sm:p-6">
      <h2 className="text-lg font-semibold text-ink">Rankings</h2>
      <p className="mt-1 text-sm text-muted">
        Refits Bradley-Terry strengths from all ranked lists and upserts{' '}
        <code className="rounded bg-surface px-1 text-xs">coaster_ratings</code>.
      </p>
      <Button
        type="button"
        onClick={() => recompute.mutate()}
        disabled={recompute.isPending}
        className="mt-4"
      >
        <RefreshCw className={recompute.isPending ? 'animate-spin' : ''} size={16} />
        {recompute.isPending ? 'Recomputing…' : 'Recompute now'}
      </Button>

      {/* Last successful run */}
      {run && (
        <div className="mt-4 rounded-lg bg-surface p-3 text-sm">
          <div className="flex items-center gap-2 text-muted">
            <span className="inline-block h-2 w-2 rounded-full bg-success" />
            Last success: {formatTimeAgo(run.created_at)}
            {fit?.mode ? ` · fit mode: ${fit.mode}` : ''}
          </div>
          <div className="mt-1 text-ink">
            {`${run.iterations + 1} iteration${run.iterations + 1 === 1 ? '' : 's'}`} &middot;{' '}
            {formatDuration(run.duration_ms)}
            {run.converged ? '' : ' (hit cap)'}
          </div>
          <div className="text-ink">
            {run.pairs} pairs &rarr; {run.updated} coasters
          </div>
        </div>
      )}

      {/* Dirty queue + in-DB fit breakdown (post pair-maintenance pipeline) */}
      {fit && (
        <div className="mt-3 rounded-lg bg-surface p-3 text-sm">
          <div className="text-muted">
            <span className="font-medium text-ink">Dirty queue at run:</span>{' '}
            {fit.dirty_processed ?? 0} processed
            {(fit.dirty_remaining ?? 0) > 0
              ? `, ${fit.dirty_remaining} left (continues next slot)`
              : ' · drained'}
          </div>
          <div className="mt-1 text-muted">
            <span className="font-medium text-ink">In-DB fit:</span> maintain{' '}
            {formatMs(fit.maintain_ms)} ({fit.maintain_calls ?? 0}×{fit.maintain_batch_final ?? '—'}
            ), agg {formatMs(fit.agg_ms)}, iters {formatMs(fit.step_ms)} ({fit.step_calls ?? 0}{' '}
            calls)
          </div>
          <div className="text-muted">
            pair_totals {fit.db_pairs ?? 0} rows · {fit.db_contributors ?? 0} contributors ·{' '}
            {fit.db_iterations ?? 0} fit iterations{fit.db_converged ? '' : ' (hit cap)'}
          </div>
          {parity && (
            <div className={parity.board_match ? 'text-muted' : 'text-danger'}>
              <span className="font-medium text-ink">Shadow parity:</span> max |Δ log score|{' '}
              {formatDelta(parity.max_log_delta)}
              {parity.board_match ? ' (match)' : ' — BOARD MISMATCH'}
              {parity.js_pairs !== undefined && parity.db_pairs !== undefined && (
                <>
                  {' '}
                  · js {parity.js_pairs} vs db {parity.db_pairs} pairs
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Live dirty queue — per-run floor's steady state should be depth 0 */}
      {dirtyQueue.data && (dirtyQueue.data.depth > 0 || dirtyQueue.data.oldest) && (
        <div className="mt-3 rounded-lg bg-surface p-3 text-sm">
          <div className="flex items-center gap-2 text-muted">
            <span className="inline-block h-2 w-2 rounded-full bg-success" />
            Live dirty queue: {dirtyQueue.data.depth} user(s) waiting
          </div>
          {dirtyQueue.data.oldest && (
            <div className="text-muted">Oldest entry: {formatTimeAgo(dirtyQueue.data.oldest)}</div>
          )}
        </div>
      )}

      {lastRun.isLoading && <div className="mt-4 text-sm text-muted">Loading run history…</div>}

      {lastRun.isError && (
        <div className="mt-4 text-sm text-danger">Couldn&apos;t load run history.</div>
      )}

      {/* Last idle skip — quiet communities produce these, not failures */}
      {lastSkip.data && (
        <div className="mt-3 text-sm text-muted">
          Last idle skip: {formatTimeAgo(lastSkip.data.created_at)} (no ranking changes)
        </div>
      )}

      {/* Last error */}
      {lastError.data && (
        <div className="mt-3 rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm">
          <div className="flex items-center gap-2 text-danger">
            <span className="inline-block h-2 w-2 rounded-full bg-danger" />
            Last error: {formatTimeAgo(lastError.data.created_at)}
          </div>
          <div className="mt-1 text-ink">{lastError.data.error_message}</div>
          <div className="mt-0.5 text-xs text-muted">
            Trigger: {lastError.data.trigger_source} &middot; Failed after{' '}
            {formatDuration(lastError.data.duration_ms)}
          </div>
        </div>
      )}

      {lastError.isError && (
        <div className="mt-3 text-sm text-danger">Couldn&apos;t load error history.</div>
      )}

      {recompute.isError && (
        <p className="mt-3 text-sm text-danger">Recompute failed: {recompute.error.message}</p>
      )}
    </Panel>
  )
}
