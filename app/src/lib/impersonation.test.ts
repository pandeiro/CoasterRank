import { describe, it, expect } from 'vitest'
import { extractTokens } from './impersonation'

describe('extractTokens', () => {
  it('extracts tokens from the current flat session shape', () => {
    const saved = {
      access_token: 'at',
      refresh_token: 'rt',
      token_type: 'bearer',
      user: { id: 'u1' },
    }
    expect(extractTokens(saved)).toEqual({ accessToken: 'at', refreshToken: 'rt' })
  })

  it('extracts tokens from the legacy wrapped shape', () => {
    const saved = { currentSession: { access_token: 'at', refresh_token: 'rt' } }
    expect(extractTokens(saved)).toEqual({ accessToken: 'at', refreshToken: 'rt' })
  })

  it('returns null for malformed backups', () => {
    expect(extractTokens(null)).toBeNull()
    expect(extractTokens('garbage')).toBeNull()
    expect(extractTokens({ access_token: 42, refresh_token: 'rt' })).toBeNull()
    expect(extractTokens({})).toBeNull()
  })
})
