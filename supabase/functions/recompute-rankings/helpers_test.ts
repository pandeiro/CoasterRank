// Unit tests for the recompute-rankings pure helpers.
// Run: `deno test supabase/functions/recompute-rankings/helpers_test.ts`
// (dependency-free: plain Deno.test + throws, no network imports).
import {
  backoffDelayMs,
  computeParity,
  drainPages,
  estimatePayloadBytes,
  isRetryableRpcError,
  isStatementTimeoutMessage,
  PARITY_DELTA_THRESHOLD,
  parityOk,
  parseFitMode,
  shouldSkipRecompute,
} from './helpers.ts'

function assertEquals<T>(actual: T, expected: T, msg: string): void {
  if (actual !== expected) {
    throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

Deno.test('isRetryableRpcError retries clock-drift PGRST303', () => {
  assertEquals(isRetryableRpcError({ code: 'PGRST303', message: 'xx' }), true, 'PGRST303')
})

Deno.test('isRetryableRpcError retries 504 in all observed shapes', () => {
  assertEquals(isRetryableRpcError({ code: 'PGRST504', message: 'xx' }), true, 'PGRST504 code')
  assertEquals(isRetryableRpcError({ status: 504, message: 'xx' }), true, 'numeric status')
  assertEquals(isRetryableRpcError({ message: 'Gateway Timeout' }), true, 'bare message')
  assertEquals(isRetryableRpcError({ message: 'HTTP 504 from upstream' }), true, '504 in text')
  assertEquals(isRetryableRpcError({ message: 'Bad Gateway' }), true, 'bad gateway')
})

Deno.test('isRetryableRpcError rejects data errors and junk', () => {
  assertEquals(isRetryableRpcError({ code: 'PGRST116', message: 'no rows' }), false, 'PGRST116')
  assertEquals(isRetryableRpcError({ code: '42P01', message: 'no such table' }), false, 'pg code')
  assertEquals(isRetryableRpcError({ status: 400, message: 'bad request' }), false, '400')
  assertEquals(isRetryableRpcError(null), false, 'null')
  assertEquals(isRetryableRpcError('Gateway Timeout'), false, 'bare string')
})

Deno.test('backoffDelayMs grows exponentially and caps', () => {
  assertEquals(backoffDelayMs(0), 1000, 'attempt 0')
  assertEquals(backoffDelayMs(1), 2000, 'attempt 1')
  assertEquals(backoffDelayMs(2), 4000, 'attempt 2')
  assertEquals(backoffDelayMs(3), 8000, 'attempt 3')
  assertEquals(backoffDelayMs(10), 8000, 'cap')
})

Deno.test('shouldSkipRecompute skips only on identical fingerprints + empty queue', () => {
  const prev = { ridesMaxTs: '2026-09-12T10:00:00.000Z', rankedCount: 183 }
  const cur = { ridesMaxTs: '2026-09-12T10:00:00.000Z', rankedCount: 183 }
  assertEquals(shouldSkipRecompute(cur, prev, 0), true, 'identical + drained queue')
  // Older-or-equal current ts with same count still skips: nothing is newer
  // than what the last success already fitted (timestamps only move on
  // user_rides writes, so current can never legitimately lag prev unless
  // nothing changed).
  assertEquals(
    shouldSkipRecompute(
      { ridesMaxTs: '2026-09-12T09:00:00.000Z', rankedCount: 183 },
      prev,
      0,
    ),
    true,
    'older ts, same count',
  )
})

Deno.test('shouldSkipRecompute never skips on a non-empty or unknown queue', () => {
  const prev = { ridesMaxTs: '2026-09-12T10:00:00.000Z', rankedCount: 183 }
  const cur = { ridesMaxTs: '2026-09-12T10:00:00.000Z', rankedCount: 183 }
  // State changed without touching user_rides: the migration's backfill
  // seed, sweep re-marks (eligibility flips, missed-flag races). The queue
  // is the only signal that sees them — skipping here starves the backfill
  // and strands re-marks (PR #213 review).
  assertEquals(shouldSkipRecompute(cur, prev, 1), false, 'seeded/swept queue blocks the skip')
  assertEquals(shouldSkipRecompute(cur, prev, null), false, 'unknown queue fails open to a run')
  assertEquals(shouldSkipRecompute(cur, prev, undefined), false, 'no queue read → run')
})

Deno.test('shouldSkipRecompute detects every input change class', () => {
  const prev = { ridesMaxTs: '2026-09-12T10:00:00.000Z', rankedCount: 183 }
  // Insert / re-rank: newer timestamp.
  assertEquals(
    shouldSkipRecompute(
      { ridesMaxTs: '2026-09-12T10:15:00.000Z', rankedCount: 184 },
      prev,
      0,
    ),
    false,
    'insert',
  )
  assertEquals(
    shouldSkipRecompute(
      { ridesMaxTs: '2026-09-12T10:15:00.000Z', rankedCount: 183 },
      prev,
      0,
    ),
    false,
    're-rank bumps ts',
  )
  // Delete / un-rank: count drops even if max ts is unchanged or older.
  assertEquals(
    shouldSkipRecompute({ ridesMaxTs: '2026-09-12T10:00:00.000Z', rankedCount: 182 }, prev, 0),
    false,
    'delete changes count',
  )
  // Missing previous fingerprint (pre-instrumentation rows): never skip.
  assertEquals(
    shouldSkipRecompute({ ridesMaxTs: '2026-09-12T10:00:00.000Z', rankedCount: 183 }, null, 0),
    false,
    'no previous',
  )
  // Empty board on both sides: skip (already wiped, nothing to do).
  assertEquals(
    shouldSkipRecompute({ ridesMaxTs: null, rankedCount: 0 }, { ridesMaxTs: null, rankedCount: 0 }, 0),
    true,
    'empty stable',
  )
  // Board wiped since last success: recompute to clear ratings.
  assertEquals(
    shouldSkipRecompute({ ridesMaxTs: null, rankedCount: 0 }, prev, 0),
    false,
    'wiped since success',
  )
})

Deno.test('estimatePayloadBytes measures JSON length, never throws', () => {
  assertEquals(estimatePayloadBytes(null), 2, 'null -> []')
  assertEquals(estimatePayloadBytes([{ a: 1 }]), JSON.stringify([{ a: 1 }]).length, 'row')
  assertEquals(estimatePayloadBytes(undefined), 2, 'undefined')
  const circular: Record<string, unknown> = {}
  circular.self = circular
  assertEquals(estimatePayloadBytes(circular), 0, 'circular -> 0')
})

Deno.test('drainPages collects a single short page without extra fetches', async () => {
  let calls = 0
  const result = await drainPages((_start, _end) => {
    calls++
    return Promise.resolve({ data: [{ i: 1 }, { i: 2 }], error: null })
  }, 10_000)
  assertEquals(calls, 1, 'short page ends the drain')
  assertEquals(result.data.length, 2, 'rows collected')
  assertEquals(result.pages, 1, 'page count')
  assertEquals(result.error, null, 'no error')
})

Deno.test('drainPages drains full pages until exhaustion', async () => {
  const pages: number[][] = []
  const result = await drainPages((start, end) => {
    pages.push([start, end])
    if (start === 0) return Promise.resolve({ data: Array.from({ length: 3 }, (_, i) => i), error: null })
    return Promise.resolve({ data: [], error: null })
  }, 3)
  assertEquals(pages.length, 2, 'one empty page fetched after a full page')
  assertEquals(pages[1]![0], 3, 'second page starts at pageSize')
  assertEquals(result.data.length, 3, 'only real rows collected')
  assertEquals(result.pages, 2, 'page count')
})

Deno.test('drainPages stops when a page is short, not when it is exact', async () => {
  const result = await drainPages((start) => {
    if (start === 0) return Promise.resolve({ data: [1, 2, 3], error: null })
    return Promise.resolve({ data: [4], error: null })
  }, 3)
  assertEquals(result.data.length, 4, 'all rows from both pages')
  assertEquals(result.pages, 2, 'short page terminated the drain')
})

Deno.test('drainPages propagates page errors (no partial data)', async () => {
  const result = await drainPages((start) => {
    if (start === 0) return Promise.resolve({ data: [1, 2, 3], error: null })
    return Promise.resolve({ data: null, error: { message: 'Gateway Timeout' } })
  }, 3)
  assertEquals(result.data.length, 0, 'no partial rows returned')
  assertEquals(result.error?.message, 'Gateway Timeout', 'error surfaced')
  assertEquals(result.pages, 1, 'one successful page before the error')
})

Deno.test('drainPages treats null data as an empty page', async () => {
  const result = await drainPages(() => Promise.resolve({ data: null, error: null }), 5)
  assertEquals(result.data.length, 0, 'null page = empty')
  assertEquals(result.pages, 1, 'terminates immediately')
})

Deno.test('parseFitMode accepts the three modes, defaults unknown to shadow', () => {
  assertEquals(parseFitMode('shadow'), 'shadow', 'shadow')
  assertEquals(parseFitMode('indb'), 'indb', 'indb')
  assertEquals(parseFitMode('legacy'), 'legacy', 'legacy')
  assertEquals(parseFitMode(' INDB '), 'indb', 'whitespace + case')
  assertEquals(parseFitMode(undefined), 'shadow', 'unset -> shadow')
  assertEquals(parseFitMode(''), 'shadow', 'empty -> shadow')
  assertEquals(parseFitMode('bogus'), 'shadow', 'unknown -> shadow (never flip by accident)')
})

Deno.test('isStatementTimeoutMessage matches the 57014 shapes, not other errors', () => {
  assertEquals(
    isStatementTimeoutMessage('canceling statement due to statement timeout'),
    true,
    'bare postgres message',
  )
  assertEquals(
    isStatementTimeoutMessage('pair_maintain_step: canceling statement due to statement timeout (after 1 attempts)'),
    true,
    'wrapped rpc error',
  )
  assertEquals(isStatementTimeoutMessage('Gateway Timeout'), false, 'gateway != statement')
  assertEquals(isStatementTimeoutMessage('no such table'), false, 'data error')
})

Deno.test('computeParity measures log-space delta over the common board', () => {
  // 1% score disagreement → ln(1.01) ≈ 0.00995.
  const result = computeParity(
    [
      { id: 'a', score: 1.0 },
      { id: 'b', score: 2.0 },
      { id: 'c', score: 1.5 },
    ],
    [
      { id: 'a', score: 1.01 },
      { id: 'b', score: 2.0 },
      { id: 'd', score: 9.0 },
    ],
  )
  assertEquals(result.common, 2, 'a + b common')
  assertEquals(result.jsOnly, 1, 'c only in js')
  assertEquals(result.dbOnly, 1, 'd only in db')
  const expected = Math.abs(Math.log(1.0) - Math.log(1.01))
  assertEquals(
    Math.abs(result.maxLogDelta - expected) < 1e-12,
    true,
    'max delta is the a-row log gap',
  )
  assertEquals(parityOk(result), false, 'membership mismatch fails parity')
})

Deno.test('computeParity + parityOk accept the measured float-noise floor', () => {
  // Two fixed-point solvers agreeing to the bench's measured parity
  // (5.6e-9 — below the 1e-6 threshold).
  const rows = (score: number) => [
    { id: 'a', score },
    { id: 'b', score: 1 / score },
  ]
  const result = computeParity(rows(1.03), rows(1.03 * (1 + 1e-9)))
  assertEquals(result.common, 2, 'identical boards')
  assertEquals(result.jsOnly, 0, 'no js-only rows')
  assertEquals(result.dbOnly, 0, 'no db-only rows')
  assertEquals(result.maxLogDelta < PARITY_DELTA_THRESHOLD, true, 'delta under threshold')
  assertEquals(parityOk(result), true, 'parity ok')
})

Deno.test('computeParity handles empty boards on either side', () => {
  const emptyJs = computeParity([], [{ id: 'a', score: 1 }])
  assertEquals(emptyJs.common, 0, 'no common rows')
  assertEquals(emptyJs.dbOnly, 1, 'db board alone')
  assertEquals(parityOk(emptyJs), false, 'db-only board fails parity')
  const bothEmpty = computeParity([], [])
  assertEquals(bothEmpty.maxLogDelta, 0, 'no delta')
  assertEquals(parityOk(bothEmpty), true, 'two empty boards agree')
})
