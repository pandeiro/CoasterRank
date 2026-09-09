// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readdir, readFile } from 'node:fs/promises'
import { RESERVED_USERNAMES, USERNAME_RE, isReservedUsername } from './validation'

describe('validation: usernames', () => {
  it('accepts the lowercase contract, rejects everything else', () => {
    expect(USERNAME_RE.test('coaster_fan')).toBe(true)
    expect(USERNAME_RE.test('Coaster_Fan')).toBe(false)
    expect(USERNAME_RE.test('ab')).toBe(false)
  })

  it('flags the reserved list (case-insensitive)', () => {
    expect(isReservedUsername('admin')).toBe(true)
    expect(isReservedUsername('Admin')).toBe(true)
    expect(isReservedUsername('coaster_fan')).toBe(false)
  })

  it('RESERVED_USERNAMES matches every alternation in the DB constraint (no drift)', async () => {
    // The reserved list lives in two places — this module and the
    // *_reserved_usernames.sql migration. Resolving by filename suffix (not
    // timestamp) keeps the test valid across migration re-stamps.
    const dir = new URL('../../../supabase/migrations/', import.meta.url)
    const files = (await readdir(dir)).filter((name) => name.endsWith('_reserved_usernames.sql'))
    expect(files).toHaveLength(1)
    const sql = await readFile(new URL(files[0], dir), 'utf8')
    const alternations = [...sql.matchAll(/\^\(([a-z|]+)\)\$/g)].map((m) => m[1].split('|'))
    // The pre-assertion and the CHECK constraint must both enumerate the list.
    expect(alternations.length).toBeGreaterThanOrEqual(2)
    for (const list of alternations) {
      expect(new Set(list)).toEqual(RESERVED_USERNAMES)
    }
  })
})
