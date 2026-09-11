import { describe, expect, it } from 'vitest'
import {
  parseOptionalNumber,
  validateEditSubmission,
  validateNewSubmission,
  validateSuggestedFields,
  validationSummary,
} from './submission-validation'

const UUID = '11111111-2222-4333-8444-555555555555'

function newFields(overrides: Record<string, unknown> = {}) {
  return {
    height_m: null,
    speed_kmh: null,
    length_m: null,
    inversions: null,
    material: null,
    ...overrides,
  }
}

describe('validateSuggestedFields', () => {
  it('accepts an all-null new payload (nothing suggested)', () => {
    expect(validateSuggestedFields('new', newFields())).toEqual({})
  })

  it('requires the five stat keys for kind=new', () => {
    const errors = validateSuggestedFields('new', { height_m: 10 })
    for (const key of ['speed_kmh', 'length_m', 'inversions', 'material']) {
      expect(errors[key]).toMatch(/required/i)
    }
  })

  it('rejects unknown keys', () => {
    expect(validateSuggestedFields('new', newFields({ slug: 'evil' })).slug).toMatch(/cannot/i)
    expect(validateSuggestedFields('edit', { source: 'admin' }).source).toMatch(/cannot/i)
  })

  it('rejects out-of-range and non-finite stats', () => {
    expect(validateSuggestedFields('new', newFields({ height_m: -1 })).height_m).toMatch(
      /between 0 and 500/,
    )
    expect(validateSuggestedFields('new', newFields({ height_m: 501 })).height_m).toBeDefined()
    expect(validateSuggestedFields('new', newFields({ speed_kmh: NaN })).speed_kmh).toMatch(
      /must be a number/,
    )
    expect(validateSuggestedFields('new', newFields({ length_m: 10001 })).length_m).toBeDefined()
    expect(validateSuggestedFields('new', newFields({ length_m: Infinity })).length_m).toMatch(
      /must be a number/,
    )
  })

  it('requires whole-number inversions in range', () => {
    expect(validateSuggestedFields('new', newFields({ inversions: 2.5 })).inversions).toMatch(
      /whole number/,
    )
    expect(validateSuggestedFields('new', newFields({ inversions: -1 })).inversions).toBeDefined()
    expect(validateSuggestedFields('new', newFields({ inversions: 31 })).inversions).toBeDefined()
    expect(validateSuggestedFields('new', newFields({ inversions: 14 })).inversions).toBeUndefined()
  })

  it('rejects bad enums, uuid shapes, text lengths, and dates', () => {
    expect(validateSuggestedFields('new', newFields({ material: 'titanium' })).material).toMatch(
      /must be one of/,
    )
    expect(validateSuggestedFields('new', newFields({ status: 'running' })).status).toMatch(
      /must be one of/,
    )
    expect(
      validateSuggestedFields('new', newFields({ manufacturer_id: 'nope' })).manufacturer_id,
    ).toBeDefined()
    expect(
      validateSuggestedFields('new', newFields({ manufacturer_ids: ['nope'] })).manufacturer_ids,
    ).toBeDefined()
    expect(
      validateSuggestedFields('new', newFields({ manufacturer_ids: Array(11).fill(UUID) }))
        .manufacturer_ids,
    ).toMatch(/at most 10/)
    expect(validateSuggestedFields('new', newFields({ model: 'x'.repeat(121) })).model).toMatch(
      /1–120/,
    )
    expect(
      validateSuggestedFields('new', newFields({ opening_date: '2024-02-30' })).opening_date,
    ).toMatch(/real calendar date/)
    expect(
      validateSuggestedFields('new', newFields({ opening_date: '1799-01-01' })).opening_date,
    ).toMatch(/between/)
    expect(
      validateSuggestedFields('new', newFields({ opening_date: '2024-05-04' })).opening_date,
    ).toBeUndefined()
  })

  it('allows name on edit payloads but not new ones', () => {
    expect(validateSuggestedFields('edit', { name: 'SteVe' })).toEqual({})
    expect(validateSuggestedFields('new', newFields({ name: 'SteVe' })).name).toMatch(/cannot/i)
  })
})

describe('validateNewSubmission', () => {
  it('accepts a minimal valid submission', () => {
    expect(
      validateNewSubmission({
        coaster_name: 'Turbo Track',
        park_name: 'Ferrari World Abu Dhabi',
        suggested_fields: newFields(),
        note: null,
      }),
    ).toEqual({})
  })

  it('requires non-blank names within 120 chars', () => {
    const base = { park_name: 'P', suggested_fields: newFields(), note: null }
    expect(validateNewSubmission({ ...base, coaster_name: '   ' }).coaster_name).toMatch(
      /must be 1–120/,
    )
    expect(
      validateNewSubmission({
        coaster_name: 'C',
        suggested_fields: newFields(),
        note: null,
        park_name: '',
      }).park_name,
    ).toMatch(/must be 1–120/)
    expect(
      validateNewSubmission({ ...base, coaster_name: 'x'.repeat(121) }).coaster_name,
    ).toBeDefined()
  })

  it('rejects empty and overlong notes', () => {
    const base = { coaster_name: 'C', park_name: 'P', suggested_fields: newFields() }
    expect(validateNewSubmission({ ...base, note: '   ' }).note).toMatch(/cannot be empty/)
    expect(validateNewSubmission({ ...base, note: 'x'.repeat(2001) }).note).toMatch(/at most 2000/)
    expect(validateNewSubmission({ ...base, note: 'RCDB link' })).toEqual({})
  })
})

describe('validateEditSubmission', () => {
  const base = { coaster_id: UUID, park_id: UUID, note: null as string | null }

  it('accepts a single-field diff', () => {
    expect(validateEditSubmission({ ...base, suggested_fields: { height_m: 63 } })).toEqual({})
  })

  it('requires targets and a non-empty diff', () => {
    expect(
      validateEditSubmission({ ...base, coaster_id: 'bad', suggested_fields: { height_m: 1 } })
        .coaster_id,
    ).toMatch(/missing its coaster/)
    expect(
      validateEditSubmission({ ...base, park_id: 'bad', suggested_fields: { height_m: 1 } })
        .park_id,
    ).toMatch(/park/i)
    expect(validateEditSubmission({ ...base, suggested_fields: {} }).suggested_fields).toMatch(
      /at least one/,
    )
  })
})

describe('parseOptionalNumber', () => {
  it('maps blanks to null and keeps numbers', () => {
    expect(parseOptionalNumber('')).toBeNull()
    expect(parseOptionalNumber('   ')).toBeNull()
    expect(parseOptionalNumber(null)).toBeNull()
    expect(parseOptionalNumber('63')).toBe(63)
    expect(parseOptionalNumber(4.3)).toBe(4.3)
  })

  it('passes NaN through so the schema can reject it', () => {
    expect(parseOptionalNumber('abc')).toBeNaN()
  })
})

describe('validationSummary', () => {
  it('is null when valid and summarizes otherwise', () => {
    expect(validationSummary({})).toBeNull()
    expect(validationSummary({ height_m: 'Height must be between 0 and 500.' })).toBe(
      'Height must be between 0 and 500.',
    )
    expect(validationSummary({ a: 'x', b: 'y' })).toMatch(/2 fields need attention/)
  })
})
