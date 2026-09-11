import { useMemo, useState, type ReactNode } from 'react'
import FeedbackModal from './FeedbackModal'
import { FeedbackOpenContext } from './feedback-context'

/**
 * Global host for the feedback modal. Mounted once in Layout (inside the
 * router, so the modal can read the current location for context capture);
 * UserMenu's Feedback item opens it via useFeedback(). The overlay never
 * navigates, so the page behind it keeps its scroll/route state.
 */
export default function FeedbackProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  const value = useMemo(() => ({ open: () => setIsOpen(true) }), [])
  return (
    <FeedbackOpenContext.Provider value={value}>
      {children}
      <FeedbackModal isOpen={isOpen} onClose={() => setIsOpen(false)} />
    </FeedbackOpenContext.Provider>
  )
}
