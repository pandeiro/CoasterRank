import { useEffect, useRef, useState } from 'react'
import { matchPath, useLocation } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown } from 'lucide-react'
import Toast from './Toast'
import ConfirmEmailGate from './ConfirmEmailGate'
import { Badge, Button, fieldClassName, Modal } from './ui'
import { useAuth } from '../lib/auth-context'
import {
  buildFeedbackContext,
  FEEDBACK_CATEGORIES,
  FEEDBACK_MESSAGE_MAX,
  FEEDBACK_OPEN_CAP,
  getMyFeedback,
  hasUnseenAdminReply,
  markMyFeedbackSeen,
  replyToFeedback,
  submitFeedback,
  validateFeedbackCategory,
  validateFeedbackMessage,
  type FeedbackCategory,
  type FeedbackStatus,
  type UserFeedback,
} from '../lib/feedback'

const STATUS_PILL: Record<
  FeedbackStatus,
  { label: string; tone: 'warning' | 'accent' | 'neutral' }
> = {
  open: { label: 'Open', tone: 'warning' },
  replied: { label: 'Replied', tone: 'accent' },
  closed: { label: 'Closed', tone: 'neutral' },
}

function categoryMeta(category: FeedbackCategory) {
  return FEEDBACK_CATEGORIES.find((c) => c.value === category) ?? FEEDBACK_CATEGORIES[0]
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function replyAuthorLabel(
  reply: { author_id: string; profiles?: { username: string | null; is_admin: boolean } | null },
  viewerId: string,
) {
  if (reply.profiles?.is_admin) return 'CoasterRank Team'
  if (reply.author_id === viewerId) return 'You'
  return reply.profiles?.username ?? 'You'
}

export default function FeedbackModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean
  onClose: () => void
}) {
  const { user, isConfirmed } = useAuth()
  const location = useLocation()
  const queryClient = useQueryClient()

  const [category, setCategory] = useState<FeedbackCategory | null>(null)
  const [message, setMessage] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [toast, setToast] = useState<{ message: string; tone: 'info' | 'error' } | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({})

  // Silent context capture: the page the user is on (a coaster page also
  // records its slug). Rendered nowhere — it lands in the admin panel only.
  const coasterSlug = matchPath('/coasters/:slug', location.pathname)?.params.slug ?? null

  const { data: threads = [], isPending: threadsPending } = useQuery({
    queryKey: ['my-feedback', user?.id],
    queryFn: getMyFeedback,
    enabled: Boolean(user) && isConfirmed && isOpen,
  })

  const openCount = threads.filter((t) => t.status === 'open').length
  const atCap = openCount >= FEEDBACK_OPEN_CAP

  // Opening the modal counts as seeing admin replies: stamp the rows so the
  // "New" pills clear (mirrors the submit-page seen flow). Failures reset the
  // guard for a retry on the next open.
  const seenMarked = useRef(false)
  useEffect(() => {
    if (!isOpen || !user || !isConfirmed || seenMarked.current) return
    if (!threads.some(hasUnseenAdminReply)) return
    seenMarked.current = true
    markMyFeedbackSeen()
      .then(() => queryClient.invalidateQueries({ queryKey: ['my-feedback', user.id] }))
      .catch(() => {
        seenMarked.current = false
      })
  }, [isOpen, user, isConfirmed, threads, queryClient])

  const submit = useMutation({
    mutationFn: submitFeedback,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-feedback', user?.id] })
      setCategory(null)
      setMessage('')
      setFormError(null)
      setToast({ message: 'Sent — thank you!', tone: 'info' })
    },
    onError: (error) => {
      setToast({
        message: error instanceof Error ? error.message : "Couldn't send feedback.",
        tone: 'error',
      })
    },
  })

  const reply = useMutation({
    mutationFn: ({ id, message: text }: { id: string; message: string }) =>
      replyToFeedback(id, text),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['my-feedback', user?.id] })
      setReplyDrafts((prev) => ({ ...prev, [vars.id]: '' }))
      setToast({ message: 'Reply sent.', tone: 'info' })
    },
    onError: (error) => {
      setToast({
        message: error instanceof Error ? error.message : "Couldn't send reply.",
        tone: 'error',
      })
    },
  })

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (atCap) return
    const error = validateFeedbackCategory(category) ?? validateFeedbackMessage(message)
    if (error) {
      setFormError(error)
      return
    }
    setFormError(null)
    submit.mutate({
      category: category as FeedbackCategory,
      message,
      context: buildFeedbackContext(coasterSlug),
    })
  }

  // A thread is open in the accordion when the user expanded it, or when it
  // carries an unseen admin reply (so replies announce themselves; once the
  // seen-stamp round-trips, only manual expansions keep it open).
  function isThreadOpen(thread: UserFeedback) {
    return expanded.has(thread.id) || hasUnseenAdminReply(thread)
  }

  function toggleThread(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (!user) return null

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} title="Feedback" panelClassName="max-w-lg">
        {!isConfirmed ? (
          <ConfirmEmailGate email={user.email} />
        ) : (
          <div className="space-y-6">
            <form onSubmit={handleSubmit} className="space-y-4">
              <fieldset>
                <legend className="mb-2 text-sm font-medium text-ink-soft">What&apos;s up?</legend>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {FEEDBACK_CATEGORIES.map(({ value, emoji, label }) => {
                    const selected = category === value
                    return (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => setCategory(value)}
                        className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                          selected
                            ? 'border-accent-text bg-accent/10 text-ink'
                            : 'border-line bg-surface-bright text-muted hover:border-accent-text hover:text-ink'
                        }`}
                      >
                        <span aria-hidden="true">{emoji}</span>
                        <span className="min-w-0 truncate">{label}</span>
                      </button>
                    )
                  })}
                </div>
              </fieldset>

              <div className="flex flex-col gap-2">
                <label htmlFor="feedback-message" className="text-sm font-medium text-ink-soft">
                  Tell me about it
                </label>
                <textarea
                  id="feedback-message"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  maxLength={FEEDBACK_MESSAGE_MAX}
                  rows={4}
                  placeholder="The more specific, the faster it gets fixed…"
                  className={fieldClassName}
                />
              </div>

              {formError && <p className="text-xs text-danger">{formError}</p>}
              {atCap && (
                <p className="rounded-xl border border-warning/25 bg-warning/5 p-3 text-sm text-warning-text">
                  You have {openCount} open thread{openCount === 1 ? '' : 's'} — the maximum. Wait
                  for replies before opening more.
                </p>
              )}

              <Button type="submit" disabled={atCap || submit.isPending} className="w-full">
                {submit.isPending ? 'Sending…' : 'Send it'}
              </Button>
            </form>

            <div>
              <h3 className="mb-2 text-sm font-medium text-ink-soft">Your feedback</h3>
              {threadsPending ? (
                <p className="text-sm text-muted">Loading…</p>
              ) : threads.length === 0 ? (
                <p className="rounded-xl border border-line bg-surface px-3 py-4 text-sm text-muted">
                  Nothing yet — anything you send shows up here with replies.
                </p>
              ) : (
                <ul className="space-y-2">
                  {threads.map((thread) => {
                    const meta = categoryMeta(thread.category)
                    const open = isThreadOpen(thread)
                    return (
                      <li
                        key={thread.id}
                        className="overflow-hidden rounded-xl border border-line bg-surface"
                      >
                        <button
                          type="button"
                          onClick={() => toggleThread(thread.id)}
                          aria-expanded={open}
                          className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-surface-bright"
                        >
                          <span aria-hidden="true" className="shrink-0">
                            {meta.emoji}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-sm text-ink">
                            {thread.message}
                          </span>
                          {hasUnseenAdminReply(thread) && <Badge tone="success">New</Badge>}
                          <Badge tone={STATUS_PILL[thread.status].tone}>
                            {STATUS_PILL[thread.status].label}
                          </Badge>
                          <span className="shrink-0 text-xs text-muted">
                            {formatDate(thread.created_at)}
                          </span>
                          <ChevronDown
                            size={14}
                            className={`shrink-0 text-muted transition-transform ${
                              open ? 'rotate-180' : ''
                            }`}
                          />
                        </button>
                        {open && (
                          <div className="space-y-2 border-t border-line px-3 py-3">
                            <p className="whitespace-pre-wrap break-words text-sm text-ink-soft">
                              {thread.message}
                            </p>
                            {(thread.replies ?? []).map((r) => (
                              <div
                                key={r.id}
                                className={`rounded-lg px-3 py-2 text-sm ${
                                  r.profiles?.is_admin ? 'bg-accent/10' : 'bg-surface-bright'
                                }`}
                              >
                                <span className="text-xs font-medium text-muted">
                                  {replyAuthorLabel(r, user.id)} · {formatDate(r.created_at)}
                                </span>
                                <p className="mt-0.5 whitespace-pre-wrap break-words text-ink-soft">
                                  {r.message}
                                </p>
                              </div>
                            ))}
                            {thread.status === 'replied' && (
                              <div className="flex flex-col gap-2">
                                <textarea
                                  aria-label={`Reply to thread: ${thread.message.slice(0, 40)}`}
                                  value={replyDrafts[thread.id] ?? ''}
                                  onChange={(e) =>
                                    setReplyDrafts((prev) => ({
                                      ...prev,
                                      [thread.id]: e.target.value,
                                    }))
                                  }
                                  rows={2}
                                  placeholder="Add a reply…"
                                  className={fieldClassName}
                                />
                                <div className="flex justify-end">
                                  <Button
                                    size="sm"
                                    disabled={
                                      !(replyDrafts[thread.id] ?? '').trim() || reply.isPending
                                    }
                                    onClick={() =>
                                      reply.mutate({
                                        id: thread.id,
                                        message: replyDrafts[thread.id] ?? '',
                                      })
                                    }
                                  >
                                    Reply
                                  </Button>
                                </div>
                              </div>
                            )}
                            {thread.status === 'open' && (thread.replies ?? []).length > 0 && (
                              <p className="text-xs text-muted">
                                The team will get back to you here.
                              </p>
                            )}
                            {thread.status === 'open' && (thread.replies ?? []).length === 0 && (
                              <p className="text-xs text-muted">Sent — the team will reply here.</p>
                            )}
                            {thread.status === 'closed' && (
                              <p className="text-xs text-muted">This thread is closed.</p>
                            )}
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </div>
        )}
      </Modal>
      {toast && (
        <Toast message={toast.message} tone={toast.tone} onDismiss={() => setToast(null)} />
      )}
    </>
  )
}
