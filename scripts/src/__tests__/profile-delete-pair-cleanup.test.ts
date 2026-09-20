import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

interface UserPair {
  user_id: string
  winner: string
  loser: string
  weight: number
}

interface PairTotal {
  winner: string
  loser: string
  weight_sum: number
  wins: number
}

/**
 * Pure-JS model of the SQL trigger pair_cleanup_on_profile_delete():
 *
 * 1. Inspect public.user_pairs for user_id.
 * 2. Aggregate slice: group by (winner, loser) -> sum(weight), count(*).
 * 3. Update pair_totals with signed negative deltas.
 * 4. Delete rows where wins <= 0.
 * 5. Delete user_pairs slice.
 */
function applyProfileDeleteTrigger(
  userId: string,
  userPairs: UserPair[],
  pairTotals: Map<string, PairTotal>,
): {
  remainingUserPairs: UserPair[]
  updatedPairTotals: Map<string, PairTotal>
} {
  const userSlice = userPairs.filter((p) => p.user_id === userId)
  if (userSlice.length === 0) {
    return {
      remainingUserPairs: [...userPairs],
      updatedPairTotals: new Map(pairTotals),
    }
  }

  // Aggregate user slice by (winner, loser)
  const deltas = new Map<string, { winner: string; loser: string; weight: number; count: number }>()
  for (const p of userSlice) {
    const key = `${p.winner}->${p.loser}`
    const existing = deltas.get(key)
    if (existing) {
      existing.weight += p.weight
      existing.count += 1
    } else {
      deltas.set(key, { winner: p.winner, loser: p.loser, weight: p.weight, count: 1 })
    }
  }

  // Apply negative deltas to pair_totals
  const nextTotals = new Map(pairTotals)
  for (const [key, delta] of deltas.entries()) {
    const total = nextTotals.get(key)
    if (total) {
      total.weight_sum -= delta.weight
      total.wins -= delta.count
      if (total.wins <= 0) {
        nextTotals.delete(key)
      }
    }
  }

  const remainingUserPairs = userPairs.filter((p) => p.user_id !== userId)
  return { remainingUserPairs, updatedPairTotals: nextTotals }
}

describe('profile delete pair cleanup logic', () => {
  it('cleans up single-user pair totals completely leaving no ghost rankings', () => {
    const userPairs: UserPair[] = [
      { user_id: 'u1', winner: 'c1', loser: 'c2', weight: 0.125 },
      { user_id: 'u1', winner: 'c1', loser: 'c3', weight: 0.125 },
      { user_id: 'u1', winner: 'c2', loser: 'c3', weight: 0.125 },
    ]

    const pairTotals = new Map<string, PairTotal>([
      ['c1->c2', { winner: 'c1', loser: 'c2', weight_sum: 0.125, wins: 1 }],
      ['c1->c3', { winner: 'c1', loser: 'c3', weight_sum: 0.125, wins: 1 }],
      ['c2->c3', { winner: 'c2', loser: 'c3', weight_sum: 0.125, wins: 1 }],
    ])

    const { remainingUserPairs, updatedPairTotals } = applyProfileDeleteTrigger(
      'u1',
      userPairs,
      pairTotals,
    )

    expect(remainingUserPairs).toEqual([])
    expect(updatedPairTotals.size).toBe(0)
  })

  it('preserves other users contributions when one user is removed', () => {
    const userPairs: UserPair[] = [
      { user_id: 'u1', winner: 'c1', loser: 'c2', weight: 0.125 },
      { user_id: 'u1', winner: 'c2', loser: 'c3', weight: 0.125 },
      { user_id: 'u2', winner: 'c1', loser: 'c2', weight: 0.2 },
      { user_id: 'u2', winner: 'c3', loser: 'c1', weight: 0.2 },
    ]

    const pairTotals = new Map<string, PairTotal>([
      ['c1->c2', { winner: 'c1', loser: 'c2', weight_sum: 0.325, wins: 2 }],
      ['c2->c3', { winner: 'c2', loser: 'c3', weight_sum: 0.125, wins: 1 }],
      ['c3->c1', { winner: 'c3', loser: 'c1', weight_sum: 0.2, wins: 1 }],
    ])

    const { remainingUserPairs, updatedPairTotals } = applyProfileDeleteTrigger(
      'u1',
      userPairs,
      pairTotals,
    )

    expect(remainingUserPairs).toHaveLength(2)
    expect(remainingUserPairs.every((p) => p.user_id === 'u2')).toBe(true)

    // c1->c2 had 2 wins, now has 1 win with weight 0.2 (u2's contribution only)
    const c1c2 = updatedPairTotals.get('c1->c2')
    expect(c1c2).toBeDefined()
    expect(c1c2?.wins).toBe(1)
    expect(c1c2?.weight_sum).toBeCloseTo(0.2)

    // c2->c3 only had u1, so it must be deleted (no ghost rankings)
    expect(updatedPairTotals.has('c2->c3')).toBe(false)

    // c3->c1 only had u2, untouched
    const c3c1 = updatedPairTotals.get('c3->c1')
    expect(c3c1).toBeDefined()
    expect(c3c1?.wins).toBe(1)
    expect(c3c1?.weight_sum).toBeCloseTo(0.2)
  })

  it('is a no-op if deleted user has no pairs', () => {
    const userPairs: UserPair[] = [{ user_id: 'u2', winner: 'c1', loser: 'c2', weight: 0.2 }]
    const pairTotals = new Map<string, PairTotal>([
      ['c1->c2', { winner: 'c1', loser: 'c2', weight_sum: 0.2, wins: 1 }],
    ])

    const { remainingUserPairs, updatedPairTotals } = applyProfileDeleteTrigger(
      'u1', // u1 has no pairs
      userPairs,
      pairTotals,
    )

    expect(remainingUserPairs).toHaveLength(1)
    expect(updatedPairTotals.size).toBe(1)
    expect(updatedPairTotals.get('c1->c2')?.wins).toBe(1)
  })

  it('eliminates floating point residue via wins <= 0 integer check', () => {
    // 0.1 + 0.2 - 0.1 - 0.2 in JS float math can leave 2.7755575615628914e-17
    const userPairs: UserPair[] = [{ user_id: 'u1', winner: 'c1', loser: 'c2', weight: 0.1 }]
    const pairTotals = new Map<string, PairTotal>([
      ['c1->c2', { winner: 'c1', loser: 'c2', weight_sum: 0.1, wins: 1 }],
    ])

    const { updatedPairTotals } = applyProfileDeleteTrigger('u1', userPairs, pairTotals)
    expect(updatedPairTotals.has('c1->c2')).toBe(false)
  })
})

describe('migration file integrity', () => {
  it('contains the expected BEFORE DELETE trigger and security definer function', () => {
    const migrationPath = join(
      __dirname,
      '../../../supabase/migrations/20260919170648_profile_delete_pair_totals.sql',
    )
    const sql = readFileSync(migrationPath, 'utf8')

    expect(sql).toContain('create or replace function public.pair_cleanup_on_profile_delete()')
    expect(sql).toContain('security definer')
    expect(sql).toContain('set search_path = public')
    expect(sql).toContain('before delete on public.profiles')
    expect(sql).toContain('for each row')
    expect(sql).toContain('execute function public.pair_cleanup_on_profile_delete()')
    expect(sql).toContain('delete from public.pair_totals where wins <= 0')
    expect(sql).toContain('delete from public.user_pairs where user_id = old.id')
    expect(sql).toContain('delete from public.pair_dirty_users where user_id = old.id')
    expect(sql).toContain('delete from public.pair_user_state where user_id = old.id')
    expect(sql).toContain('create or replace function public.pair_mark_dirty_delete()')
    expect(sql).toContain('exists (select 1 from public.profiles p where p.id = old_rides.user_id)')
  })
})
