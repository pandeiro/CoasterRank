import { describe, expect, it } from 'vitest'
import { createMatcher, matchRows, type CatalogEntry } from './match'

// Mini catalog exercising every tier with hand-derivable outcomes. Mirrors the
// structural traps in the real catalog: same-name coasters across parks,
// renamed coasters with aliases, and year-suffix disambiguators.
const CATALOG: CatalogEntry[] = [
  { id: 'bat-sfgam', name: 'Batman: The Ride', park: 'Six Flags Great America' },
  { id: 'bat-sfgadv', name: 'Batman: The Ride', park: 'Six Flags Great Adventure' },
  { id: 'bat-sfmm', name: 'Batman: The Ride', park: 'Six Flags Magic Mountain' },
  { id: 'pantherian', name: 'Pantherian', park: 'Kings Dominion', aliases: ['Intimidator 305', 'I305'] },
  { id: 'tt2', name: 'Top Thrill 2', park: 'Cedar Point', aliases: ['Top Thrill Dragster'] },
  { id: 'beast', name: 'The Beast', park: 'Kings Island' },
  { id: 'big-dipper', name: 'Big Dipper (1935)', park: 'Luna Park Sydney' },
  { id: 'fury', name: 'Fury 325', park: 'Carowinds' },
  { id: 'el-toro', name: 'El Toro', park: 'Six Flags Great Adventure' },
  { id: 'iron-gwazi', name: 'Iron Gwazi', park: 'Busch Gardens Tampa Bay' },
  { id: 'hippogriff-japan', name: 'Flight of the Hippogriff', park: 'Universal Studios Japan' },
  { id: 'hippogriff-ioa', name: 'Flight of the Hippogriff', park: "Universal's Islands of Adventure" },
]

describe('createMatcher', () => {
  it('auto-matches a unique exact name (case/punctuation-insensitive)', () => {
    const matcher = createMatcher(CATALOG)
    for (const input of ['Fury 325', 'fury 325', '  Fury   325!']) {
      const result = matcher.match({ name: input })
      expect(result.status).toBe('auto')
      expect(result.match?.entry.id).toBe('fury')
      expect(result.reason).toBe('exact')
      expect(result.candidates).toHaveLength(0)
    }
  })

  it('strips the leading article on both sides', () => {
    const result = createMatcher(CATALOG).match({ name: 'The Beast' })
    expect(result.status).toBe('auto')
    expect(result.match?.entry.id).toBe('beast')
  })

  it('strips year disambiguators so "Big Dipper" matches "Big Dipper (1935)"', () => {
    const result = createMatcher(CATALOG).match({ name: 'Big Dipper' })
    expect(result.status).toBe('auto')
    expect(result.match?.entry.id).toBe('big-dipper')
  })

  it('auto-matches an alias to the renamed coaster', () => {
    const result = createMatcher(CATALOG).match({ name: 'Intimidator 305' })
    expect(result.status).toBe('auto')
    expect(result.match?.entry.id).toBe('pantherian')
    expect(result.reason).toBe('alias')
    expect(result.match?.via).toBe('alias')
  })

  it('disambiguates same-name coasters with a strict park match', () => {
    const result = createMatcher(CATALOG).match({
      name: 'Batman: The Ride',
      park: 'Six Flags Great Adventure',
    })
    expect(result.status).toBe('auto')
    expect(result.match?.entry.id).toBe('bat-sfgadv')
    // Runner-ups stay visible for the UI.
    expect(result.candidates.map((c) => c.entry.id)).toContain('bat-sfgam')
  })

  it('park containment matches abbreviated hints', () => {
    const result = createMatcher(CATALOG).match({
      name: 'Batman: The Ride',
      park: 'Great Adventure',
    })
    expect(result.status).toBe('auto')
    expect(result.match?.entry.id).toBe('bat-sfgadv')
  })

  it('refuses to auto-pick among same-name coasters without a park hint', () => {
    const result = createMatcher(CATALOG).match({ name: 'Batman: The Ride' })
    expect(result.status).toBe('candidate')
    expect(result.match).toBeNull()
    expect(result.candidates).toHaveLength(3)
    expect(result.candidates.map((c) => c.entry.id)).toContain('bat-sfgam')
  })

  it('returns candidates (not auto) when the park hint contradicts every exact match', () => {
    const result = createMatcher(CATALOG).match({
      name: 'Batman: The Ride',
      park: 'Kings Island',
    })
    expect(result.status).toBe('candidate')
  })

  it('auto-matches a typo with a clear margin over the runner-up', () => {
    const result = createMatcher(CATALOG).match({ name: 'Furry 325' })
    expect(result.status).toBe('auto')
    expect(result.match?.entry.id).toBe('fury')
    expect(result.reason).toBe('fuzzy')
  })

  it('demotes near-tie typos to candidates', () => {
    // "Batman: The Rid" is ~equally close to all three Batman rides; no park
    // hint, no margin.
    const result = createMatcher(CATALOG).match({ name: 'Batman: The Rid' })
    expect(result.status).toBe('candidate')
    expect(result.candidates.length).toBeGreaterThan(0)
  })

  it('uses a fuzzy park match as a last resort for typoed parks', () => {
    const result = createMatcher(CATALOG).match({
      name: 'Flight of the Hippogrif',
      park: 'Universl Studios Japan',
    })
    expect(result.status).toBe('auto')
    expect(result.match?.entry.id).toBe('hippogriff-japan')
  })

  it('keeps lookalike park names from forcing a wrong auto-match', () => {
    // "Great America" strictly contains into SFGAm but the fuzzy fallback must
    // not also grab "Great Adventure"; more importantly the WRONG hint must
    // not auto-resolve either.
    const wrong = createMatcher(CATALOG).match({
      name: 'Flight of the Hippogrif',
      park: 'Kings Island',
    })
    expect(wrong.status).toBe('candidate')
  })

  it('does not fuzzy-match a short fragment onto a long name', () => {
    const result = createMatcher(CATALOG).match({ name: 'Bat' })
    expect(result.status).toBe('none')
  })

  it('returns none for empty or punctuation-only names', () => {
    const matcher = createMatcher(CATALOG)
    expect(matcher.match({ name: '' }).status).toBe('none')
    expect(matcher.match({ name: ' !!! ' }).status).toBe('none')
    expect(matcher.match({ name: 'zzqqxx wubbly' }).status).toBe('none')
  })

  it('surfacing candidates caps at maxCandidates, ranked best-first', () => {
    const matcher = createMatcher(CATALOG, { maxCandidates: 2 })
    const result = matcher.match({ name: 'Batman: The Ride' })
    expect(result.candidates).toHaveLength(2)
  })

  it('prefers alias hits over fuzzy name hits', () => {
    const result = createMatcher(CATALOG).match({ name: 'Top Thrill Dragster' })
    expect(result.status).toBe('auto')
    expect(result.match?.entry.id).toBe('tt2')
    expect(result.reason).toBe('alias')
  })

  it('auto-matches rename/qualifier patterns via whole-token subsets', () => {
    // "Gwazi" is the retired name of Iron Gwazi (not an alias row); JW alone
    // scores it ~0.53 because the "Iron " prefix shifts every char out of the
    // match window. The token-subset scorer exists for exactly this shape.
    const gwazi = createMatcher(CATALOG).match({ name: 'Gwazi' })
    expect(gwazi.status).toBe('auto')
    expect(gwazi.match?.entry.id).toBe('iron-gwazi')
    expect(gwazi.reason).toBe('fuzzy')
  })

  it('does not subset-match sentences that merely contain a generic row name', () => {
    const result = createMatcher(CATALOG).match({ name: 'Not A Real Coaster 123' })
    expect(result.status).toBe('none')
  })

  it('demotes subset ties to candidates', () => {
    // Two entries contain the token "hippogriff" only via full names; a
    // one-token query that subsets multiple entries can't auto-resolve.
    const result = createMatcher(CATALOG).match({ name: 'Hippogriff' })
    expect(result.status).toBe('candidate')
  })

  it('never lets short fragments ride the subset rule', () => {
    expect(createMatcher(CATALOG).match({ name: 'Bat' }).status).toBe('none')
  })

  it('matchRows maps every row and preserves order', () => {
    const results = matchRows(CATALOG, [
      { name: 'El Toro' },
      { name: 'Iron Gwazy' },
      { name: '????' },
    ])
    expect(results).toHaveLength(3)
    expect(results[0]!.match?.entry.id).toBe('el-toro')
    expect(results[1]!.match?.entry.id).toBe('iron-gwazi')
    expect(results[2]!.status).toBe('none')
  })
})
