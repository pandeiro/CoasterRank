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

// Admin-only recompute trigger + last-run status. Moved out of the AdminPage
// sidebar into its own tab so the cron-log queries only fire when it is open.
export default function RankingsPanel() {
  const queryClient = useQueryClient()

  const lastRun = useQuery({
    queryKey: ['cron-execution-logs', 'last-success'],
    queryFn: async () => {
      // maybeSingle: zero runs (fresh install) is expected, not an error.
      const { data, error } = await supabase
        .from('cron_execution_logs')
        .select('created_at, duration_ms, iterations, pairs, updated, converged')
        .eq('status', 'success')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw error
      return data as {
        created_at: string
        duration_ms: number
        iterations: number
        pairs: number
        updated: number
        converged: boolean
      } | null
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
    },
  })

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
      {lastRun.data && (
        <div className="mt-4 rounded-lg bg-surface p-3 text-sm">
          <div className="flex items-center gap-2 text-muted">
            <span className="inline-block h-2 w-2 rounded-full bg-success" />
            Last success: {formatTimeAgo(lastRun.data.created_at)}
          </div>
          <div className="mt-1 text-ink">
            {`${lastRun.data.iterations + 1} iteration${lastRun.data.iterations + 1 === 1 ? '' : 's'}`}{' '}
            &middot; {formatDuration(lastRun.data.duration_ms)}
            {lastRun.data.converged ? '' : ' (hit cap)'}
          </div>
          <div className="text-ink">
            {lastRun.data.pairs} pairs &rarr; {lastRun.data.updated} coasters
          </div>
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
