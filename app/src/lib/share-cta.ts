export const SHARE_CTA_DISMISS_KEY = 'cr.share-cta.dismissed-milestone'

/** Milestone thresholds on My Coasters: soft nudge at 5+, stronger at 10+. */
export const SHARE_CTA_MILESTONES = { soft: 5, strong: 10 } as const

export type ShareMilestone = 0 | 1 | 2

/** Highest milestone the user has dismissed (persisted in localStorage). */
export function readDismissedMilestone(): number {
  try {
    const parsed = Number(window.localStorage.getItem(SHARE_CTA_DISMISS_KEY))
    return Number.isFinite(parsed) ? parsed : 0
  } catch {
    return 0
  }
}

export function persistDismissedMilestone(milestone: ShareMilestone): void {
  try {
    window.localStorage.setItem(SHARE_CTA_DISMISS_KEY, String(milestone))
  } catch {
    // Storage unavailable (private mode etc.) — dismissal just won't persist.
  }
}

export function milestoneForRankedCount(count: number): ShareMilestone {
  return count >= SHARE_CTA_MILESTONES.strong ? 2 : count >= SHARE_CTA_MILESTONES.soft ? 1 : 0
}
