import { describe, expect, it } from 'vitest'
import { createMatcher, type CatalogEntry } from './match'
import { GOLDEN_CASES } from '../fixtures/golden'
import catalogJson from '../fixtures/catalog.json'

// Frozen snapshot of the real production catalog (coasters + parks + aliases,
// exported 2026-09). All golden expectations are calibrated against it; see
// fixtures/golden.ts for the per-case rationale.
const catalog = catalogJson as unknown as CatalogEntry[]

describe('golden import matching (real catalog fixture)', () => {
  const matcher = createMatcher(catalog)

  for (const golden of GOLDEN_CASES) {
    const label = JSON.stringify(golden.name) + (golden.park ? ` @ ${golden.park}` : '')
    it(`matches ${label}`, () => {
      const result = matcher.match({ name: golden.name, park: golden.park })
      expect(result.status).toBe(golden.status)
      if (golden.status === 'auto') {
        expect(result.match, label).not.toBeNull()
        expect(result.match!.entry.id).toBe(golden.id)
        expect(result.reason).toBe(golden.reason)
      } else {
        expect(result.match, label).toBeNull()
      }
      if (golden.candidateIds) {
        const ids = result.candidates.map((c) => c.entry.id)
        for (const required of golden.candidateIds) {
          expect(ids, `${label}: expected ${required} among candidates`).toContain(required)
        }
      }
      if (golden.candidateCount !== undefined) {
        expect(result.candidates, label).toHaveLength(golden.candidateCount)
      }
    })
  }

  it('auto-resolves a healthy share of the golden set', () => {
    const statuses = GOLDEN_CASES.map((g) => matcher.match({ name: g.name, park: g.park }).status)
    const autos = statuses.filter((s) => s === 'auto').length
    const nones = statuses.filter((s) => s === 'none').length
    // Every case above hand-asserts its exact outcome; these aggregates guard
    // against a future fixture regeneration silently shifting the mix.
    expect(autos).toBeGreaterThanOrEqual(30)
    expect(nones).toBeLessThanOrEqual(4)
  })
})
