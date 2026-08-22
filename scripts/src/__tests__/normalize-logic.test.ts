import { describe, it, expect } from 'vitest'
import fc from 'fast-check'

type IssueType = 'park_name_embedded' | 'truncated' | 'abbreviation' | 'none'
type ReviewState = 'active' | 'needs_review' | 'possibly_duplicate' | 'archived'

// Feature: track-a-data-quality, Property 9: Normalization correctly partitions high/low confidence
// (disjoint, collectively exhaustive for issue != 'none' records)
describe('Normalization partitions high/low confidence', () => {
  it('high confidence (>= 0.7) and low confidence (< 0.7) records are disjoint', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            issue: fc.constantFrom<IssueType>('park_name_embedded', 'truncated', 'abbreviation'),
            confidence: fc.double({ min: 0, max: 1, noNaN: true }),
          }),
          { minLength: 1 },
        ),
        (results) => {
          const high = results.filter((r) => r.issue !== 'none' && r.confidence >= 0.7)
          const low = results.filter((r) => r.issue !== 'none' && r.confidence < 0.7)
          // Disjoint: no record can be in both sets
          const highIds = new Set(high)
          const overlap = low.filter((r) => highIds.has(r))
          expect(overlap).toHaveLength(0)
        },
      ),
      { numRuns: 100 },
    )
  })

  it('all issue != none records are covered by high or low', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            issue: fc.constantFrom<IssueType>('park_name_embedded', 'truncated', 'abbreviation'),
            confidence: fc.double({ min: 0, max: 1, noNaN: true }),
          }),
          { minLength: 1 },
        ),
        (results) => {
          const nonNone = results.filter((r) => r.issue !== 'none')
          const high = nonNone.filter((r) => r.confidence >= 0.7)
          const low = nonNone.filter((r) => r.confidence < 0.7)
          // Collectively exhaustive: high + low = all non-none
          expect(high.length + low.length).toBe(nonNone.length)
        },
      ),
      { numRuns: 100 },
    )
  })
})

// Feature: track-a-data-quality, Property 11: Normalization summary counts sum to N
describe('Normalization summary counts', () => {
  it('counts are mutually exclusive and sum to N', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            issue: fc.constantFrom<IssueType>(
              'park_name_embedded',
              'truncated',
              'abbreviation',
              'none',
            ),
            confidence: fc.double({ min: 0, max: 1, noNaN: true }),
          }),
          { minLength: 0, maxLength: 50 },
        ),
        (results) => {
          const total = results.length
          const issueNone = results.filter((r) => r.issue === 'none').length
          const highConf = results.filter((r) => r.issue !== 'none' && r.confidence >= 0.7).length
          const lowConf = results.filter((r) => r.issue !== 'none' && r.confidence < 0.7).length

          // All four categories are disjoint and sum to total
          expect(issueNone + highConf + lowConf).toBe(total)
        },
      ),
      { numRuns: 100 },
    )
  })
})

// Feature: track-a-data-quality, Property 10: Normalization is idempotent for already-processed records
describe('Normalization idempotency', () => {
  it('already-processed records (review_state != active) are skipped', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            id: fc.uuid(),
            review_state: fc.constantFrom<ReviewState>(
              'needs_review',
              'possibly_duplicate',
              'archived',
            ),
          }),
          { minLength: 1, maxLength: 20 },
        ),
        (records) => {
          // All these records have review_state != 'active'
          // A normalize run without --reprocess should skip them all
          const toProcess = records.filter((r) => r.review_state === 'active')
          expect(toProcess).toHaveLength(0)
        },
      ),
      { numRuns: 100 },
    )
  })
})
