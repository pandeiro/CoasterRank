import { describe, it, expect, vi } from 'vitest'
import {
  buildFeedbackContext,
  hasUnseenAdminReply,
  validateFeedbackCategory,
  validateFeedbackMessage,
  type UserFeedback,
} from './feedback'

describe('validateFeedbackMessage', () => {
  it('rejects empty/whitespace-only messages', () => {
    expect(validateFeedbackMessage('')).toMatch(/tell us/i)
    expect(validateFeedbackMessage('   \n\t ')).toMatch(/tell us/i)
  })

  it('rejects messages beyond the 2000-char cap and accepts boundary values', () => {
    expect(validateFeedbackMessage('x'.repeat(2001))).toMatch(/2000/)
    expect(validateFeedbackMessage('x'.repeat(2000))).toBeNull()
    expect(validateFeedbackMessage('The drop is mislabeled')).toBeNull()
  })
})

describe('validateFeedbackCategory', () => {
  it('requires a picked category', () => {
    expect(validateFeedbackCategory(null)).toMatch(/pick/i)
    expect(validateFeedbackCategory('bug')).toBeNull()
  })
})

describe('buildFeedbackContext', () => {
  it('captures page, device, and locale; carries the coaster slug when present', () => {
    vi.stubGlobal('location', {
      pathname: '/coasters/fury-325',
      search: '?utm=test',
      href: 'https://coasterrank.app/coasters/fury-325?utm=test',
    })
    const context = buildFeedbackContext('fury-325')
    expect(context.page).toBe('/coasters/fury-325?utm=test')
    expect(context.coaster_slug).toBe('fury-325')
    expect(context.user_agent).toBe(navigator.userAgent)
    expect(context.screen).toMatch(/^\d+x\d+$/)
    expect(context.language).toBe(navigator.language)
    vi.unstubAllGlobals()
  })

  it('leaves the coaster slug empty off coaster pages', () => {
    const context = buildFeedbackContext(null)
    expect(context.coaster_slug).toBeNull()
  })
})

describe('hasUnseenAdminReply', () => {
  function makeThread(overrides: Partial<UserFeedback> = {}): UserFeedback {
    return {
      id: 'f1',
      category: 'bug',
      message: 'm',
      context: {},
      submitted_by: 'u1',
      status: 'replied',
      seen_by_submitter_at: null,
      created_at: '2026-09-10T00:00:00Z',
      replies: [],
      ...overrides,
    }
  }

  const adminReply = {
    id: 'r1',
    feedback_id: 'f1',
    // Any author other than the submitter ('u1') is an admin by construction
    // (replies insert policy) — no profiles embed needed.
    author_id: 'admin1',
    message: 'Fixed',
    created_at: '2026-09-10T12:00:00Z',
  }

  it('flags threads with an unseen admin reply', () => {
    expect(hasUnseenAdminReply(makeThread({ replies: [adminReply] }))).toBe(true)
  })

  it('clears once the submitter has seen the reply', () => {
    expect(
      hasUnseenAdminReply(
        makeThread({ replies: [adminReply], seen_by_submitter_at: '2026-09-10T13:00:00Z' }),
      ),
    ).toBe(false)
  })

  it('ignores replies the submitter authored themselves and empty threads', () => {
    expect(hasUnseenAdminReply(makeThread({ replies: [{ ...adminReply, author_id: 'u1' }] }))).toBe(
      false,
    )
    expect(hasUnseenAdminReply(makeThread())).toBe(false)
  })
})
