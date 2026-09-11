import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import ConfirmEmailGate from '../components/ConfirmEmailGate'
import ManufacturerMultiPicker from '../components/ManufacturerMultiPicker'
import Toast from '../components/Toast'
import { Button, fieldClassName, MessageState, Panel, selectClassName } from '../components/ui'
import { useAuth } from '../lib/auth-context'
import {
  capitalize,
  COASTER_STATUSES,
  getMySubmissions,
  markMySubmissionsSeen,
  serializeManufacturerPicks,
  SUBMISSION_PENDING_CAP,
  submitCoaster,
  useManufacturers,
  useParks,
  type CoasterSubmission,
  type ManufacturerPick,
  type Park,
  type SuggestedFields,
} from '../lib/coasters'
import {
  parseOptionalNumber,
  serializeParkLocation,
  validateNewSubmission,
  validationSummary,
  type ParkLocationInput,
  type SubmissionValidationErrors,
} from '../lib/submission-validation'

const STATUS_STYLES: Record<CoasterSubmission['status'], string> = {
  pending: 'bg-warning/15 text-warning-text',
  approved: 'bg-success/15 text-success-text',
  rejected: 'bg-danger/15 text-danger-text',
}

export default function SubmitPage() {
  const { user, isConfirmed } = useAuth()
  const queryClient = useQueryClient()
  const { data: parks = [] } = useParks()
  const { data: manufacturers = [] } = useManufacturers()
  const [searchParams] = useSearchParams()
  const location = useLocation()

  const [searchPark, setSearchPark] = useState('')
  const [selectedPark, setSelectedPark] = useState<Park | null>(null)
  // Schema validation errors from the last submit attempt (cleared on the
  // next attempt / success). Keys match input names / suggested_fields keys.
  const [fieldErrors, setFieldErrors] = useState<SubmissionValidationErrors>({})
  // Manufacturer lineage (multi): ordered list, index 0 = primary. Entries
  // with id null are PROPOSED manufacturers (not yet in the catalog).
  const [selectedLineage, setSelectedLineage] = useState<ManufacturerPick[]>([])
  const [toast, setToast] = useState<{ message: string; tone: 'info' | 'error' } | null>(() => {
    const justSuggested = (location.state as { justSuggested?: string } | null)?.justSuggested
    return justSuggested
      ? { message: `Suggestion sent for ${justSuggested} — track its review below.`, tone: 'info' }
      : null
  })

  // Deep link from the /me search empty state ("Suggest X") pre-fills the name.
  const suggestedName = searchParams.get('name') ?? ''

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

  // Once the submitter has seen their reviewed outcomes, mark them so the
  // "new result" badge clears. Failures reset the guard for a later retry.
  const seenMarked = useRef(false)
  useEffect(() => {
    if (!user || !isConfirmed || mySubmissions.length === 0 || seenMarked.current) return
    if (!mySubmissions.some((s) => s.reviewed_at && !s.seen_by_submitter_at)) return
    seenMarked.current = true
    markMySubmissionsSeen()
      .then(() => queryClient.invalidateQueries({ queryKey: ['my-submissions', user.id] }))
      .catch(() => {
        seenMarked.current = false
      })
  }, [user, isConfirmed, mySubmissions, queryClient])

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
    const text = (key: string): string => {
      const raw = formData.get(key)
      return typeof raw === 'string' ? raw : ''
    }

    const suggested_fields: SuggestedFields = {
      height_m: parseOptionalNumber(text('height')),
      speed_kmh: parseOptionalNumber(text('speed')),
      length_m: parseOptionalNumber(text('length')),
      inversions: parseOptionalNumber(text('inversions')),
      material: (formData.get('material') as SuggestedFields['material']) || null,
      ...serializeManufacturerPicks(selectedLineage),
      status: (formData.get('status') as SuggestedFields['status']) || null,
      model: text('model').trim() || null,
      type: text('type').trim() || null,
      opening_date: text('opening_date') || null,
    }
    const coaster_name = text('coaster_name').trim()
    const park_name = selectedPark ? selectedPark.name : text('park_name').trim()
    const park_id = selectedPark?.id ?? null
    // Location metadata only applies to a park that does not exist yet; the
    // key is always present (null = absent) for a uniform payload shape.
    const parkLocation: ParkLocationInput = {
      city: text('park_city'),
      region: text('park_region'),
      country: text('park_country'),
      lat: text('park_lat'),
      lng: text('park_lng'),
    }
    suggested_fields.park_location = park_id ? null : serializeParkLocation(parkLocation)
    const note = text('note').trim() || null

    // Schema gate: invalid data never leaves the form, so it can never
    // become a pending row the admin queue cannot accept.
    const errors = validateNewSubmission({
      coaster_name,
      park_name,
      park_id,
      suggested_fields: suggested_fields as unknown as Record<string, unknown>,
      note,
    })
    const summary = validationSummary(errors)
    if (summary) {
      setFieldErrors(errors)
      setToast({ message: summary, tone: 'error' })
      return
    }
    setFieldErrors({})

    mutation.mutate(
      {
        coaster_name,
        park_name,
        park_id,
        suggested_fields,
        note,
      },
      {
        onSuccess: () => {
          form.reset()
          setSearchPark('')
          setSelectedPark(null)
          setSelectedLineage([])
        },
      },
    )
  }

  const fieldError = (key: string) =>
    fieldErrors[key] ? <p className="text-xs text-danger">{fieldErrors[key]}</p> : null

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
                defaultValue={suggestedName}
                className={fieldClassName}
                placeholder="e.g. Steel Vengeance"
              />
              {fieldError('coaster_name')}
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
              {fieldError('park_name')}

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

          {!selectedPark && searchPark.trim() && (
            <div className="rounded-xl border border-line bg-surface-bright p-4">
              <p className="text-sm font-medium text-ink">
                New park: <span className="font-semibold">{searchPark.trim()}</span>
              </p>
              <p className="mt-1 text-xs text-muted">
                Not in the catalog — it will be created if your submission is approved. Location
                helps reviewers place it (all fields optional).
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                {(
                  [
                    ['park_city', 'City'],
                    ['park_region', 'Region / state'],
                    ['park_country', 'Country'],
                  ] as const
                ).map(([key, label]) => (
                  <div key={key} className="flex flex-col gap-1">
                    <label htmlFor={key} className="text-xs font-medium text-ink-soft">
                      {label}
                    </label>
                    <input id={key} name={key} maxLength={120} className={fieldClassName} />
                    {fieldError(`park_location.${key.replace('park_', '')}`)}
                  </div>
                ))}
                {(
                  [
                    ['park_lat', 'Latitude', -90, 90],
                    ['park_lng', 'Longitude', -180, 180],
                  ] as const
                ).map(([key, label, min, max]) => (
                  <div key={key} className="flex flex-col gap-1">
                    <label htmlFor={key} className="text-xs font-medium text-ink-soft">
                      {label}
                    </label>
                    <input
                      id={key}
                      name={key}
                      type="number"
                      step="any"
                      min={min}
                      max={max}
                      className={fieldClassName}
                    />
                    {fieldError(`park_location.${key.replace('park_', '')}`)}
                  </div>
                ))}
              </div>
            </div>
          )}

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
                  step="any"
                  className={fieldClassName}
                />
                {fieldError('height_m')}
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
                  step="any"
                  className={fieldClassName}
                />
                {fieldError('speed_kmh')}
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
                  step="any"
                  className={fieldClassName}
                />
                {fieldError('length_m')}
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
                {fieldError('inversions')}
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
                {fieldError('material')}
              </div>
            </div>
          </div>

          <div className="border-t border-line pt-6">
            <h3 className="mb-4 text-lg font-semibold text-ink">Details (Optional)</h3>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="flex flex-col gap-2">
                <label htmlFor="manufacturer" className="text-sm font-medium text-ink-soft">
                  Manufacturers
                </label>
                <ManufacturerMultiPicker
                  id="manufacturer"
                  manufacturers={manufacturers}
                  selected={selectedLineage}
                  onChange={setSelectedLineage}
                  placeholder="Search for a manufacturer..."
                />
                {fieldError('manufacturer_ids')}
                {fieldError('proposed_manufacturers')}
              </div>
              <div className="flex flex-col gap-2">
                <label htmlFor="status" className="text-sm font-medium text-ink-soft">
                  Status
                </label>
                <select id="status" name="status" className={selectClassName}>
                  <option value="">Select status...</option>
                  {COASTER_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {capitalize(s)}
                    </option>
                  ))}
                </select>
                {fieldError('status')}
              </div>
              <div className="flex flex-col gap-2">
                <label htmlFor="model" className="text-sm font-medium text-ink-soft">
                  Model
                </label>
                <input
                  id="model"
                  name="model"
                  maxLength={120}
                  className={fieldClassName}
                  placeholder="e.g. RMC IBox Track"
                />
                {fieldError('model')}
              </div>
              <div className="flex flex-col gap-2">
                <label htmlFor="type" className="text-sm font-medium text-ink-soft">
                  Type
                </label>
                <input
                  id="type"
                  name="type"
                  maxLength={120}
                  className={fieldClassName}
                  placeholder="e.g. Hypercoaster"
                />
                {fieldError('type')}
              </div>
              <div className="flex flex-col gap-2">
                <label htmlFor="opening_date" className="text-sm font-medium text-ink-soft">
                  Opening Date
                </label>
                <input
                  id="opening_date"
                  name="opening_date"
                  type="date"
                  className={fieldClassName}
                />
                {fieldError('opening_date')}
              </div>
            </div>
          </div>

          <div className="border-t border-line pt-6">
            <div className="flex flex-col gap-2">
              <label htmlFor="note" className="text-sm font-medium text-ink-soft">
                Note (optional)
              </label>
              <textarea
                id="note"
                name="note"
                rows={3}
                maxLength={2000}
                className={fieldClassName}
                placeholder="Anything that helps the reviewer…"
              />
              {fieldError('note')}
              <p className="text-xs text-muted">
                Extra context for the reviewer — additional explanation, corrections, or evidence
                links (RCDB, park site), etc.
              </p>
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
                  <p className="text-sm font-medium text-ink">
                    {s.coaster_name}{' '}
                    <span className="font-normal text-muted">
                      · {s.kind === 'edit' ? 'Edit suggestion' : 'New coaster'}
                    </span>
                    {s.reviewed_at && !s.seen_by_submitter_at && (
                      <span className="ml-2 rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-white">
                        New result
                      </span>
                    )}
                  </p>
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
