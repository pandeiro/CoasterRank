import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { normalizeName } from '../oneoff/normalize-names.js'

describe('normalizeName', () => {
  it('strips trailing parenthesized text', () => {
    expect(normalizeName('Loop the Loop (Coney Island)').cleaned).toBe('Loop the Loop')
    expect(normalizeName('Montu (roller coaster)').cleaned).toBe('Montu')
    expect(normalizeName('Big Dipper (Blackpool Pleasure Beach)').cleaned).toBe('Big Dipper')
  })

  it('preserves names without parentheses', () => {
    expect(normalizeName('Fury 325').cleaned).toBe('Fury 325')
    expect(normalizeName('Steel Vengeance').cleaned).toBe('Steel Vengeance')
    expect(normalizeName('El Toro').cleaned).toBe('El Toro')
  })

  it('strips all trailing parenthesized text (greedy)', () => {
    // Greedy match strips from first ( to last )
    expect(normalizeName('Name (first) (second)').cleaned).toBe('Name')
  })

  it('handles leading/trailing whitespace', () => {
    expect(normalizeName('  Name (Park)  ').cleaned).toBe('Name')
    expect(normalizeName('Name  (Park)').cleaned).toBe('Name')
  })

  it('reports changed correctly', () => {
    expect(normalizeName('Name (Park)').changed).toBe(true)
    expect(normalizeName('Name').changed).toBe(false)
  })

  it('does not strip parentheses in the middle of a name', () => {
    // Only strips trailing parens, not embedded ones
    expect(normalizeName('Space Mountain (Disney)').cleaned).toBe('Space Mountain')
    expect(normalizeName("Rock 'n' Roller Coaster").cleaned).toBe("Rock 'n' Roller Coaster")
  })

  // Property: if name has trailing parens, cleaned name is shorter
  it('cleaned name is always <= original length', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 100 }), (name) => {
        const { cleaned } = normalizeName(name)
        expect(cleaned.length).toBeLessThanOrEqual(name.length)
      }),
      { numRuns: 100 },
    )
  })

  // Property: if no parens, name is unchanged
  it('names without parentheses are unchanged', () => {
    fc.assert(
      fc.property(
        fc
          .string({ minLength: 1, maxLength: 50 })
          .filter((s) => !s.includes('(') && s.trim().length > 0),
        (name) => {
          const { cleaned, changed } = normalizeName(name)
          expect(cleaned).toBe(name.trim())
          expect(changed).toBe(cleaned !== name)
        },
      ),
      { numRuns: 100 },
    )
  })

  // Property: idempotency — running twice gives same result
  it('normalization is idempotent', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 100 }), (name) => {
        const first = normalizeName(name)
        const second = normalizeName(first.cleaned)
        expect(second.cleaned).toBe(first.cleaned)
        expect(second.changed).toBe(false)
      }),
      { numRuns: 100 },
    )
  })
})
