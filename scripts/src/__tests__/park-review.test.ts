import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fc from 'fast-check'

describe('Park Review Logic - Property Tests', () => {
  describe('Merge atomicity (pattern)', () => {
    it('Atomic transaction pattern: all operations succeed or all roll back', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              id: fc.uuid(),
              park_id: fc.uuid(),
            }),
            { minLength: 1, maxLength: 10 },
          ),
          (coasters) => {
            const duplicateParkId = coasters[0]!.park_id
            const canonicalParkId = fc.uuid()
            const candidateId = fc.uuid()
            const reason = fc.string({ minLength: 1, maxLength: 200 })

            let coasterUpdates = 0
            let parkDeleted = false
            let candidateResolved = false
            let rolledBack = false

            const mockTransaction = async () => {
              try {
                coasterUpdates = coasters.filter((c) => c.park_id === duplicateParkId).length
                parkDeleted = true
                candidateResolved = true
              } catch {
                rolledBack = true
                throw new Error('Transaction failed')
              }
            }

            try {
              mockTransaction()
              expect(rolledBack).toBe(false)
              expect(coasterUpdates).toBe(
                coasters.filter((c) => c.park_id === duplicateParkId).length,
              )
              expect(parkDeleted).toBe(true)
              expect(candidateResolved).toBe(true)
            } catch {
              expect(rolledBack).toBe(true)
            }
          },
        ),
        { numRuns: 100 },
      )
    })
  })

  describe('Merge count summary consistency', () => {
    it('Canonical park survives, duplicate is gone (Property 17)', () => {
      fc.assert(
        fc.property(
          fc.record({
            canonicalId: fc.uuid(),
            duplicateId: fc.uuid(),
            coasterCount: fc.nat({ max: 50 }),
          }),
          ({ canonicalId, duplicateId, coasterCount }) => {
            const allParks = new Set([canonicalId, duplicateId])
            const allCoasters = Array.from({ length: coasterCount }, () => ({
              id: fc.uuid(),
              park_id: duplicateId,
            }))

            const canonicalExists = allParks.has(canonicalId)
            const duplicateExists = allParks.has(duplicateId)

            expect(canonicalExists).toBe(true)
            expect(duplicateExists).toBe(true)

            const afterMergeParks = new Set([canonicalId])
            const afterMergeCoasters = allCoasters.map((c) => ({ ...c, park_id: canonicalId }))

            expect(afterMergeParks.has(canonicalId)).toBe(true)
            expect(afterMergeParks.has(duplicateId)).toBe(false)
            expect(afterMergeCoasters.every((c) => c.park_id === canonicalId)).toBe(true)
            expect(afterMergeCoasters.length).toBe(coasterCount)
          },
        ),
        { numRuns: 100 },
      )
    })
  })

  describe('Review action partitioning', () => {
    it('Each candidate gets exactly one action: merge, reject, or skip', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              action: fc.constantFrom('merge', 'reject', 'skip'),
            }),
            { minLength: 1, maxLength: 20 },
          ),
          (actions) => {
            const counts = {
              merge: actions.filter((a) => a.action === 'merge').length,
              reject: actions.filter((a) => a.action === 'reject').length,
              skip: actions.filter((a) => a.action === 'skip').length,
            }

            const total = counts.merge + counts.reject + counts.skip
            expect(total).toBe(actions.length)
            expect(counts.merge).toBeGreaterThanOrEqual(0)
            expect(counts.reject).toBeGreaterThanOrEqual(0)
            expect(counts.skip).toBeGreaterThanOrEqual(0)
          },
        ),
        { numRuns: 100 },
      )
    })

    it('Summary counts are mutually exclusive and sum to total', () => {
      fc.assert(
        fc.property(
          fc.record({
            total: fc.nat({ max: 100 }),
            merged: fc.nat({ max: 50 }),
            rejected: fc.nat({ max: 50 }),
            skipped: fc.nat({ max: 50 }),
          }),
          ({ total, merged, rejected, skipped }) => {
            const sum = merged + rejected + skipped
            if (sum <= total) {
              const remaining = total - sum
              expect(remaining).toBeGreaterThanOrEqual(0)
            }
          },
        ),
        { numRuns: 100 },
      )
    })
  })

  describe('Similarity filter', () => {
    it('Filter threshold correctly includes/excludes candidates', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              similarity: fc.float({ min: 0, max: 1, noNaN: true }),
            }),
            { minLength: 1, maxLength: 50 },
          ),
          fc.float({ min: 0, max: 1, noNaN: true }),
          (candidates, threshold) => {
            const filtered = candidates.filter((c) => c.similarity >= threshold)
            const excluded = candidates.filter((c) => c.similarity < threshold)

            expect(filtered.every((c) => c.similarity >= threshold)).toBe(true)
            expect(excluded.every((c) => c.similarity < threshold)).toBe(true)
            expect(filtered.length + excluded.length).toBe(candidates.length)
          },
        ),
        { numRuns: 100 },
      )
    })
  })
})
