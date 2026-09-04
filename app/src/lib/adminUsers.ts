// Admin "Users" view client (app-side of the admin-users Edge Function).
//
// listAllUsers() fetches every user (GoTrue admin data merged with per-user
// aggregates + baseline stats); filtering, search and pagination are
// client-side at current scale. confirmUser()/deleteUser() invoke the
// function's POST actions. Impersonation stays in ./impersonation (magic link
// via the assume-identity function, synthetic users only).
import { supabase } from './supabase'

export interface AdminUserRow {
  id: string
  email: string
  username: string | null
  displayName: string | null
  avatarUrl: string | null
  isAdmin: boolean
  publicList: boolean
  confirmed: boolean
  synthetic: boolean
  createdAt: string | null
  ridesTotal: number
  ridesRanked: number
  submissionsMade: number
  submissionsReviewed: number
}

export interface UserStats {
  totalUsers: number
  confirmedUsers: number
  testUsers: number
  adminUsers: number
  rankedUsers: number
  signups7d: number
  signups30d: number
}

export interface UsersPayload {
  users: AdminUserRow[]
  stats: UserStats
  truncated: boolean
}

export type UserFilter = 'all' | 'real' | 'test'

export async function listAllUsers(): Promise<UsersPayload> {
  const { data, error } = await supabase.functions.invoke<UsersPayload>('admin-users', {
    method: 'GET',
  })
  if (error) throw new Error(error.message)
  return data ?? { users: [], stats: emptyStats(), truncated: false }
}

export async function confirmUser(userId: string): Promise<void> {
  const { error } = await supabase.functions.invoke('admin-users', {
    method: 'POST',
    body: { action: 'confirm', userId },
  })
  if (error) throw new Error(error.message)
}

export async function deleteUser(userId: string): Promise<void> {
  const { error } = await supabase.functions.invoke('admin-users', {
    method: 'POST',
    body: { action: 'delete', userId },
  })
  if (error) throw new Error(error.message)
}

function emptyStats(): UserStats {
  return {
    totalUsers: 0,
    confirmedUsers: 0,
    testUsers: 0,
    adminUsers: 0,
    rankedUsers: 0,
    signups7d: 0,
    signups30d: 0,
  }
}

// Pure helpers (unit-tested): class filter + case-insensitive search across
// email / username / display name.
export function filterUsers(
  users: AdminUserRow[],
  filter: UserFilter,
  search: string,
): AdminUserRow[] {
  const q = search.trim().toLowerCase()
  return users.filter((u) => {
    if (filter === 'test' && !u.synthetic) return false
    if (filter === 'real' && u.synthetic) return false
    if (!q) return true
    return (
      u.email.toLowerCase().includes(q) ||
      (u.username ?? '').toLowerCase().includes(q) ||
      (u.displayName ?? '').toLowerCase().includes(q)
    )
  })
}

// 1-based page slice; out-of-range pages clamp to the last available page.
export function pageSlice<T>(rows: T[], page: number, pageSize: number): T[] {
  const maxPage = Math.max(1, Math.ceil(rows.length / pageSize))
  const clamped = Math.min(Math.max(page, 1), maxPage)
  return rows.slice((clamped - 1) * pageSize, clamped * pageSize)
}

export function pageCount(rows: number, pageSize: number): number {
  return Math.max(1, Math.ceil(rows / pageSize))
}
