import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import ConfirmEmailGate from '../components/ConfirmEmailGate'
import Toast from '../components/Toast'
import { Button, fieldClassName, MessageState, Panel, selectClassName } from '../components/ui'
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
  pending: 'bg-warning/15 text-warning-text',
  approved: 'bg-success/15 text-success-text',
  rejected: 'bg-danger/15 text-danger-text',
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
        <h1 className="display-heading text-4xl text-ink">Submit a Coaster</h1>
        <div className="mt-6">
          <ConfirmEmailGate email={user?.email} />
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="display-heading text-4xl text-ink">Submit a Coaster</h1>

      {atCap && (
        <p className="mb-4 rounded-xl border border-warning/25 bg-warning/5 p-3 text-sm text-warning-text">
          You have {pendingCount} pending submission{pendingCount === 1 ? '' : 's'} — the maximum.
          Wait for an admin to review them before submitting more.
        </p>
      )}

      <Panel className="mt-6 p-5 sm:p-6">
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid gap-6 md:grid-cols-2">
            <div className="flex flex-col gap-2">
              <label htmlFor="coaster_name" className="text-sm font-medium text-ink-soft">
                Coaster Name *
              </label>
              <input
                id="coaster_name"
                name="coaster_name"
                required
                maxLength={120}
                className={fieldClassName}
                placeholder="e.g. Steel Vengeance"
              />
            </div>

            <div className="flex flex-col gap-2 relative">
              <label htmlFor="park_name" className="text-sm font-medium text-ink-soft">
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
                className={fieldClassName}
                placeholder="Search for a park..."
              />

              {searchPark && !selectedPark && filteredParks.length > 0 && (
                <ul className="absolute top-full z-20 w-full overflow-hidden rounded-xl border border-line bg-surface-bright shadow-lift">
                  {filteredParks.map((p) => (
                    <li
                      key={p.id}
                      className="cursor-pointer p-2 text-sm hover:bg-canvas"
                      onClick={() => {
                        setSelectedPark(p)
                        setSearchPark(p.name)
                      }}
                    >
                      {p.name} <span className="text-xs text-muted">({p.country})</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="border-t border-line pt-6">
            <h3 className="mb-4 text-lg font-semibold text-ink">Suggested Stats (Optional)</h3>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="flex flex-col gap-2">
                <label htmlFor="height" className="text-sm font-medium text-ink-soft">
                  Height (m)
                </label>
                <input
                  id="height"
                  name="height"
                  type="number"
                  min="0"
                  step="0.1"
                  className={fieldClassName}
                />
              </div>
              <div className="flex flex-col gap-2">
                <label htmlFor="speed" className="text-sm font-medium text-ink-soft">
                  Speed (km/h)
                </label>
                <input
                  id="speed"
                  name="speed"
                  type="number"
                  min="0"
                  step="0.1"
                  className={fieldClassName}
                />
              </div>
              <div className="flex flex-col gap-2">
                <label htmlFor="length" className="text-sm font-medium text-ink-soft">
                  Length (m)
                </label>
                <input
                  id="length"
                  name="length"
                  type="number"
                  min="0"
                  step="0.1"
                  className={fieldClassName}
                />
              </div>
              <div className="flex flex-col gap-2">
                <label htmlFor="inversions" className="text-sm font-medium text-ink-soft">
                  Inversions
                </label>
                <input
                  id="inversions"
                  name="inversions"
                  type="number"
                  min="0"
                  className={fieldClassName}
                />
              </div>
              <div className="flex flex-col gap-2 md:col-span-2">
                <label htmlFor="material" className="text-sm font-medium text-ink-soft">
                  Material
                </label>
                <select id="material" name="material" className={selectClassName}>
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
            <Button type="submit" disabled={mutation.isPending || atCap} variant="coral">
              {mutation.isPending ? 'Submitting...' : 'Submit for Review'}
            </Button>
          </div>
        </form>
      </Panel>

      <section className="mt-10 border-t border-line pt-6">
        <h2 className="mb-3 text-lg font-semibold text-ink">Your submissions</h2>
        {submissionsPending ? (
          <MessageState>Loading your submissions…</MessageState>
        ) : submissionsError ? (
          <MessageState tone="danger">Couldn&apos;t load your submissions.</MessageState>
        ) : mySubmissions.length === 0 ? (
          <p className="text-sm text-muted">
            You haven&apos;t submitted any coasters yet. Use the form above to propose one that
            isn&apos;t in the catalog.
          </p>
        ) : (
          <ul className="space-y-2">
            {mySubmissions.map((s) => (
              <li
                key={s.id}
                className="flex items-start justify-between gap-3 rounded-xl border border-line bg-surface-bright p-3 shadow-panel"
              >
                <div>
                  <p className="text-sm font-medium text-ink">{s.coaster_name}</p>
                  <p className="text-xs text-muted">{s.park_name}</p>
                  {s.status === 'rejected' && s.reviewer_note && (
                    <p className="mt-1 text-xs text-danger">Reviewer: {s.reviewer_note}</p>
                  )}
                </div>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium capitalize ${STATUS_STYLES[s.status]}`}
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
