import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, Check, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { getPendingSubmissions, rejectSubmission, approveSubmission, type CoasterSubmission } from '../lib/coasters'

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
  const [rejectNote, setRejectNote] = useState('')
  const [activeRejectId, setActiveRejectId] = useState<string | null>(null)

  const { data: submissions = [], isLoading: submissionsLoading } = useQuery({
    queryKey: ['submissions'],
    queryFn: getPendingSubmissions,
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

  const approve = useMutation({
    mutationFn: async ({ id, submission }: { id: string; submission: CoasterSubmission }) => {
      await approveSubmission(id, submission)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['submissions'] })
      queryClient.invalidateQueries({ queryKey: ['rankings'] })
    },
  })

  const reject = useMutation({
    mutationFn: async ({ id, note }: { id: string; note: string }) => {
      await rejectSubmission(id, note)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['submissions'] })
      setActiveRejectId(null)
      setRejectNote('')
    },
  })

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-semibold text-slate-900">Admin</h1>
      
      <div className="mt-6 grid gap-6 md:grid-cols-3">
        <div className="md:col-span-2 space-y-6">
          <section className="rounded border border-slate-200 bg-white p-6">
            <h2 className="font-medium text-slate-900 mb-4">Submission Queue</h2>
            {submissionsLoading ? (
              <p className="text-sm text-slate-500">Loading submissions...</p>
            ) : submissions.length === 0 ? (
              <p className="text-sm text-slate-500">No pending submissions.</p>
            ) : (
              <div className="space-y-4">
                {submissions.map((s) => (
                  <div key={s.id} className="rounded border border-slate-100 p-4 bg-slate-50">
                    <div className="flex justify-between items-start">
                      <div>
                        <h3 className="font-semibold">{s.coaster_name}</h3>
                        <p className="text-sm text-slate-600">{s.park_name}</p>
                        <div className="mt-2 text-xs font-mono bg-white p-2 rounded border border-slate-200 overflow-auto max-h-24">
                          <pre>{JSON.stringify(s.suggested_fields, null, 2)}</pre>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => approve.mutate({ id: s.id, submission: s })}
                          disabled={approve.isPending}
                          className="p-2 rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
                          title="Approve"
                        >
                          <Check size={16} />
                        </button>
                        <button
                          onClick={() => setActiveRejectId(s.id)}
                          disabled={reject.isPending}
                          className="p-2 rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                          title="Reject"
                        >
                          <X size={16} />
                        </button>
                      </div>
                    </div>
                    {activeRejectId === s.id && (
                      <div className="mt-4 flex gap-2">
                        <input
                          className="flex-1 rounded border p-1 text-sm"
                          placeholder="Reason for rejection..."
                          value={rejectNote}
                          onChange={(e) => setRejectNote(e.target.value)}
                        />
                        <button
                          onClick={() => reject.mutate({ id: s.id, note: rejectNote })}
                          disabled={!rejectNote}
                          className="rounded bg-red-900 px-3 py-1 text-xs text-white hover:bg-red-800 disabled:opacity-50"
                        >
                          Confirm Reject
                        </button>
                        <button
                          onClick={() => setActiveRejectId(null)}
                          className="rounded bg-slate-200 px-3 py-1 text-xs hover:bg-slate-300"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="space-y-6">
          <div className="rounded border border-slate-200 bg-white p-6">
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
      </div>
    </div>
  )
}
