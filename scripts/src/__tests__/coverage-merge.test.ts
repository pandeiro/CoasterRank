import { describe, expect, it } from 'vitest'
import { mergeDecisions } from '../coverage/sweep.js'
import type { DecisionRecord } from '../coverage/apply.js'

const item = (id: string, over: Partial<DecisionRecord> = {}): DecisionRecord => ({
  id,
  kind: 'orphan_rehome',
  action: 'rehome',
  title: `generated ${id}`,
  decided: false,
  payload: { generated: true },
  ...over,
})

describe('mergeDecisions', () => {
  it('preserves decided items verbatim (user-owned)', () => {
    const decidedItem = item('A', {
      decided: true,
      action: 'merge_coasters',
      payload: { hand: 'edited' },
    })
    const res = mergeDecisions([item('A', { payload: { generated: 'new' } })], [decidedItem])
    expect(res.items[0]).toEqual(decidedItem)
    expect(res.preservedDecided).toEqual(['A'])
  })

  it('preserves crafted-but-undecided items, keeping decided false', () => {
    const crafted = item('B', {
      crafted: true,
      action: 'create_coaster',
      title: 'hand-crafted',
      payload: { name: 'Palindrome' },
    })
    const res = mergeDecisions([item('B')], [crafted])
    expect(res.items[0]).toMatchObject({ crafted: true, action: 'create_coaster', decided: false })
    expect(res.items[0]!.payload).toEqual({ name: 'Palindrome' })
    expect(res.preservedCrafted).toEqual(['B'])
  })

  it('refreshes undecided non-crafted items from the sweep', () => {
    const res = mergeDecisions(
      [item('C', { payload: { fresh: true } })],
      [item('C', { payload: { stale: true } })],
    )
    expect(res.items[0]!.payload).toEqual({ fresh: true })
    expect(res.preservedDecided).toHaveLength(0)
  })

  it('reports stale generated ids as dropped, but keeps hand-authored extras', () => {
    const res = mergeDecisions(
      [item('A')],
      [
        item('A'),
        item('GONE', { decided: true }),
        item('EXTRA', { crafted: true, action: 'create_coaster' }),
        item('STALE-GEN', { payload: { generated: true } }),
      ],
    )
    expect(res.dropped).toEqual(['STALE-GEN'])
    const ids = res.items.map((i) => i.id)
    expect(ids).toContain('GONE')
    expect(ids).toContain('EXTRA')
    expect(ids).not.toContain('STALE-GEN')
  })

  it('adds brand-new generated items with decided false', () => {
    const res = mergeDecisions([item('NEW')], [])
    expect(res.items[0]).toMatchObject({ id: 'NEW', decided: false })
  })
})
