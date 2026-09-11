import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import ConfirmEmailGate from '../components/ConfirmEmailGate'
import ManufacturerMultiPicker from '../components/ManufacturerMultiPicker'
import Toast from '../components/Toast'
import { Button, fieldClassName, MessageState, Panel, selectClassName } from '../components/ui'
import { useAuth } from '../lib/auth-context'
import {
  COASTER_MATERIALS,
  COASTER_STATUSES,
  capitalize,
  diffEditProposal,
  getMySubmissions,
  lineageIds,
  lineageNames,
  SUBMISSION_PENDING_CAP,
  submitEditSuggestion,
  useCoaster,
  useManufacturers,
  useParks,
  type EditProposalInput,
  type ManufacturerPick,
  type Park,
} from '../lib/coasters'
import {
  validateEditSubmission,
  validationSummary,
  type ParkLocationInput,
  type SubmissionValidationErrors,
} from '../lib/submission-validation'

function str(value: number | string | null | undefined): string {
  return value === null || value === undefined ? '' : String(value)
}

export default function SuggestEditPage() {
  const { slug } = useParams()
  const navigate = useNavigate()
  const { user, isConfirmed } = useAuth()
  const queryClient = useQueryClient()
  const { data: coaster, isPending, isError } = useCoaster(slug)
  const { data: parks = [] } = useParks()
  const { data: manufacturers = [] } = useManufacturers()
  const [toast, setToast] = useState<{ message: string; tone: 'info' | 'error' } | null>(null)

  // Park picker (same typeahead pattern as /submit), seeded to the current
  // park. Free text with no selection proposes a NEW park.
  const [searchPark, setSearchPark] = useState('')
  const [selectedPark, setSelectedPark] = useState<Park | null>(null)
  const [parkTouched, setParkTouched] = useState(false)
  // Optional location metadata for a NEW-park proposal (park does not exist).
  const [parkLocationDraft, setParkLocationDraft] = useState<ParkLocationInput>({})

  // Manufacturer picker (multi) — seeded to the current lineage; the picker
  // state is the FULL proposed list (order matters: first = primary). Entries
  // with id null are proposed new manufacturers.
  const [lineageDraft, setLineageDraft] = useState<ManufacturerPick[] | null>(null)

  // Free-text context for the reviewer (explanations, evidence links, …).
  const [note, setNote] = useState('')
  // Schema validation errors from the last submit attempt.
  const [fieldErrors, setFieldErrors] = useState<SubmissionValidationErrors>({})

  const { data: mySubmissions = [] } = useQuery({
    queryKey: ['my-submissions', user?.id],
    enabled: Boolean(user) && isConfirmed,
    queryFn: getMySubmissions,
  })
  const pendingCount = useMemo(
    () => mySubmissions.filter((s) => s.status === 'pending').length,
    [mySubmissions],
  )
  const atCap = pendingCount >= SUBMISSION_PENDING_CAP

  const currentPark: Park | null = useMemo(() => {
    if (!coaster) return null
    return parks.find((p) => p.id === coaster.park_id) ?? null
  }, [coaster, parks])
  // The park the edit proposes: an existing row (selectedPark), a NEW-park
  // proposal (free text, id null), or the current park when untouched.
  const proposedParkName = parkTouched && !selectedPark ? searchPark.trim() : ''
  const isNewParkProposal = proposedParkName.length > 0
  const effectivePark = parkTouched ? selectedPark : (selectedPark ?? currentPark)
  const effectiveParkId: string | null = selectedPark
    ? selectedPark.id
    : isNewParkProposal
      ? null
      : (currentPark?.id ?? coaster?.park_id ?? null)

  // Current lineage resolved to display rows; the draft (once touched) wins.
  const seededLineage: ManufacturerPick[] = useMemo(() => {
    if (!coaster) return []
    const byId = new Map(manufacturers.map((m) => [m.id, m]))
    return lineageIds(coaster).flatMap((id) => {
      const m = byId.get(id)
      return m ? [{ id: m.id, name: m.name }] : []
    })
  }, [coaster, manufacturers])
  const effectiveLineage = lineageDraft ?? seededLineage

  const filteredParks = parks
    .filter((p) => p.name.toLowerCase().includes(searchPark.toLowerCase()))
    .slice(0, 5)

  const mutation = useMutation({
    mutationFn: submitEditSuggestion,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-submissions', user?.id] })
      navigate('/submit', { state: { justSuggested: coaster?.name } })
    },
    onError: (error) => {
      setToast({
        message: error instanceof Error ? error.message : 'Failed to submit suggestion',
        tone: 'error',
      })
    },
  })

  const initial = useMemo<EditProposalInput | null>(() => {
    if (!coaster) return null
    return {
      name: coaster.name,
      park_id: coaster.park_id,
      status: coaster.status,
      material: coaster.material,
      height_m: str(coaster.height_m),
      speed_kmh: str(coaster.speed_kmh),
      length_m: str(coaster.length_m),
      inversions: str(coaster.inversions),
      manufacturerPicks: seededLineage.map((m) => ({ id: m.id, name: m.name })),
      parkLocation: {},
      model: coaster.model ?? '',
      type: coaster.type ?? '',
      opening_date: coaster.opening_date ?? '',
    }
    // seededLineage is derived from coaster+manufacturers; both are deps.
  }, [coaster, seededLineage])

  // Live change count so the submitter sees exactly what will be proposed.
  const [draft, setDraft] = useState<Partial<EditProposalInput>>({})
  const merged: EditProposalInput | null = useMemo(
    () =>
      initial
        ? {
            ...initial,
            ...draft,
            park_id: effectiveParkId,
            manufacturerPicks: effectiveLineage,
            parkLocation: parkLocationDraft,
          }
        : null,
    [initial, draft, effectiveParkId, effectiveLineage, parkLocationDraft],
  )
  const { diff, parkChanged } = useMemo(
    () =>
      coaster && merged ? diffEditProposal(coaster, merged) : { diff: {}, parkChanged: false },
    [coaster, merged],
  )
  const changeCount = Object.keys(diff).length + (parkChanged ? 1 : 0)

  const set =
    (key: keyof EditProposalInput) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setDraft((d) => ({ ...d, [key]: e.target.value }))

  if (!isConfirmed) {
    return (
      <div>
        <h1 className="display-heading text-4xl text-ink">Suggest an Edit</h1>
        <div className="mt-6">
          <ConfirmEmailGate email={user?.email} />
        </div>
      </div>
    )
  }

  if (isPending) return <MessageState>Loading…</MessageState>
  if (isError || !coaster || !initial || !merged) {
    return <MessageState tone="danger">Couldn&apos;t load that coaster.</MessageState>
  }

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (atCap || changeCount === 0) return
    // Schema gate: invalid values never leave the form, so they can never
    // become a pending row the admin queue cannot accept.
    const errors = validateEditSubmission({
      coaster_id: coaster.id,
      park_id: effectiveParkId,
      suggested_fields: diff as unknown as Record<string, unknown>,
      note: note.trim() || null,
    })
    const summary = validationSummary(errors)
    if (summary) {
      setFieldErrors(errors)
      setToast({ message: summary, tone: 'error' })
      return
    }
    setFieldErrors({})
    mutation.mutate({
      coaster_id: coaster.id,
      coaster_name: coaster.name,
      park_name: effectivePark?.name ?? proposedParkName,
      park_id: effectiveParkId,
      suggested_fields: diff,
      note: note.trim() || null,
    })
  }

  const fieldError = (key: string) =>
    fieldErrors[key] ? <p className="text-xs text-danger">{fieldErrors[key]}</p> : null

  const currentLine = (label: string, value: string) => (
    <p className="mt-1 text-xs text-muted">
      Current: {value || '—'} {label}
    </p>
  )

  return (
    <div className="mx-auto max-w-3xl">
      <p className="text-sm font-semibold uppercase tracking-[0.14em] text-accent-strong">
        Suggest an edit
      </p>
      <h1 className="display-heading mt-1 text-4xl text-ink">{coaster.name}</h1>
      <p className="mt-2 text-sm text-muted">
        Only fill in what&apos;s wrong — your suggestion goes to a moderator, and only the fields
        you change are proposed. Nothing updates until an admin approves it.
      </p>

      {atCap && (
        <p className="mb-4 mt-6 rounded-xl border border-warning/25 bg-warning/5 p-3 text-sm text-warning">
          You have {pendingCount} pending submission{pendingCount === 1 ? '' : 's'} — the maximum.
          Wait for an admin to review them before suggesting more.
        </p>
      )}

      <Panel className="mt-6 p-5 sm:p-6">
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid gap-6 md:grid-cols-2">
            <div className="flex flex-col gap-2">
              <label htmlFor="edit-name" className="text-sm font-medium text-ink-soft">
                Coaster Name
              </label>
              <input
                id="edit-name"
                value={merged.name}
                onChange={set('name')}
                maxLength={120}
                className={fieldClassName}
              />
              {fieldError('name')}
            </div>

            <div className="flex flex-col gap-2 relative">
              <label htmlFor="edit-park" className="text-sm font-medium text-ink-soft">
                Park
              </label>
              <input
                id="edit-park"
                value={parkTouched ? searchPark : (effectivePark?.name ?? '')}
                onChange={(e) => {
                  setSearchPark(e.target.value)
                  setSelectedPark(null)
                  setParkTouched(true)
                }}
                className={fieldClassName}
                placeholder="Search for a park..."
                autoComplete="off"
              />
              {parkTouched && searchPark && !selectedPark && filteredParks.length > 0 && (
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
              {currentLine('park', coaster.park_name ?? '')}
              {parkChanged && effectivePark && (
                <p className="text-xs font-medium text-warning">
                  ⚠ Moving to {effectivePark.name} — moderators check this carefully.
                </p>
              )}
              {isNewParkProposal && (
                <p className="text-xs font-medium text-warning">
                  ⚠ New park “{proposedParkName}” — it will be created if approved.
                </p>
              )}
            </div>

            {isNewParkProposal && (
              <div className="rounded-xl border border-line bg-surface-bright p-4 md:col-span-2">
                <p className="text-xs font-medium text-ink-soft">
                  Location for {proposedParkName} (helps reviewers place it — all optional)
                </p>
                <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                  {(
                    [
                      ['city', 'City'],
                      ['region', 'Region / state'],
                      ['country', 'Country'],
                    ] as const
                  ).map(([key, label]) => (
                    <div key={key} className="flex flex-col gap-1">
                      <label
                        htmlFor={`edit-park-${key}`}
                        className="text-xs font-medium text-muted"
                      >
                        {label}
                      </label>
                      <input
                        id={`edit-park-${key}`}
                        value={parkLocationDraft[key] ?? ''}
                        onChange={(e) =>
                          setParkLocationDraft((d) => ({ ...d, [key]: e.target.value }))
                        }
                        maxLength={120}
                        className={fieldClassName}
                      />
                      {fieldError(`park_location.${key}`)}
                    </div>
                  ))}
                  {(
                    [
                      ['lat', 'Latitude', -90, 90],
                      ['lng', 'Longitude', -180, 180],
                    ] as const
                  ).map(([key, label, min, max]) => (
                    <div key={key} className="flex flex-col gap-1">
                      <label
                        htmlFor={`edit-park-${key}`}
                        className="text-xs font-medium text-muted"
                      >
                        {label}
                      </label>
                      <input
                        id={`edit-park-${key}`}
                        value={parkLocationDraft[key] ?? ''}
                        onChange={(e) =>
                          setParkLocationDraft((d) => ({ ...d, [key]: e.target.value }))
                        }
                        type="number"
                        step="any"
                        min={min}
                        max={max}
                        className={fieldClassName}
                      />
                      {fieldError(`park_location.${key}`)}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-col gap-2">
              <label htmlFor="edit-manufacturer" className="text-sm font-medium text-ink-soft">
                Manufacturers
              </label>
              <ManufacturerMultiPicker
                id="edit-manufacturer"
                manufacturers={manufacturers}
                selected={effectiveLineage}
                onChange={setLineageDraft}
                placeholder="Unknown"
              />
              {currentLine('manufacturers', lineageNames(coaster).join(' · '))}
              {fieldError('manufacturer_ids')}
              {fieldError('proposed_manufacturers')}
            </div>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <div className="flex flex-col gap-2">
              <label htmlFor="edit-status" className="text-sm font-medium text-ink-soft">
                Status
              </label>
              <select
                id="edit-status"
                value={merged.status}
                onChange={set('status')}
                className={selectClassName}
              >
                {COASTER_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {capitalize(s)}
                  </option>
                ))}
              </select>
              {currentLine('', capitalize(coaster.status))}
            </div>
            <div className="flex flex-col gap-2">
              <label htmlFor="edit-material" className="text-sm font-medium text-ink-soft">
                Material
              </label>
              <select
                id="edit-material"
                value={merged.material}
                onChange={set('material')}
                className={selectClassName}
              >
                {COASTER_MATERIALS.map((m) => (
                  <option key={m} value={m}>
                    {capitalize(m)}
                  </option>
                ))}
              </select>
              {currentLine('', capitalize(coaster.material))}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {(
              [
                ['height_m', 'Height (m)', 'any'],
                ['speed_kmh', 'Speed (km/h)', 'any'],
                ['length_m', 'Length (m)', 'any'],
                ['inversions', 'Inversions', '1'],
              ] as const
            ).map(([key, label, step]) => (
              <div key={key} className="flex flex-col gap-2">
                <label htmlFor={`edit-${key}`} className="text-sm font-medium text-ink-soft">
                  {label}
                </label>
                <input
                  id={`edit-${key}`}
                  value={merged[key]}
                  onChange={set(key)}
                  type="number"
                  min="0"
                  step={step}
                  className={fieldClassName}
                  placeholder="Unknown"
                />
                {fieldError(key)}
                {currentLine('', str(coaster[key]))}
              </div>
            ))}
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <div className="flex flex-col gap-2">
              <label htmlFor="edit-model" className="text-sm font-medium text-ink-soft">
                Model
              </label>
              <input
                id="edit-model"
                value={merged.model}
                onChange={set('model')}
                maxLength={120}
                className={fieldClassName}
                placeholder="Unknown"
              />
              {fieldError('model')}
              {currentLine('', coaster.model ?? '')}
            </div>
            <div className="flex flex-col gap-2">
              <label htmlFor="edit-type" className="text-sm font-medium text-ink-soft">
                Type
              </label>
              <input
                id="edit-type"
                value={merged.type}
                onChange={set('type')}
                maxLength={120}
                className={fieldClassName}
                placeholder="Unknown"
              />
              {fieldError('type')}
              {currentLine('', coaster.type ?? '')}
            </div>
            <div className="flex flex-col gap-2">
              <label htmlFor="edit-opening-date" className="text-sm font-medium text-ink-soft">
                Opening Date
              </label>
              <input
                id="edit-opening-date"
                type="date"
                value={merged.opening_date}
                onChange={set('opening_date')}
                className={fieldClassName}
              />
              {fieldError('opening_date')}
              {currentLine('', coaster.opening_date ?? '')}
            </div>
          </div>

          <div className="border-t border-line pt-6">
            <div className="flex flex-col gap-2">
              <label htmlFor="edit-note" className="text-sm font-medium text-ink-soft">
                Note (optional)
              </label>
              <textarea
                id="edit-note"
                rows={3}
                maxLength={2000}
                value={note}
                onChange={(e) => setNote(e.target.value)}
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

          <div className="flex items-center justify-between gap-4 border-t border-line pt-4">
            <p className="text-sm text-muted">
              {changeCount === 0
                ? 'No changes yet.'
                : `${changeCount} change${changeCount === 1 ? '' : 's'} proposed.`}
            </p>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={mutation.isPending}
                onClick={() => navigate(`/coasters/${slug}`)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="coral"
                disabled={mutation.isPending || atCap || changeCount === 0}
              >
                {mutation.isPending ? 'Sending…' : 'Suggest Edit'}
              </Button>
            </div>
          </div>
        </form>
      </Panel>

      {toast && (
        <Toast message={toast.message} tone={toast.tone} onDismiss={() => setToast(null)} />
      )}
    </div>
  )
}
