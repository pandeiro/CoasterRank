// Jaro-Winkler string similarity. Chosen over Levenshtein/Dice because
// coaster-name typos ("Furry 325" → "Fury 325") share long prefixes, which is
// exactly what the Winkler boost rewards, and the classic vectors are stable
// public test fixtures. No dependencies, no allocation-heavy DP table.

function jaro(a: string, b: string): number {
  if (a === b) return 1
  const aLen = a.length
  const bLen = b.length
  if (aLen === 0 || bLen === 0) return 0

  // Match window: floor(max(len)/2) - 1, at least 0.
  const window = Math.max(0, Math.floor(Math.max(aLen, bLen) / 2) - 1)

  const aMatched = new Array<boolean>(aLen).fill(false)
  const bMatched = new Array<boolean>(bLen).fill(false)
  let matches = 0

  for (let i = 0; i < aLen; i++) {
    const lo = Math.max(0, i - window)
    const hi = Math.min(i + window + 1, bLen)
    for (let j = lo; j < hi; j++) {
      if (!bMatched[j] && a[i] === b[j]) {
        aMatched[i] = true
        bMatched[j] = true
        matches++
        break
      }
    }
  }
  if (matches === 0) return 0

  // Half-transpositions among matched characters.
  let transpositions = 0
  let k = 0
  for (let i = 0; i < aLen; i++) {
    if (!aMatched[i]) continue
    while (!bMatched[k]) k++
    if (a[i] !== b[k]) transpositions++
    k++
  }
  transpositions /= 2

  return (matches / aLen + matches / bLen + (matches - transpositions) / matches) / 3
}

const WINKLER_BOOST_THRESHOLD = 0.7
const WINKLER_PREFIX_SCALE = 0.1
const WINKLER_MAX_PREFIX = 4

export function jaroWinkler(a: string, b: string): number {
  const base = jaro(a, b)
  if (base <= WINKLER_BOOST_THRESHOLD) return base
  let prefix = 0
  const max = Math.min(WINKLER_MAX_PREFIX, a.length, b.length)
  while (prefix < max && a[prefix] === b[prefix]) prefix++
  return base + prefix * WINKLER_PREFIX_SCALE * (1 - base)
}
