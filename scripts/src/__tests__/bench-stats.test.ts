// Unit tests for bench stats: percentiles, summarize, knee detection.
import { describe, expect, it } from 'vitest'
import { findKnee, firstErrorPoint, percentile, summarize, type RunSample } from '../bench/stats'

function sample(over: Partial<RunSample>): RunSample {
  return {
    label: '10x10',
    variant: 'baseline',
    users: 10,
    rides: 10,
    R: 450,
    repeat: 1,
    ok: true,
    invokeMs: 1000,
    durationMs: 1200,
    rpcMs: 100,
    rpcBytes: 13000,
    pairs: 90,
    iterations: 12,
    error: null,
    ...over,
  }
}

describe('percentile', () => {
  it('nearest-rank p50/p95', () => {
    expect(percentile([1, 2, 3, 4], 50)).toBe(2)
    expect(percentile([1, 2, 3, 4], 95)).toBe(4)
    expect(percentile([], 50)).toBeNull()
    expect(percentile([5000], 95)).toBe(5000)
  })
})

describe('summarize', () => {
  it('aggregates ok runs and counts errors', () => {
    const s = summarize('10x10', [
      sample({ repeat: 1, rpcMs: 100, durationMs: 1200 }),
      sample({ repeat: 2, rpcMs: 200, durationMs: 1400 }),
      sample({ repeat: 3, ok: false, error: 'invoke: HTTP 504' }),
    ])
    expect(s).not.toBeNull()
    expect(s?.runs).toBe(3)
    expect(s?.errors).toBe(1)
    expect(s?.rpcP95).toBe(200)
    expect(s?.durationP95).toBe(1400)
  })
})

describe('findKnee / firstErrorPoint', () => {
  it('finds the first point crossing the threshold', () => {
    const a = summarize('10x10', [sample({ label: '10x10', R: 450, rpcMs: 900 })])
    const b = summarize('60x60', [sample({ label: '60x60', R: 106200, rpcMs: 5200 })])
    const knee = findKnee([a, b], (s) => s.rpcP95)
    expect(knee?.label).toBe('60x60')
  })
  it('finds the first point with errors', () => {
    const a = summarize('10x10', [sample({ label: '10x10', R: 450 })])
    const b = summarize('60x60', [
      sample({ label: '60x60', R: 106200, ok: false, error: 'HTTP 504' }),
    ])
    expect(firstErrorPoint([a, b])?.label).toBe('60x60')
  })
})
