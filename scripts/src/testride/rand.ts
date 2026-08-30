// Deterministic PRNG (mulberry32) so seeded data is reproducible:
// the same --seed + --users always produces the same users/rides, making
// re-runs idempotent and benchmark runs comparable.

export interface Rng {
  float: () => number
  int: (min: number, max: number) => number
  pick: <T>(arr: readonly T[]) => T
  shuffle: <T>(arr: readonly T[]) => T[]
}

export function makeRng(seed: number): Rng {
  let a = seed >>> 0
  const next = (): number => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const int = (min: number, max: number): number => min + Math.floor(next() * (max - min + 1))
  return {
    float: next,
    int,
    pick: <T>(arr: readonly T[]): T => {
      if (arr.length === 0) throw new Error('pick() from empty array')
      return arr[int(0, arr.length - 1)] as T
    },
    shuffle: <T>(arr: readonly T[]): T[] => {
      const out = [...arr]
      for (let i = out.length - 1; i > 0; i--) {
        const j = int(0, i)
        const tmp = out[i] as T
        out[i] = out[j] as T
        out[j] = tmp
      }
      return out
    },
  }
}
