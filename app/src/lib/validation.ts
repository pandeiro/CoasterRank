export const USERNAME_RE = /^[a-z0-9_]{3,20}$/

export const USERNAME_RULES = '3–20 characters: lowercase letters, numbers, and underscores.'

/**
 * Usernames that can never be claimed (brand/system squatting on /@ handles).
 * Keep in sync with the profiles_username_reserved_check constraint in
 * supabase/migrations/*_reserved_usernames.sql — enforced by the parity test
 * in validation.test.ts (it reads the migration, so this set and the regex
 * alternation cannot drift apart).
 */
export const RESERVED_USERNAMES = new Set([
  'admin',
  'api',
  'me',
  'coasterrank',
  'support',
  'help',
  'official',
  'system',
  'root',
  'moderator',
  'mod',
  'null',
])

export function isReservedUsername(username: string): boolean {
  return RESERVED_USERNAMES.has(username.toLowerCase())
}
