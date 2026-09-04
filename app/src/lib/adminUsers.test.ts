import { describe, it, expect } from 'vitest'
import { filterUsers, pageSlice, pageCount, type AdminUserRow } from './adminUsers'

function row(overrides: Partial<AdminUserRow>): AdminUserRow {
  return {
    id: 'id',
    email: 'rider@example.com',
    username: 'rider',
    displayName: null,
    avatarUrl: null,
    isAdmin: false,
    publicList: false,
    confirmed: true,
    synthetic: false,
    createdAt: null,
    ridesTotal: 0,
    ridesRanked: 0,
    submissionsMade: 0,
    submissionsReviewed: 0,
    ...overrides,
  }
}

const testUser = row({
  id: 'u-test',
  email: 'mock-0001@test.coasterrank.dev',
  username: 'mock-0001',
  displayName: 'Mock Rider 1',
  synthetic: true,
})

const realUser = row({ id: 'u-real', email: 'ana@example.com', username: 'ana' })

describe('filterUsers', () => {
  const users = [testUser, realUser]

  it('passes everything through for all with no search', () => {
    expect(filterUsers(users, 'all', '')).toHaveLength(2)
    expect(filterUsers(users, 'all', '   ')).toHaveLength(2)
  })

  it('keeps only synthetic users for the test filter', () => {
    expect(filterUsers(users, 'test', '')).toEqual([testUser])
  })

  it('keeps only real users for the real filter', () => {
    expect(filterUsers(users, 'real', '')).toEqual([realUser])
  })

  it('searches email case-insensitively', () => {
    expect(filterUsers(users, 'all', 'ANA@')).toEqual([realUser])
  })

  it('searches username and display name', () => {
    expect(filterUsers(users, 'all', 'mock-0001')).toEqual([testUser])
    expect(filterUsers(users, 'all', 'mock rider')).toEqual([testUser])
  })

  it('combines filter and search (no match → empty)', () => {
    expect(filterUsers(users, 'test', 'ana')).toEqual([])
    expect(filterUsers(users, 'real', 'ana')).toEqual([realUser])
  })
})

describe('pageSlice', () => {
  const rows = Array.from({ length: 12 }, (_, i) => i)

  it('returns the 1-based page', () => {
    expect(pageSlice(rows, 1, 5)).toEqual([0, 1, 2, 3, 4])
    expect(pageSlice(rows, 3, 5)).toEqual([10, 11])
  })

  it('clamps out-of-range pages to the last page', () => {
    expect(pageSlice(rows, 99, 5)).toEqual([10, 11])
    expect(pageSlice(rows, 0, 5)).toEqual([0, 1, 2, 3, 4])
  })

  it('never returns an empty page for non-empty input', () => {
    expect(pageSlice(rows, 3, 100)).toEqual(rows)
  })
})

describe('pageCount', () => {
  it('rounds up and floors at 1', () => {
    expect(pageCount(0, 50)).toBe(1)
    expect(pageCount(1, 50)).toBe(1)
    expect(pageCount(51, 50)).toBe(2)
    expect(pageCount(100, 50)).toBe(2)
  })
})
