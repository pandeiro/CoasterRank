// Name normalization for the import matcher. Both sides of every comparison
// (catalog entry and pasted row) go through the same transform, so the match
// never depends on how a park or operator wrote the name:
//
//   "MonteZOOMa's Revenge!"  → "montezoomas revenge"
//   "Batman: The Ride"       → "batman the ride"
//   "Gwazi® (Tiger side)"    → "gwazi tiger side"
//   "Café    Büchschen"      → "cafe buchschen"
//
// Leading "the " is stripped AFTER punctuation collapse: catalog-internal
// disambiguators like "The Bat" and a hypothetical "Bat" both normalize to
// "bat", which correctly turns them into competing candidates instead of
// silently hiding one behind article pedantry.

export function normalizeName(raw: string): string {
  return (
    raw
      .normalize('NFKD')
      // Strip combining marks (é → e) after NFKD decomposition.
      .replace(/\p{M}+/gu, '')
      .toLowerCase()
      // "&" normalizes to "and" so "B&M" style names compare like the words.
      .replace(/&/g, ' and ')
      // Apostrophes glue possessives ("Dragon's Fury" → "dragons fury")
      // instead of splitting it into two words.
      .replace(/[''\u2018\u2019\u00B4\u02BC]/g, '')
      // Catalog uses "(1935)"-style year suffixes to disambiguate same-name
      // coasters; spreadsheets virtually never carry them.
      .replace(/\(\s*\d{4}\s*\)/g, ' ')
      // Everything non-alphanumeric (apostrophes, colons, dashes, dots)
      // becomes a single space.
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ')
      // Leading article, only as a whole word.
      .replace(/^the /, '')
  )
}
