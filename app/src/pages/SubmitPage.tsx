import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import ConfirmEmailGate from '../components/ConfirmEmailGate'
import Toast from '../components/Toast'
import { useAuth } from '../lib/auth-context'
import {
  getMySubmissions,
  SUBMISSION_PENDING_CAP,
  submitCoaster,
  useParks,
  type CoasterSubmission,
  type Park,
  type SuggestedFields,
} from '../lib/coasters'

const STATUS_STYLES: Record<CoasterSubmission['status'], string> = {
  pending: 'bg-amber-100 text-amber-800',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
}

export default function SubmitPage() {
  const { user, isConfirmed } = useAuth()
  const queryClient = useQueryClient()
  const { data: parks = [] } = useParks()

  const [searchPark, setSearchPark] = useState('')
  const [selectedPark, setSelectedPark] = useState<Park | null>(null)
  const [toast, setToast] = useState<{ message: string; tone: 'info' | 'error' } | null>(null)

  const {
    data: mySubmissions = [],
    isPending: submissionsPending,
    isError: submissionsError,
  } = useQuery({
    queryKey: ['my-submissions', user?.id],
    enabled: Boolean(user) && isConfirmed,
    queryFn: getMySubmissions,
  })

  const pendingCount = useMemo(
    () => mySubmissions.filter((s) => s.status === 'pending').length,
    [mySubmissions],
  )
  const atCap = pendingCount >= SUBMISSION_PENDING_CAP

  const filteredParks = parks
    .filter((p) => p.name.toLowerCase().includes(searchPark.toLowerCase()))
    .slice(0, 5)

  const mutation = useMutation({
    mutationFn: submitCoaster,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-submissions', user?.id] })
      setToast({ message: 'Submission received — an admin will review it.', tone: 'info' })
    },
    onError: (error) => {
      setToast({
        message: error instanceof Error ? error.message : 'Failed to submit coaster',
        tone: 'error',
      })
    },
  })

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (atCap) return
    const form = e.currentTarget
    const formData = new FormData(form)

    const suggested_fields: SuggestedFields = {
      height_m: formData.get('height') ? Number(formData.get('height')) : null,
      speed_kmh: formData.get('speed') ? Number(formData.get('speed')) : null,
      length_m: formData.get('length') ? Number(formData.get('length')) : null,
      inversions: formData.get('inversions') ? Number(formData.get('inversions')) : null,
      material: (formData.get('material') as SuggestedFields['material']) || null,
    }

    mutation.mutate(
      {
        coaster_name: (formData.get('coaster_name') as string).trim(),
        park_name: selectedPark ? selectedPark.name : (formData.get('park_name') as string).trim(),
        park_id: selectedPark?.id ?? null,
        suggested_fields,
      },
      {
        onSuccess: () => {
          form.reset()
          setSearchPark('')
          setSelectedPark(null)
        },
      },
    )
  }

  if (!isConfirmed) {
    return (
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Submit a Coaster</h1>
        <div className="mt-6">
          <ConfirmEmailGate email={user?.email} />
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl py-8 px-4">
      <h1 className="text-3xl font-bold mb-6">Submit a Coaster</h1>

      {atCap && (
        <p className="mb-4 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          You have {pendingCount} pending submission{pendingCount === 1 ? '' : 's'} — the maximum.
          Wait for an admin to review them before submitting more.
        </p>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid gap-6 md:grid-cols-2">
          <div className="flex flex-col gap-2">
            <label htmlFor="coaster_name" className="text-sm font-medium">
              Coaster Name *
            </label>
            <input
              id="coaster_name"
              name="coaster_name"
              required
              maxLength={120}
              className="rounded border p-2"
              placeholder="e.g. Steel Vengeance"
            />
          </div>

          <div className="flex flex-col gap-2 relative">
            <label htmlFor="park_name" className="text-sm font-medium">
              Park Name *
            </label>
            <input
              id="park_name"
              name="park_name"
              required
              maxLength={120}
              value={selectedPark ? selectedPark.name : searchPark}
              onChange={(e) => {
                setSearchPark(e.target.value)
                setSelectedPark(null)
              }}
              className="rounded border p-2"
              placeholder="Search for a park..."
            />

            {searchPark && !selectedPark && filteredParks.length > 0 && (
              <ul className="absolute z-10 w-full rounded border bg-white shadow-lg top-full">
                {filteredParks.map((p) => (
                  <li
                    key={p.id}
                    className="cursor-pointer p-2 hover:bg-gray-100"
                    onClick={() => {
                      setSelectedPark(p)
                      setSearchPark(p.name)
                    }}
                  >
                    {p.name} <span className="text-xs text-gray-500">({p.country})</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="border-t pt-6">
          <h3 className="text-lg font-medium mb-4">Suggested Stats (Optional)</h3>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-2">
              <label htmlFor="height" className="text-sm font-medium">
                Height (m)
              </label>
              <input
                id="height"
                name="height"
                type="number"
                min="0"
                step="0.1"
                className="rounded border p-2"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label htmlFor="speed" className="text-sm font-medium">
                Speed (km/h)
              </label>
              <input
                id="speed"
                name="speed"
                type="number"
                min="0"
                step="0.1"
                className="rounded border p-2"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label htmlFor="length" className="text-sm font-medium">
                Length (m)
              </label>
              <input
                id="length"
                name="length"
                type="number"
                min="0"
                step="0.1"
                className="rounded border p-2"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label htmlFor="inversions" className="text-sm font-medium">
                Inversions
              </label>
              <input
                id="inversions"
                name="inversions"
                type="number"
                min="0"
                className="rounded border p-2"
              />
            </div>
            <div className="flex flex-col gap-2 md:col-span-2">
              <label htmlFor="material" className="text-sm font-medium">
                Material
              </label>
              <select id="material" name="material" className="rounded border p-2">
                <option value="">Select material...</option>
                <option value="steel">Steel</option>
                <option value="wood">Wood</option>
                <option value="hybrid">Hybrid</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={mutation.isPending || atCap}
            className="rounded bg-blue-600 px-6 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {mutation.isPending ? 'Submitting...' : 'Submit for Review'}
          </button>
        </div>
      </form>

      <section className="mt-10 border-t pt-6">
        <h2 className="text-lg font-medium mb-3">Your submissions</h2>
        {submissionsPending ? (
          <p className="text-sm text-slate-500">Loading your submissions…</p>
        ) : submissionsError ? (
          <p className="text-sm text-red-600">Couldn&apos;t load your submissions.</p>
        ) : mySubmissions.length === 0 ? (
          <p className="text-sm text-slate-500">
            You haven&apos;t submitted any coasters yet. Use the form above to propose one that
            isn&apos;t in the catalog.
          </p>
        ) : (
          <ul className="space-y-2">
            {mySubmissions.map((s) => (
              <li
                key={s.id}
                className="flex items-start justify-between gap-3 rounded border border-slate-200 bg-white p-3"
              >
                <div>
                  <p className="text-sm font-medium text-slate-900">{s.coaster_name}</p>
                  <p className="text-xs text-slate-500">{s.park_name}</p>
                  {s.status === 'rejected' && s.reviewer_note && (
                    <p className="mt-1 text-xs text-red-700">Reviewer: {s.reviewer_note}</p>
                  )}
                </div>
                <span
                  className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLES[s.status]}`}
                >
                  {s.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {toast && (
        <Toast message={toast.message} tone={toast.tone} onDismiss={() => setToast(null)} />
      )}
    </div>
  )
}
