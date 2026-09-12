import { createContext, useContext } from 'react'

export type FeedbackContextValue = {
  /** Opens the feedback modal as an overlay — never navigates. */
  open: () => void
}

// Kept in its own module (no components exported) so FeedbackProvider stays
// fast-refresh-clean, mirroring the auth-context/auth split.
export const FeedbackOpenContext = createContext<FeedbackContextValue | null>(null)

export function useFeedback(): FeedbackContextValue {
  const ctx = useContext(FeedbackOpenContext)
  if (!ctx) throw new Error('useFeedback must be used within <FeedbackProvider>')
  return ctx
}
