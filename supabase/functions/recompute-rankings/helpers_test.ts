// Unit tests for the recompute-rankings pure helpers.
// Run: `deno test supabase/functions/recompute-rankings/helpers_test.ts`
// (dependency-free: plain Deno.test + throws, no network imports).
import {
  backoffDelayMs,
  estimatePayloadBytes,
  isRetryableRpcError,
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

Deno.test('shouldSkipRecompute skips only on identical fingerprints', () => {
  const prev = { ridesMaxTs: '2026-09-12T10:00:00.000Z', rankedCount: 183 }
  assertEquals(
    shouldSkipRecompute({ ridesMaxTs: '2026-09-12T10:00:00.000Z', rankedCount: 183 }, prev),
    true,
    'identical',
  )
  // Older-or-equal current ts with same count still skips: nothing is newer
  // than what the last success already fitted (timestamps only move on
  // user_rides writes, so current can never legitimately lag prev unless
  // nothing changed).
  assertEquals(
    shouldSkipRecompute({ ridesMaxTs: '2026-09-12T09:00:00.000Z', rankedCount: 183 }, prev),
    true,
    'older ts, same count',
  )
})

Deno.test('shouldSkipRecompute detects every input change class', () => {
  const prev = { ridesMaxTs: '2026-09-12T10:00:00.000Z', rankedCount: 183 }
  // Insert / re-rank: newer timestamp.
  assertEquals(
    shouldSkipRecompute({ ridesMaxTs: '2026-09-12T10:15:00.000Z', rankedCount: 184 }, prev),
    false,
    'insert',
  )
  assertEquals(
    shouldSkipRecompute({ ridesMaxTs: '2026-09-12T10:15:00.000Z', rankedCount: 183 }, prev),
    false,
    're-rank bumps ts',
  )
  // Delete / un-rank: count drops even if max ts is unchanged or older.
  assertEquals(
    shouldSkipRecompute({ ridesMaxTs: '2026-09-12T10:00:00.000Z', rankedCount: 182 }, prev),
    false,
    'delete changes count',
  )
  // Missing previous fingerprint (pre-instrumentation rows): never skip.
  assertEquals(
    shouldSkipRecompute({ ridesMaxTs: '2026-09-12T10:00:00.000Z', rankedCount: 183 }, null),
    false,
    'no previous',
  )
  // Empty board on both sides: skip (already wiped, nothing to do).
  assertEquals(shouldSkipRecompute({ ridesMaxTs: null, rankedCount: 0 }, { ridesMaxTs: null, rankedCount: 0 }), true, 'empty stable')
  // Board wiped since last success: recompute to clear ratings.
  assertEquals(
    shouldSkipRecompute({ ridesMaxTs: null, rankedCount: 0 }, prev),
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
