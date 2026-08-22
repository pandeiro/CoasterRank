import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { NormalizationResult, AdjudicationResult } from '../llm/tasks.js'

// Feature: track-a-data-quality, Property 5: NormalizationResult schema accepts valid and rejects invalid objects
describe('NormalizationResult schema', () => {
  it('accepts valid NormalizationResult and rejects constraint violations', () => {
    fc.assert(
      fc.property(
        fc.record({
          coaster_id: fc.string({ minLength: 1 }),
          cleaned_name: fc.string({ minLength: 1 }),
          issue: fc.constantFrom('park_name_embedded', 'truncated', 'abbreviation', 'none'),
          confidence: fc.double({ min: 0, max: 1, noNaN: true }),
          reasoning: fc.string({ maxLength: 200 }),
        }),
        (valid) => {
          expect(() => NormalizationResult.parse(valid)).not.toThrow()
        },
      ),
      { numRuns: 100 },
    )
  })

  it('rejects objects with confidence outside [0, 1]', () => {
    fc.assert(
      fc.property(
        fc.record({
          coaster_id: fc.string({ minLength: 1 }),
          cleaned_name: fc.string({ minLength: 1 }),
          issue: fc.constantFrom('park_name_embedded', 'truncated', 'abbreviation', 'none'),
          confidence: fc.double({ noNaN: true }).filter((v) => v < 0 || v > 1),
          reasoning: fc.string({ maxLength: 200 }),
        }),
        (invalid) => {
          expect(() => NormalizationResult.parse(invalid)).toThrow()
        },
      ),
      { numRuns: 100 },
    )
  })

  it('rejects objects with unknown issue value', () => {
    fc.assert(
      fc.property(
        fc.record({
          coaster_id: fc.string({ minLength: 1 }),
          cleaned_name: fc.string({ minLength: 1 }),
          issue: fc
            .string({ minLength: 1 })
            .filter(
              (s) => !['park_name_embedded', 'truncated', 'abbreviation', 'none'].includes(s),
            ),
          confidence: fc.double({ min: 0, max: 1, noNaN: true }),
          reasoning: fc.string({ maxLength: 200 }),
        }),
        (invalid) => {
          expect(() => NormalizationResult.parse(invalid)).toThrow()
        },
      ),
      { numRuns: 100 },
    )
  })

  it('rejects objects with reasoning exceeding 200 chars', () => {
    fc.assert(
      fc.property(
        fc.record({
          coaster_id: fc.string({ minLength: 1 }),
          cleaned_name: fc.string({ minLength: 1 }),
          issue: fc.constantFrom('park_name_embedded', 'truncated', 'abbreviation', 'none'),
          confidence: fc.double({ min: 0, max: 1, noNaN: true }),
          reasoning: fc.string({ minLength: 201, maxLength: 500 }),
        }),
        (invalid) => {
          expect(() => NormalizationResult.parse(invalid)).toThrow()
        },
      ),
      { numRuns: 100 },
    )
  })

  it('rejects objects with missing required fields', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('coaster_id', 'cleaned_name', 'issue', 'confidence', 'reasoning'),
        (missingField) => {
          const full = {
            coaster_id: 'abc',
            cleaned_name: 'Fury 325',
            issue: 'none' as const,
            confidence: 0.9,
            reasoning: 'ok',
          }
          const { [missingField]: _, ...partial } = full
          expect(() => NormalizationResult.parse(partial)).toThrow()
        },
      ),
      { numRuns: 100 },
    )
  })
})

// Feature: track-a-data-quality, Property 6: AdjudicationResult schema accepts valid and rejects invalid objects
describe('AdjudicationResult schema', () => {
  it('accepts valid AdjudicationResult and rejects constraint violations', () => {
    fc.assert(
      fc.property(
        fc.record({
          pair_id: fc.string({ minLength: 1 }),
          verdict: fc.constantFrom('duplicate', 'not_duplicate', 'needs_human'),
          confidence: fc.double({ min: 0, max: 1, noNaN: true }),
          reasoning: fc.string({ maxLength: 200 }),
        }),
        (valid) => {
          expect(() => AdjudicationResult.parse(valid)).not.toThrow()
        },
      ),
      { numRuns: 100 },
    )
  })

  it('rejects objects with confidence outside [0, 1]', () => {
    fc.assert(
      fc.property(
        fc.record({
          pair_id: fc.string({ minLength: 1 }),
          verdict: fc.constantFrom('duplicate', 'not_duplicate', 'needs_human'),
          confidence: fc.double({ noNaN: true }).filter((v) => v < 0 || v > 1),
          reasoning: fc.string({ maxLength: 200 }),
        }),
        (invalid) => {
          expect(() => AdjudicationResult.parse(invalid)).toThrow()
        },
      ),
      { numRuns: 100 },
    )
  })

  it('rejects objects with unknown verdict value', () => {
    fc.assert(
      fc.property(
        fc.record({
          pair_id: fc.string({ minLength: 1 }),
          verdict: fc
            .string({ minLength: 1 })
            .filter((s) => !['duplicate', 'not_duplicate', 'needs_human'].includes(s)),
          confidence: fc.double({ min: 0, max: 1, noNaN: true }),
          reasoning: fc.string({ maxLength: 200 }),
        }),
        (invalid) => {
          expect(() => AdjudicationResult.parse(invalid)).toThrow()
        },
      ),
      { numRuns: 100 },
    )
  })

  it('rejects objects with reasoning exceeding 200 chars', () => {
    fc.assert(
      fc.property(
        fc.record({
          pair_id: fc.string({ minLength: 1 }),
          verdict: fc.constantFrom('duplicate', 'not_duplicate', 'needs_human'),
          confidence: fc.double({ min: 0, max: 1, noNaN: true }),
          reasoning: fc.string({ minLength: 201, maxLength: 500 }),
        }),
        (invalid) => {
          expect(() => AdjudicationResult.parse(invalid)).toThrow()
        },
      ),
      { numRuns: 100 },
    )
  })

  it('rejects objects with missing required fields', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('pair_id', 'verdict', 'confidence', 'reasoning'),
        (missingField) => {
          const full = {
            pair_id: 'abc',
            verdict: 'duplicate' as const,
            confidence: 0.9,
            reasoning: 'ok',
          }
          const { [missingField]: _, ...partial } = full
          expect(() => AdjudicationResult.parse(partial)).toThrow()
        },
      ),
      { numRuns: 100 },
    )
  })
})

// Feature: track-a-data-quality, Property 1: Zod validation is the only gate between LLM output and DB writes
describe('Zod validation gate', () => {
  it('NormalizationResult.parse succeeds or throws — no partial objects returned', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (json) => {
        if (typeof json !== 'object' || json === null || Array.isArray(json)) {
          expect(() => NormalizationResult.parse(json)).toThrow()
          return
        }
        const result = NormalizationResult.safeParse(json)
        if (result.success) {
          expect(typeof result.data.coaster_id).toBe('string')
          expect(typeof result.data.cleaned_name).toBe('string')
          expect(['park_name_embedded', 'truncated', 'abbreviation', 'none']).toContain(
            result.data.issue,
          )
          expect(typeof result.data.confidence).toBe('number')
          expect(typeof result.data.reasoning).toBe('string')
        } else {
          expect(() => NormalizationResult.parse(json)).toThrow()
        }
      }),
      { numRuns: 100 },
    )
  })

  it('AdjudicationResult.parse succeeds or throws — no partial objects returned', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (json) => {
        if (typeof json !== 'object' || json === null || Array.isArray(json)) {
          expect(() => AdjudicationResult.parse(json)).toThrow()
          return
        }
        const result = AdjudicationResult.safeParse(json)
        if (result.success) {
          expect(typeof result.data.pair_id).toBe('string')
          expect(['duplicate', 'not_duplicate', 'needs_human']).toContain(result.data.verdict)
          expect(typeof result.data.confidence).toBe('number')
          expect(typeof result.data.reasoning).toBe('string')
        } else {
          expect(() => AdjudicationResult.parse(json)).toThrow()
        }
      }),
      { numRuns: 100 },
    )
  })
})
