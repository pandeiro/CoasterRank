import { describe, expect, it } from 'vitest'
import { normalizeName } from './normalize'

describe('normalizeName', () => {
  it('lowercases and collapses whitespace', () => {
    expect(normalizeName('  Fury   325 ')).toBe('fury 325')
  })

  it('strips diacritics', () => {
    expect(normalizeName('Café Büchschen')).toBe('cafe buchschen')
    expect(normalizeName('Montaña Española')).toBe('montana espanola')
  })

  it('removes punctuation including apostrophes and colons', () => {
    expect(normalizeName("Montezooma's Revenge")).toBe('montezoomas revenge')
    expect(normalizeName('Batman: The Ride')).toBe('batman the ride')
    expect(normalizeName('Mr. Freeze')).toBe('mr freeze')
  })

  it('normalizes ampersands to "and"', () => {
    expect(normalizeName('Rock & Roller')).toBe('rock and roller')
    expect(normalizeName('Rock and Roller')).toBe('rock and roller')
  })

  it('strips the leading article only', () => {
    expect(normalizeName('The Beast')).toBe('beast')
    expect(normalizeName('Legend of the Wolves')).toBe('legend of the wolves')
    expect(normalizeName('They')).toBe('they')
  })

  it('strips parenthesized year disambiguators', () => {
    expect(normalizeName('Big Dipper (1935)')).toBe('big dipper')
    expect(normalizeName('Roller Coaster (1927)')).toBe('roller coaster')
    // A non-year parenthetical stays — it can be meaningful context.
    expect(normalizeName('Gwazi (Tiger)')).toBe('gwazi tiger')
  })

  it('returns an empty string for punctuation-only input', () => {
    expect(normalizeName(' !!! ')).toBe('')
    expect(normalizeName('')).toBe('')
  })
})
