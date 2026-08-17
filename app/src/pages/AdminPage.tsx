import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { supabase } from '../lib/supabase'

type RecomputeResponse = {
  updated: number
  durationMs: number
  iterations: number
  converged: boolean
}

/**
 * Admin dashboard (PLAN §6). Phase 6 ships the recompute trigger; the
 * moderation queue and coaster CRUD arrive in Phase 7.
 *
 * supabase.functions.invoke attaches the caller's session JWT; the Edge
 * Function validates it against GoTrue and checks profiles.is_admin
 * server-side — no secret ships with the browser bundle.
 */
export default function AdminPage() {
  const queryClient = useQueryClient()
  const [message, setMessage] = useState<string | null>(null)

  const recompute = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke<RecomputeResponse>(
        'recompute-rankings',
        { method: 'POST' },
      )
      if (error) throw error
      return data!
    },
    onSuccess: (result) => {
      setMessage(
        `Updated ${result.updated} coaster ratings in ${result.durationMs} ms ` +
          `(${result.iterations} iterations, ${result.converged ? 'converged' : 'hit iteration cap'}).`,
      )
      queryClient.invalidateQueries({ queryKey: ['rankings'] })
    },
    onError: (error) => {
      setMessage(`Recompute failed: ${error.message}`)
    },
  })

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-semibold text-slate-900">Admin</h1>
      <p className="mt-1 text-sm text-slate-600">
        Rankings recompute automatically every 15 minutes; trigger a run now if you need fresher
        scores.
      </p>
      <div className="mt-6 rounded border border-slate-200 bg-white p-6">
        <h2 className="font-medium text-slate-900">Rankings</h2>
        <p className="mt-1 text-sm text-slate-600">
          Refits Bradley-Terry strengths from all ranked lists and upserts{' '}
          <code className="rounded bg-slate-100 px-1 text-xs">coaster_ratings</code>.
        </p>
        <button
          type="button"
          onClick={() => {
            setMessage(null)
            recompute.mutate()
          }}
          disabled={recompute.isPending}
          className="mt-4 inline-flex items-center gap-2 rounded bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-700 disabled:opacity-50"
        >
          <RefreshCw className={recompute.isPending ? 'animate-spin' : ''} size={16} />
          {recompute.isPending ? 'Recomputing…' : 'Recompute now'}
        </button>
        {message && (
          <p className={`mt-4 text-sm ${recompute.isError ? 'text-red-600' : 'text-green-700'}`}>
            {message}
          </p>
        )}
      </div>
    </div>
  )
}
