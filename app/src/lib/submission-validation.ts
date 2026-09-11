// Client-side schema for coaster submissions (new + edit).
//
// Mirrors the load-bearing DB guard `submission_payload_valid(kind, fields)`
// (supabase/migrations/20260911000200_…_lineage.sql) plus the `coasters`
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

// Per-field rules for the suggested_fields payload. Kind-aware only in key
// shape (new requires the five stat keys; edit allows a diff subset plus
// name) — value rules are identical, matching the DB function.
export function validateSuggestedFields(
  kind: 'new' | 'edit',
  fields: Record<string, unknown>,
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
  Object.assign(errors, validateSuggestedFields('new', input.suggested_fields ?? {}))
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
  park_id: string
  suggested_fields: Record<string, unknown>
  note?: string | null
}

// Edit suggestion: target + park required, diff non-empty, values valid.
export function validateEditSubmission(input: EditSubmissionInput): SubmissionValidationErrors {
  const errors: SubmissionValidationErrors = {}
  if (!isValidUuid(input.coaster_id)) errors.coaster_id = 'This edit is missing its coaster.'
  if (!isValidUuid(input.park_id)) errors.park_id = 'Pick a park from the list.'
  const fields = input.suggested_fields ?? {}
  Object.assign(errors, validateSuggestedFields('edit', fields))
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
