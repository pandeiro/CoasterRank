// Synthetic-user identity markers (single source of truth for seed/report/cleanup).
//
// A user is "synthetic" if EITHER marker matches:
//   1. email on the synthetic domain (also the convention to adopt when signing
//      up manual test users through the UI), or
//   2. raw_user_meta_data.synthetic = true (set by `testride:seed`).
// Cleanup matches both; `report` flags users matching only one (drift).

export const TEST_EMAIL_DOMAIN = 'test.coasterrank.dev'

// Shared plaintext password for every seeded synthetic user, so they can be
// logged into via the UI for manual testing (no email verification involved —
// seed sets email_confirmed_at directly).
export const SYNTHETIC_PASSWORD = 'testride-password'

export function syntheticEmail(local: string): string {
  return `${local.toLowerCase()}@${TEST_EMAIL_DOMAIN}`
}

export function isSyntheticEmail(email: string | null | undefined): boolean {
  return !!email && email.toLowerCase().endsWith(`@${TEST_EMAIL_DOMAIN}`)
}

// SQL predicate over `auth.users u` matching the email-domain marker.
// Bind $1 = `%@${TEST_EMAIL_DOMAIN}`.
export const SYNTHETIC_EMAIL_PREDICATE = '(lower(u.email) like $1)'

// SQL predicate over `auth.users u` matching the metadata flag.
export const SYNTHETIC_META_PREDICATE = "((u.raw_user_meta_data->>'synthetic') = 'true')"

// Either marker.
export const SYNTHETIC_PREDICATE = `(${SYNTHETIC_EMAIL_PREDICATE} or ${SYNTHETIC_META_PREDICATE})`
