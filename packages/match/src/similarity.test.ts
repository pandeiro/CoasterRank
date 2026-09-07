import { describe, expect, it } from 'vitest'
import { jaroWinkler } from './similarity'

// Canonical Jaro-Winkler vectors from the literature (Winkler 1990; used as
// stable fixtures across implementations). Rounded to 4 decimals.
describe('jaroWinkler', () => {
  const cases: [string, string, number][] = [
    ['MARTHA', 'MARHTA', 0.9611],
    ['DIXON', 'DICKSONX', 0.8133],
    ['DWAYNE', 'DUANE', 0.84],
    ['JONES', 'JOHNSON', 0.8324],
    // No common prefix → Winkler boost is a no-op; this is the pure-Jaro value.
    ['ABCVWXYZ', 'CABVWXYZ', 0.9375],
  ]

  for (const [a, b, expected] of cases) {
    it(`scores ${a} vs ${b} as ~${expected}`, () => {
      expect(jaroWinkler(a, b)).toBeCloseTo(expected, 3)
      // Symmetry.
      expect(jaroWinkler(b, a)).toBeCloseTo(expected, 3)
    })
  }

  it('is 1 for identical strings and 0 for disjoint ones', () => {
    expect(jaroWinkler('fury 325', 'fury 325')).toBe(1)
    expect(jaroWinkler('abc', 'xyz')).toBe(0)
    expect(jaroWinkler('', 'abc')).toBe(0)
  })

  it('rewards shared prefixes (the typo case import matching relies on)', () => {
    const typo = jaroWinkler('fury 352', 'fury 325')
    const transposed = jaroWinkler('furry 325', 'fury 325')
    expect(typo).toBeGreaterThan(0.95)
    expect(transposed).toBeGreaterThan(0.9)
  })
})
