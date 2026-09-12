// Client-side schema for coaster submissions (new + edit).
//
// Mirrors the load-bearing DB guard
// `submission_payload_valid(kind, park_id, fields)`
// (supabase/migrations/20260912170000_…_park_location.sql) plus the `coasters`
// NOT NULL columns and the `coaster_submissions_note_check`, so invalid data
// is rejected in the form — before it can ever become a pending row an admin
// cannot accept.
//
// The classic failure: SubmitPage sent `material: null`, the submission CHECK
// allows null, but `coasters.material` is NOT NULL — approval then blew up on
// the INSERT. approveSubmission now omits null material/status (letting the
// 'other'/'unknown' defaults apply); this schema additionally validates every
// field the forms can produce (ranges, integer inversions, finite numbers,
// name/note lengths, date shape, uuid shape) and surfaces per-field messages.

import type { CoasterMaterial, CoasterStatus } from './board-types'

// Local copies of the catalog enums (mirrored from ./coasters to avoid a
// coasters ↔ submission-validation import cycle — coasters.ts imports the
// validators below in its submit chokepoints).
const COASTER_MATERIALS: readonly string[] = ['steel', 'wood', 'hybrid', 'other']
const COASTER_STATUSES: readonly string[] = [
  'operating',
  'defunct',
  'sbno',
  'under_construction',
  'relocated',
  'unknown',
]

export const SUBMISSION_LIMITS = {
  nameMin: 1,
  nameMax: 120,
  noteMax: 2000,
  heightMax: 500,
  speedMax: 500,
  lengthMax: 10000,
  inversionsMax: 30,
  lineageMax: 10,
  proposedNameMax: 80,
  locationTextMax: 120,
  latMin: -90,
  latMax: 90,
  lngMin: -180,
  lngMax: 180,
  dateMin: '1800-01-01',
  dateMax: '2100-01-01',
} as const

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export type SubmissionValidationErrors = Record<string, string>

export function isValidUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value)
}

/** Raw stat text from a `<input type="number">` → number|null. NaN/Infinity pass through as NaN so the validator can flag them. */
export function parseOptionalNumber(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'number') return raw
  if (raw.trim() === '') return null
  return Number(raw)
}

function statError(
  label: string,
  value: unknown,
  opts: { max: number; integer?: boolean },
): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'number' || !Number.isFinite(value)) return `${label} must be a number.`
  if (value < 0 || value > opts.max) return `${label} must be between 0 and ${opts.max}.`
  if (opts.integer && !Number.isInteger(value))
    return `${label} must be a whole number between 0 and ${opts.max}.`
  return null
}

function textError(label: string, value: unknown, max: number): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') return `${label} must be text.`
  if (value.length < 1 || value.length > max) return `${label} must be 1–${max} characters.`
  return null
}

function dateError(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string' || !ISO_DATE_RE.test(value))
    return 'Opening date must be a valid date (YYYY-MM-DD).'
  if (value < SUBMISSION_LIMITS.dateMin || value > SUBMISSION_LIMITS.dateMax)
    return `Opening date must be between ${SUBMISSION_LIMITS.dateMin} and ${SUBMISSION_LIMITS.dateMax}.`
  const [y, m, d] = value.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d)
    return 'Opening date must be a real calendar date.'
  return null
}

function lineageError(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (!Array.isArray(value)) return 'Manufacturers must be a list.'
  if (value.length > SUBMISSION_LIMITS.lineageMax)
    return `Pick at most ${SUBMISSION_LIMITS.lineageMax} manufacturers.`
  if (!value.every(isValidUuid)) return 'One of the selected manufacturers is invalid — re-pick it.'
  return null
}

export type ProposedManufacturer = { name: string; position: number }

function proposedManufacturersError(value: unknown, idsCount: number): string | null {
  if (value === null || value === undefined) return null
  if (!Array.isArray(value)) return 'Proposed manufacturers must be a list.'
  if (value.length < 1) return 'A proposed manufacturer needs a name.'
  if (value.length > SUBMISSION_LIMITS.lineageMax)
    return `Propose at most ${SUBMISSION_LIMITS.lineageMax} manufacturers.`
  if (idsCount + value.length > SUBMISSION_LIMITS.lineageMax)
    return `Pick at most ${SUBMISSION_LIMITS.lineageMax} manufacturers in total (existing + proposed).`
  const seen = new Set<number>()
  for (const entry of value) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      return 'Each proposed manufacturer must have a name and a position.'
    }
    const record = entry as Record<string, unknown>
    const extraKeys = Object.keys(record).filter((k) => k !== 'name' && k !== 'position')
    if (extraKeys.length > 0 || !('name' in record) || !('position' in record)) {
      return 'Each proposed manufacturer must have exactly a name and a position.'
    }
    if (typeof record.name !== 'string' || record.name.trim().length < 1) {
      return 'Proposed manufacturer names must be 1–80 characters.'
    }
    if (record.name.trim().length > SUBMISSION_LIMITS.proposedNameMax) {
      return `Proposed manufacturer names must be 1–${SUBMISSION_LIMITS.proposedNameMax} characters.`
    }
    const { position } = record
    if (
      typeof position !== 'number' ||
      !Number.isInteger(position) ||
      position < 0 ||
      position > 9
    ) {
      return 'Proposed manufacturer positions must be whole numbers 0–9.'
    }
    // The slot must exist in the merged lineage (existing ids + proposals).
    if (position >= idsCount + value.length) {
      return 'Proposed manufacturer positions are out of range — reorder them.'
    }
    if (seen.has(position)) {
      return 'Two proposed manufacturers claim the same slot — reorder them.'
    }
    seen.add(position)
  }
  return null
}

/** Location metadata riding along with a new-park proposal (parks columns). */
export type ParkLocation = {
  city?: string
  region?: string
  country?: string
  lat?: number
  lng?: number
}

export type ParkLocationInput = {
  city?: string | null
  region?: string | null
  country?: string | null
  lat?: string | number | null
  lng?: string | number | null
}

// Park location is only meaningful for a park that does not exist yet
// (park_id null). Absent/empty text fields serialize as absent keys.
export function serializeParkLocation(
  location: ParkLocationInput | null | undefined,
): ParkLocation | null {
  if (!location) return null
  const out: ParkLocation = {}
  const text = (key: 'city' | 'region' | 'country') => {
    const raw = location[key]
    const value = typeof raw === 'string' ? raw.trim() : ''
    if (value) out[key] = value
  }
  text('city')
  text('region')
  text('country')
  const coord = (key: 'lat' | 'lng', min: number, max: number) => {
    const value = parseOptionalNumber(location[key] ?? null)
    if (value !== null && Number.isFinite(value)) out[key] = Math.min(max, Math.max(min, value))
  }
  coord('lat', SUBMISSION_LIMITS.latMin, SUBMISSION_LIMITS.latMax)
  coord('lng', SUBMISSION_LIMITS.lngMin, SUBMISSION_LIMITS.lngMax)
  return Object.keys(out).length > 0 ? out : null
}

function parkLocationError(
  value: unknown,
  parkId: string | null | undefined,
): SubmissionValidationErrors {
  const errors: SubmissionValidationErrors = {}
  if (value === null || value === undefined) return errors
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { park_location: 'Park location must be an object.' }
  }
  const record = value as Record<string, unknown>
  const allowed = ['city', 'region', 'country', 'lat', 'lng']
  const extraKeys = Object.keys(record).filter((k) => !allowed.includes(k))
  if (extraKeys.length > 0) {
    errors.park_location = 'Park location has unknown fields.'
    return errors
  }
  if (
    record.city === undefined &&
    record.region === undefined &&
    record.country === undefined &&
    record.lat === undefined &&
    record.lng === undefined
  ) {
    errors.park_location = 'Park location is empty.'
    return errors
  }
  if (isValidUuid(parkId ?? undefined)) {
    errors.park_location = 'Park location can only be attached to a park that does not exist yet.'
    return errors
  }
  const text = (key: 'city' | 'region' | 'country', label: string) => {
    if (record[key] === undefined) return
    // Mirror the DB's btrim rule: whitespace-only text is rejected, lengths
    // are checked on the trimmed value.
    if (typeof record[key] !== 'string' || record[key].trim().length < 1) {
      errors[`park_location.${key}`] =
        `${label} must be 1–${SUBMISSION_LIMITS.locationTextMax} characters.`
      return
    }
    const err = textError(label, record[key].trim(), SUBMISSION_LIMITS.locationTextMax)
    if (err) errors[`park_location.${key}`] = err
  }
  text('city', 'City')
  text('region', 'Region/state')
  text('country', 'Country')
  const coord = (key: 'lat' | 'lng', label: string, min: number, max: number) => {
    if (record[key] === undefined) return
    const num = typeof record[key] === 'number' ? record[key] : null
    if (num === null || !Number.isFinite(num) || num < min || num > max) {
      errors[`park_location.${key}`] = `${label} must be between ${min} and ${max}.`
    }
  }
  coord('lat', 'Latitude', SUBMISSION_LIMITS.latMin, SUBMISSION_LIMITS.latMax)
  coord('lng', 'Longitude', SUBMISSION_LIMITS.lngMin, SUBMISSION_LIMITS.lngMax)
  return errors
}

// Per-field rules for the suggested_fields payload. Kind-aware only in key
// shape (new requires the five stat keys; edit allows a diff subset plus
// name) — value rules are identical, matching the DB function. parkId gates
// park_location (only for a park that does not exist yet), mirroring the
// 3-arg DB signature.
export function validateSuggestedFields(
  kind: 'new' | 'edit',
  fields: Record<string, unknown>,
  parkId?: string | null,
): SubmissionValidationErrors {
  const errors: SubmissionValidationErrors = {}
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
    return { suggested_fields: 'Submission data is malformed.' }
  }

  const allowed =
    kind === 'new'
      ? [
          'height_m',
          'speed_kmh',
          'length_m',
          'inversions',
          'material',
          'manufacturer_id',
          'manufacturer_ids',
          'status',
          'model',
          'type',
          'opening_date',
          'proposed_manufacturers',
          'park_location',
        ]
      : [
          'height_m',
          'speed_kmh',
          'length_m',
          'inversions',
          'material',
          'manufacturer_id',
          'manufacturer_ids',
          'status',
          'model',
          'type',
          'opening_date',
          'name',
          'proposed_manufacturers',
          'park_location',
        ]
  for (const key of Object.keys(fields)) {
    if (!allowed.includes(key)) {
      errors[key] = 'This field cannot be submitted.'
    }
  }
  if (kind === 'new') {
    for (const key of ['height_m', 'speed_kmh', 'length_m', 'inversions', 'material']) {
      if (!(key in fields)) errors[key] = 'This field is required.'
    }
  }

  const stat = (
    key: 'height_m' | 'speed_kmh' | 'length_m' | 'inversions',
    label: string,
    max: number,
    integer = false,
  ) => {
    if (!(key in fields)) return
    const err = statError(label, fields[key], { max, integer })
    if (err) errors[key] = err
  }
  stat('height_m', 'Height', SUBMISSION_LIMITS.heightMax)
  stat('speed_kmh', 'Speed', SUBMISSION_LIMITS.speedMax)
  stat('length_m', 'Length', SUBMISSION_LIMITS.lengthMax)
  stat('inversions', 'Inversions', SUBMISSION_LIMITS.inversionsMax, true)

  if ('material' in fields && fields.material !== null && fields.material !== undefined) {
    if (!COASTER_MATERIALS.includes(fields.material as string)) {
      errors.material = `Material must be one of: ${COASTER_MATERIALS.join(', ')}.`
    }
  }
  if ('status' in fields && fields.status !== null && fields.status !== undefined) {
    if (!COASTER_STATUSES.includes(fields.status as string)) {
      errors.status = `Status must be one of: ${COASTER_STATUSES.join(', ')}.`
    }
  }
  if ('manufacturer_id' in fields && fields.manufacturer_id !== null) {
    if (!isValidUuid(fields.manufacturer_id)) errors.manufacturer_id = 'Invalid manufacturer.'
  }
  if ('manufacturer_ids' in fields) {
    const err = lineageError(fields.manufacturer_ids)
    if (err) errors.manufacturer_ids = err
  }
  if ('proposed_manufacturers' in fields) {
    const idsCount = Array.isArray(fields.manufacturer_ids) ? fields.manufacturer_ids.length : 0
    const err = proposedManufacturersError(fields.proposed_manufacturers, idsCount)
    if (err) errors.proposed_manufacturers = err
  }
  if ('park_location' in fields) {
    Object.assign(errors, parkLocationError(fields.park_location, parkId ?? null))
  }
  for (const key of ['model', 'type'] as const) {
    if (!(key in fields)) continue
    const err = textError(
      key === 'model' ? 'Model' : 'Type',
      fields[key],
      SUBMISSION_LIMITS.nameMax,
    )
    if (err) errors[key] = err
  }
  if ('name' in fields) {
    const err = textError('Coaster name', fields.name, SUBMISSION_LIMITS.nameMax)
    if (err) errors.name = err
  }
  if ('opening_date' in fields) {
    const err = dateError(fields.opening_date)
    if (err) errors.opening_date = err
  }
  return errors
}

export type NewSubmissionInput = {
  coaster_name: string
  park_name: string
  /** Existing park id, or null when the submission proposes a new park. */
  park_id?: string | null
  suggested_fields: Record<string, unknown>
  note?: string | null
}

// Full new-coaster submission: top-level names + note + payload. Returns a
// per-field error map (empty = valid).
export function validateNewSubmission(input: NewSubmissionInput): SubmissionValidationErrors {
  const errors: SubmissionValidationErrors = {}
  const coasterName = (input.coaster_name ?? '').trim()
  if (
    coasterName.length < SUBMISSION_LIMITS.nameMin ||
    coasterName.length > SUBMISSION_LIMITS.nameMax
  ) {
    errors.coaster_name = `Coaster name must be ${SUBMISSION_LIMITS.nameMin}–${SUBMISSION_LIMITS.nameMax} characters.`
  }
  const parkName = (input.park_name ?? '').trim()
  if (parkName.length < SUBMISSION_LIMITS.nameMin || parkName.length > SUBMISSION_LIMITS.nameMax) {
    errors.park_name = `Park name must be ${SUBMISSION_LIMITS.nameMin}–${SUBMISSION_LIMITS.nameMax} characters.`
  }
  Object.assign(
    errors,
    validateSuggestedFields('new', input.suggested_fields ?? {}, input.park_id ?? null),
  )
  if (input.note !== null && input.note !== undefined) {
    if (typeof input.note !== 'string' || input.note.trim().length < 1) {
      errors.note = 'Note cannot be empty — remove it or write 1–2000 characters.'
    } else if (input.note.trim().length > SUBMISSION_LIMITS.noteMax) {
      errors.note = `Note must be at most ${SUBMISSION_LIMITS.noteMax} characters.`
    }
  }
  return errors
}

export type EditSubmissionInput = {
  coaster_id: string
  /** Existing park id, or null when the edit proposes a new park. */
  park_id: string | null
  suggested_fields: Record<string, unknown>
  note?: string | null
}

// Edit suggestion: target + park (existing id or a new-park proposal),
// diff non-empty, values valid.
export function validateEditSubmission(input: EditSubmissionInput): SubmissionValidationErrors {
  const errors: SubmissionValidationErrors = {}
  if (!isValidUuid(input.coaster_id)) errors.coaster_id = 'This edit is missing its coaster.'
  if (input.park_id !== null && !isValidUuid(input.park_id)) {
    errors.park_id = 'Pick a park from the list, or name a new park.'
  }
  const fields = input.suggested_fields ?? {}
  Object.assign(errors, validateSuggestedFields('edit', fields, input.park_id ?? null))
  if (Object.keys(errors).length === 0 && Object.keys(fields).length === 0) {
    errors.suggested_fields = 'Change at least one field.'
  }
  if (input.note !== null && input.note !== undefined) {
    if (typeof input.note !== 'string' || input.note.trim().length < 1) {
      errors.note = 'Note cannot be empty — remove it or write 1–2000 characters.'
    } else if (input.note.trim().length > SUBMISSION_LIMITS.noteMax) {
      errors.note = `Note must be at most ${SUBMISSION_LIMITS.noteMax} characters.`
    }
  }
  return errors
}

export function validationSummary(errors: SubmissionValidationErrors): string | null {
  const keys = Object.keys(errors)
  if (keys.length === 0) return null
  if (keys.length === 1) return errors[keys[0]]
  return `${keys.length} fields need attention — fix the highlighted fields below.`
}

export type { CoasterMaterial, CoasterStatus }
