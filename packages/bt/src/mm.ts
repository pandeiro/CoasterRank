/**
 * Bradley-Terry latent-strength fitting via the MM (minorize-maximize)
 * algorithm. See PLAN §5.2 and Hunter, D.R. (2004), "MM algorithms for
 * generalized Bradley-Terry models", The American Statistician 58(4).
 *
 * Pure TypeScript with zero imports: it runs identically under Vitest (Node)
 * and inside the Deno Edge Function, which imports this file directly via a
 * relative path.
 *
 * The model: each coaster i has a positive strength p_i, and
 * P(i beats j) = p_i / (p_i + p_j). Given aggregated (weighted) pairwise win
 * counts, strengths are fit by the simultaneous fixed-point update
 *
 *   p_i <- (W_i + a/2 + λ) / ( Σ_j n_ij / (p_i + p_j) + a / (p_i + 1) + λ )
 *
 * where W_i is i's total weighted wins, n_ij the total weighted comparisons
 * between i and j (both directions), and the two regularization terms are the
 * anti-noise measures from PLAN §5.3:
 *
 *   - a = anchorWeight: virtual comparisons against a synthetic "average"
 *     coaster of fixed strength 1 (half won, half lost). This anchors the
 *     scale (1.0 = average), keeps undefeated / rarely-compared coasters from
 *     running to infinity, and means a coaster with no comparisons would sit
 *     exactly at 1.0.
 *   - λ = l2: pseudo-win/loss counts pulling every score toward the anchor
 *     strength 1.0 — the Gamma-prior equivalent of L2 shrinkage (with the
 *     anchor fixing the scale, shrinking "toward the mean" is toward 1.0).
 *
 * Without regularization (a = λ = 0) this reduces exactly to the MM iteration
 * for the Bradley-Terry MLE, which monotonically increases the likelihood.
 */

export type Pair = {
  /** Coaster that won every aggregated comparison in this pair. */
  winner: string
  /** Coaster that lost. */
  loser: string
  /**
   * Normalized weight of these wins (PLAN §5.1): a user with n ranked coasters
   * contributes n*(n-1)/2 pairs at weight 1/(n*(n-1)/2) each, so every user's
   * total influence sums to ~1 regardless of list length. Feeds the fit.
   */
  weight: number
  /** Raw win count (diagnostic; integer). */
  wins: number
  /** Raw comparison count between the pair (diagnostic; integer). */
  comparisons: number
}

export type RankingRow = {
  coasterId: string
  /** Fitted strength; 1.0 = "average" given the anchor (see above). */
  score: number
  /** Raw comparisons involving this coaster (both directions). */
  comparisons: number
  /** Raw wins by this coaster. */
  wins: number
}

export type MMOptions = {
  /** Total virtual comparisons vs the average anchor, split 50/50 win/loss. */
  anchorWeight: number
  /** Pseudo-count strength pulling scores toward 1.0. */
  l2: number
  /** Convergence threshold on the max per-item |Δ log score| per iteration. */
  epsilon: number
  /** Hard cap on iterations (guards against slow divergence on odd data). */
  maxIterations: number
}

export const DEFAULT_MM_OPTIONS: MMOptions = {
  anchorWeight: 1,
  l2: 0.5,
  epsilon: 1e-8,
  maxIterations: 500,
}

export type MMResult = {
  /** All coasters that appeared in any pair, sorted by score descending. */
  rows: RankingRow[]
  /** Iterations actually run (0 for empty input). */
  iterations: number
  /** True if the max-delta fell below epsilon before maxIterations. */
  converged: boolean
}

// Keeps the iteration strictly positive even if both regularizers are zeroed
// out and a coaster has no wins (guards the divisions below).
const MIN_SCORE = 1e-12

export function computeRankings(
  pairs: Pair[],
  options: Partial<MMOptions> = {},
): MMResult {
  const opts = { ...DEFAULT_MM_OPTIONS, ...options }

  // Aggregate into sparse structures: total weighted wins per coaster, and
  // per-coaster opponent -> total weighted comparisons (n_ij, both directions).
  const winsWeight = new Map<string, number>()
  const opponents = new Map<string, Map<string, number>>()
  const rawWins = new Map<string, number>()
  const rawComparisons = new Map<string, number>()

  function bump(map: Map<string, number>, id: string, by: number) {
    map.set(id, (map.get(id) ?? 0) + by)
  }

  for (const pair of pairs) {
    const { winner, loser, weight } = pair
    if (weight <= 0) continue
    bump(winsWeight, winner, weight)
    if (!winsWeight.has(loser)) winsWeight.set(loser, 0)
    let byWinner = opponents.get(winner)
    if (!byWinner) {
      byWinner = new Map()
      opponents.set(winner, byWinner)
    }
    byWinner.set(loser, (byWinner.get(loser) ?? 0) + weight)
    let byLoser = opponents.get(loser)
    if (!byLoser) {
      byLoser = new Map()
      opponents.set(loser, byLoser)
    }
    byLoser.set(winner, (byLoser.get(winner) ?? 0) + weight)
    bump(rawWins, winner, pair.wins)
    bump(rawComparisons, winner, pair.comparisons)
    bump(rawComparisons, loser, pair.comparisons)
  }

  const ids = [...opponents.keys()]
  if (ids.length === 0) {
    return { rows: [], iterations: 0, converged: true }
  }

  let scores = new Map<string, number>(ids.map((id) => [id, 1]))
  let converged = false
  let iterations = 0

  while (iterations < opts.maxIterations) {
    iterations += 1
    const next = new Map<string, number>()
    let maxDelta = 0

    for (const id of ids) {
      const p = scores.get(id)!
      const numerator = (winsWeight.get(id) ?? 0) + opts.anchorWeight / 2 + opts.l2
      let denominator = opts.l2 + opts.anchorWeight / (p + 1)
      for (const [otherId, n] of opponents.get(id)!) {
        denominator += n / (p + scores.get(otherId)!)
      }
      const updated = Math.max(numerator / denominator, MIN_SCORE)
      next.set(id, updated)
      const delta = Math.abs(Math.log(updated / p))
      if (delta > maxDelta) maxDelta = delta
    }

    scores = next
    if (maxDelta < opts.epsilon) {
      converged = true
      break
    }
  }

  const rows = ids
    .map((id) => ({
      coasterId: id,
      score: scores.get(id)!,
      comparisons: rawComparisons.get(id) ?? 0,
      wins: rawWins.get(id) ?? 0,
    }))
    .sort((a, b) => b.score - a.score)

  return { rows, iterations, converged }
}
