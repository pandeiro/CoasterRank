import { normalizeName } from './normalize'
import { jaroWinkler } from './similarity'

// Tiered matcher for spreadsheet-import rows against the coaster catalog.
//
//   1. exact      — normalized name matches exactly one entry
//   2. alias      — normalized name matches an entry's former/regional name
//   3. fuzzy      — Jaro-Winkler over names + aliases, auto-accepted only when
//                   unambiguous (clear margin) or when the sheet's park column
//                   pins exactly one agreeing candidate
//
// Everything else degrades to 'candidate' (top-N for the review UI) or 'none'.
// The matcher is deliberately park-context-aware but name-primary: park hints
// disambiguate ties, they never override a unique exact match.

export type CatalogEntry = {
  id: string
  name: string
  park?: string | null
  aliases?: readonly string[] | null
}

export type MatchInput = {
  name: string
  park?: string | null
}

export type MatchStatus = 'auto' | 'candidate' | 'none'
export type MatchReason = 'exact' | 'alias' | 'fuzzy'
export type MatchCandidate = { entry: CatalogEntry; score: number; via: 'name' | 'alias' }

export type MatchResult = {
  row: MatchInput
  status: MatchStatus
  /** Set only when status === 'auto'. */
  match: MatchCandidate | null
  /** Ranked best-first. For 'auto': runner-ups for display. For 'candidate': up to maxCandidates. */
  candidates: MatchCandidate[]
  reason: MatchReason | null
}

export type MatcherOptions = {
  /** Minimum fuzzy score for an automatic match. */
  autoFuzzyThreshold?: number
  /** Minimum fuzzy score to surface as a candidate at all. */
  fuzzyFloor?: number
  /** Required score gap over the runner-up for a parkless fuzzy auto-match. */
  autoFuzzyMargin?: number
  /** Max candidates returned for the review UI. */
  maxCandidates?: number
}

const DEFAULTS: Required<MatcherOptions> = {
  autoFuzzyThreshold: 0.9,
  fuzzyFloor: 0.82,
  autoFuzzyMargin: 0.02,
  maxCandidates: 5,
}

type IndexedEntry = {
  entry: CatalogEntry
  normName: string
  normAliases: string[]
  normPark: string
}

// Park agreement in two strictness tiers, applied in order:
//   strict — normalized equality or containment ("Islands of Adventure" ⊂
//            "Universal's Islands of Adventure"). Similar park names that
//            differ in exactly the discriminating token — "Six Flags Great
//            America" vs "Six Flags Great Adventure" — do NOT strictly agree.
//   fuzzy  — Jaro-Winkler fallback (sheet park typos), used only when strict
//            agreement found nothing, and kept at a high bar for the same
//            reason the strict tier refuses lookalike parks.
function parkStrictlyAgrees(hint: string, park: string): boolean {
  if (!hint || !park) return false
  return hint === park || park.includes(hint) || hint.includes(park)
}

const PARK_FUZZY_THRESHOLD = 0.9

function parkAgrees(hint: string, park: string): boolean {
  if (parkStrictlyAgrees(hint, park)) return true
  return jaroWinkler(hint, park) >= PARK_FUZZY_THRESHOLD
}

// Long-length-gap guard: fuzzy scoring a 3-char query against a 15-char name
// is noise ("Bat" vs "Batman The Ride" lands ~0.7 on JW); skip the pair. The
// 0.55 ratio stays loose enough that "Gwazi" still reaches "Iron Gwazi".
function lengthCompatible(a: string, b: string): boolean {
  const longer = Math.max(a.length, b.length)
  if (longer < 6) return true
  return Math.abs(a.length - b.length) <= 0.55 * longer
}

// Token-subset score for shortened-name patterns pure Jaro-Winkler misses
// ("Gwazi" → "Iron Gwazi"): when every ≥3-char token of the QUERY appears as a
// whole token of the entry name, the query is a short form of that ride.
// Scored just above the auto threshold so a UNIQUE subset match auto-accepts;
// ties degrade to candidates through the normal margin rule. Deliberately
// one-directional (query ⊆ entry, never entry ⊆ query): a pasted sentence
// like "Not A Real Coaster 123" contains the generic row "Coaster", and the
// reverse rule would auto-match it. Short fragments don't participate — "Bat"
// must not subset-match "Batman The Ride".
const TOKEN_SUBSET_SCORE = 0.92
const MIN_SUBSET_TOKEN_LENGTH = 3

function tokensOf(norm: string): string[] {
  return norm.split(' ').filter((t) => t.length >= MIN_SUBSET_TOKEN_LENGTH)
}

function tokenSubsetScore(norm: string, entryNorm: string): number | null {
  const queryTokens = tokensOf(norm)
  if (queryTokens.length === 0) return null
  const entryTokens = tokensOf(entryNorm)
  if (entryTokens.length === 0) return null
  if (queryTokens.every((t) => entryTokens.includes(t))) return TOKEN_SUBSET_SCORE
  return null
}

function scoreEntry(norm: string, indexed: IndexedEntry): { score: number; via: 'name' | 'alias' } {
  let best = { score: 0, via: 'name' as 'name' | 'alias' }
  const subset = tokenSubsetScore(norm, indexed.normName)
  if (subset !== null) best = { score: subset, via: 'name' }
  if (lengthCompatible(norm, indexed.normName)) {
    const s = jaroWinkler(norm, indexed.normName)
    if (s > best.score) best = { score: s, via: 'name' }
  }
  for (const alias of indexed.normAliases) {
    const aliasSubset = tokenSubsetScore(norm, alias)
    if (aliasSubset !== null && aliasSubset > best.score) best = { score: aliasSubset, via: 'alias' }
    if (!lengthCompatible(norm, alias)) continue
    const s = jaroWinkler(norm, alias)
    if (s > best.score) best = { score: s, via: 'alias' }
  }
  return best
}

export function createMatcher(catalog: readonly CatalogEntry[], options: MatcherOptions = {}) {
  const opts = { ...DEFAULTS, ...options }

  const byNormName = new Map<string, IndexedEntry[]>()
  const byNormAlias = new Map<string, IndexedEntry[]>()
  const index: IndexedEntry[] = catalog.map((entry) => {
    const indexed: IndexedEntry = {
      entry,
      normName: normalizeName(entry.name),
      normAliases: (entry.aliases ?? []).map(normalizeName).filter(Boolean),
      normPark: entry.park ? normalizeName(entry.park) : '',
    }
    if (indexed.normName) {
      const list = byNormName.get(indexed.normName)
      if (list) list.push(indexed)
      else byNormName.set(indexed.normName, [indexed])
    }
    for (const alias of indexed.normAliases) {
      const list = byNormAlias.get(alias)
      if (list) list.push(indexed)
      else byNormAlias.set(alias, [indexed])
    }
    return indexed
  })

  function autoFromTied(
    row: MatchInput,
    tied: IndexedEntry[],
    via: 'name' | 'alias',
    reason: 'exact' | 'alias',
    parkHint: string,
  ): MatchResult | null {
    if (tied.length === 0) return null
    if (tied.length === 1) {
      return {
        row,
        status: 'auto',
        match: { entry: tied[0]!.entry, score: 1, via },
        candidates: [],
        reason,
      }
    }
    // Multiple entries share the name — the park column (when present) picks.
    if (parkHint) {
      const agreeing = tied.filter((t) => parkStrictlyAgrees(parkHint, t.normPark))
      if (agreeing.length === 1) {
        return {
          row,
          status: 'auto',
          match: { entry: agreeing[0]!.entry, score: 1, via },
          candidates: tied
            .filter((t) => t !== agreeing[0])
            .map((t) => ({ entry: t.entry, score: 1, via })),
          reason,
        }
      }
    }
    return null
  }

  // Candidates for a same-name tie: entries agreeing with the park hint (when
  // given) lead, so the likely matches are on top even when capped.
  function tieCandidates(
    tied: IndexedEntry[],
    via: 'name' | 'alias',
    parkHint: string,
  ): MatchCandidate[] {
    const agreeing = parkHint ? tied.filter((t) => parkStrictlyAgrees(parkHint, t.normPark)) : []
    const rest = tied.filter((t) => !agreeing.includes(t))
    return [...agreeing, ...rest]
      .map((t) => ({ entry: t.entry, score: 1, via }))
      .slice(0, opts.maxCandidates)
  }

  function match(row: MatchInput): MatchResult {
    const norm = normalizeName(row.name)
    const parkHint = row.park ? normalizeName(row.park) : ''
    const base: MatchResult = { row, status: 'none', match: null, candidates: [], reason: null }

    if (!norm) return base

    // Tier 1: exact normalized name.
    const exacts = byNormName.get(norm)
    if (exacts) {
      const resolved = autoFromTied(row, exacts, 'name', 'exact', parkHint)
      if (resolved) return { ...resolved, row }
      return { ...base, status: 'candidate', candidates: tieCandidates(exacts, 'name', parkHint) }
    }

    // Tier 2: exact alias (former/regional name, e.g. "Intimidator 305").
    const aliasHits = byNormAlias.get(norm)
    if (aliasHits) {
      const resolved = autoFromTied(row, aliasHits, 'alias', 'alias', parkHint)
      if (resolved) return { ...resolved, row }
      return { ...base, status: 'candidate', candidates: tieCandidates(aliasHits, 'alias', parkHint) }
    }

    // Tier 3: fuzzy across names + aliases.
    const scored: { indexed: IndexedEntry; score: number; via: 'name' | 'alias' }[] = []
    for (const indexed of index) {
      const { score, via } = scoreEntry(norm, indexed)
      if (score >= opts.fuzzyFloor) scored.push({ indexed, score, via })
    }
    if (scored.length === 0) return base
    scored.sort(
      (a, b) => b.score - a.score || a.indexed.entry.name.localeCompare(b.indexed.entry.name),
    )
    const best = scored[0]!
    const second = scored[1]

    // Park hint present: one strictly-agreeing near-best candidate wins even
    // without a score margin; fuzzy park agreement only applies when strict
    // agreement found nothing at all.
    if (parkHint) {
      const strictAgreeing = scored.filter((s) => parkStrictlyAgrees(parkHint, s.indexed.normPark))
      const agreeing = strictAgreeing.length > 0
        ? strictAgreeing
        : scored.filter((s) => parkAgrees(parkHint, s.indexed.normPark))
      const nearBest = agreeing.filter((s) => s.score >= best.score - 0.08)
      if (nearBest.length === 1) {
        const winner = nearBest[0]!
        return {
          row,
          status: 'auto',
          match: { entry: winner.indexed.entry, score: winner.score, via: winner.via },
          candidates: scored
            .filter((s) => s.indexed !== winner.indexed)
            .slice(0, opts.maxCandidates)
            .map((s) => ({ entry: s.indexed.entry, score: s.score, via: s.via })),
          reason: 'fuzzy',
        }
      }
      return {
        ...base,
        status: 'candidate',
        candidates: scored.slice(0, opts.maxCandidates).map((s) => ({
          entry: s.indexed.entry,
          score: s.score,
          via: s.via,
        })),
      }
    }

    // No park hint: auto only with a clear margin over the runner-up.
    const marginOk = !second || best.score - second.score >= opts.autoFuzzyMargin
    if (best.score >= opts.autoFuzzyThreshold && marginOk) {
      return {
        row,
        status: 'auto',
        match: { entry: best.indexed.entry, score: best.score, via: best.via },
        candidates: scored
          .slice(1)
          .slice(0, opts.maxCandidates)
          .map((s) => ({ entry: s.indexed.entry, score: s.score, via: s.via })),
        reason: 'fuzzy',
      }
    }
    return {
      ...base,
      status: 'candidate',
      candidates: scored.slice(0, opts.maxCandidates).map((s) => ({
        entry: s.indexed.entry,
        score: s.score,
        via: s.via,
      })),
    }
  }

  return { match }
}

export function matchRows(
  catalog: readonly CatalogEntry[],
  rows: readonly MatchInput[],
  options: MatcherOptions = {},
): MatchResult[] {
  const matcher = createMatcher(catalog, options)
  return rows.map((row) => matcher.match(row))
}
