// Admin "Feedback" tab: every user feedback thread with its reply history.
// Admins reply inline (which flips the thread to 'replied' server-side via
// the reply trigger), close finished threads, or reopen closed ones.
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RotateCcw, X } from 'lucide-react'
import Avatar from '../ui/Avatar'
import { Badge, Button, fieldClassName, MessageState, Panel } from '../ui'
import {
  getFeedbackThreads,
  replyToFeedback,
  setFeedbackStatus,
  type FeedbackCategory,
  type FeedbackStatus,
  type UserFeedback,
} from '../../lib/feedback'

type Notify = (message: string, tone?: 'info' | 'error') => void

type StatusFilter = 'open' | 'replied' | 'closed' | 'all'

const STATUS_PILL: Record<
  FeedbackStatus,
  { label: string; tone: 'warning' | 'accent' | 'neutral' }
> = {
  open: { label: 'Open', tone: 'warning' },
  replied: { label: 'Replied', tone: 'accent' },
  closed: { label: 'Closed', tone: 'neutral' },
}

const CATEGORY_META: Record<FeedbackCategory, { emoji: string; label: string }> = {
  bug: { emoji: '🐛', label: 'Bug' },
  confusing: { emoji: '😕', label: 'Confusing' },
  missing: { emoji: '➕', label: 'Missing' },
  idea: { emoji: '💡', label: 'Idea' },
}

function formatDate(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString()
}

/** Only linkify relative same-origin paths so hostile context cannot yank admins off-site. */
function isSameAppPath(path: string): boolean {
  return /^\/(?!\/)/.test(path)
}

// One feedback thread with its replies and the admin action row. Owns its
// reply draft state so cards stay independent.
function FeedbackCard({
  feedback,
  onReply,
  onSetStatus,
  busy,
}: {
  feedback: UserFeedback
  onReply: (id: string, message: string, onSuccess: () => void) => void
  onSetStatus: (id: string, status: FeedbackStatus) => void
  busy: boolean
}) {
  const [draft, setDraft] = useState('')
  const meta = CATEGORY_META[feedback.category]
  const status = STATUS_PILL[feedback.status]
  const context = feedback.context ?? {}
  const rawPage = typeof context.page === 'string' ? context.page : null

  return (
    <div className="rounded-xl border border-line bg-surface p-3 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span aria-hidden="true">{meta.emoji}</span>
            <Badge tone={status.tone}>{status.label}</Badge>
            <span className="text-xs text-muted">{formatDate(feedback.created_at)}</span>
          </div>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm text-ink [overflow-wrap:anywhere]">
            {feedback.message}
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
            <Avatar
              src={feedback.profiles?.avatar_url ?? null}
              userId={feedback.submitted_by}
              size={20}
            />
            <span className="text-xs text-muted">
              {feedback.profiles?.username ?? 'Unknown user'}
            </span>
          </div>

          {/* Auto-captured context: reproduce the report without asking. */}
          <dl className="mt-2 space-y-1 rounded-lg border border-line bg-surface-bright p-2 text-xs">
            <div className="flex items-baseline gap-2">
              <dt className="shrink-0 text-muted">Page</dt>
              <dd className="min-w-0 truncate">
                {rawPage ? (
                  isSameAppPath(rawPage) ? (
                    <Link to={rawPage} className="text-accent-strong hover:underline">
                      {rawPage}
                    </Link>
                  ) : (
                    <span>{rawPage}</span>
                  )
                ) : (
                  '—'
                )}
              </dd>
            </div>
            {context.coaster_slug && (
              <div className="flex items-baseline gap-2">
                <dt className="shrink-0 text-muted">Coaster</dt>
                <dd className="min-w-0 truncate">
                  <Link
                    to={`/coasters/${context.coaster_slug}`}
                    className="text-accent-strong hover:underline"
                  >
                    /coasters/{context.coaster_slug}
                  </Link>
                </dd>
              </div>
            )}
            <div className="flex items-baseline gap-2">
              <dt className="shrink-0 text-muted">Screen</dt>
              <dd className="min-w-0 truncate">{context.screen ?? '—'}</dd>
            </div>
            <div className="flex items-baseline gap-2">
              <dt className="shrink-0 text-muted">Language</dt>
              <dd className="min-w-0 truncate">{context.language ?? '—'}</dd>
            </div>
            <div className="flex items-baseline gap-2">
              <dt className="shrink-0 text-muted">Agent</dt>
              <dd className="min-w-0 truncate text-muted" title={context.user_agent ?? undefined}>
                {context.user_agent ?? '—'}
              </dd>
            </div>
          </dl>

          {(feedback.replies ?? []).length > 0 && (
            <div className="mt-2 space-y-2">
              {(feedback.replies ?? []).map((r) => (
                <div
                  key={r.id}
                  className={`rounded-lg px-3 py-2 text-sm ${
                    r.profiles?.is_admin ? 'bg-accent/10' : 'bg-surface-bright'
                  }`}
                >
                  <span className="text-xs font-medium text-muted">
                    {r.profiles?.is_admin ? 'Team' : (r.profiles?.username ?? 'User')} ·{' '}
                    {formatDate(r.created_at)}
                  </span>
                  <p className="mt-0.5 whitespace-pre-wrap break-words text-ink-soft [overflow-wrap:anywhere]">
                    {r.message}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex shrink-0 gap-2">
          {feedback.status === 'closed' ? (
            <button
              onClick={() => onSetStatus(feedback.id, 'open')}
              disabled={busy}
              className="rounded-full bg-surface-bright p-2 text-muted hover:bg-surface hover:text-ink disabled:opacity-50"
              title="Reopen"
              aria-label="Reopen thread"
            >
              <RotateCcw size={16} />
            </button>
          ) : (
            <button
              onClick={() => onSetStatus(feedback.id, 'closed')}
              disabled={busy}
              className="rounded-full bg-surface-bright p-2 text-muted hover:bg-surface hover:text-ink disabled:opacity-50"
              title="Close thread"
              aria-label="Close thread"
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Admin reply: always available (reopens closed threads implicitly —
          the reply trigger flips status back to 'replied'). */}
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <textarea
          aria-label={`Reply to feedback from ${feedback.profiles?.username ?? 'user'}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={2}
          placeholder="Write a reply…"
          className={`flex-1 ${fieldClassName}`}
        />
        <Button
          size="sm"
          disabled={!draft.trim() || busy}
          onClick={() => {
            onReply(feedback.id, draft, () => setDraft(''))
          }}
        >
          Reply
        </Button>
      </div>
    </div>
  )
}

export default function FeedbackPanel({ notify }: { notify: Notify }) {
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState<StatusFilter>('open')

  const {
    data: threads = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['admin-feedback'],
    queryFn: getFeedbackThreads,
    // Small dataset (capped at 5 open per user); refetch on tab focus keeps
    // the queue current after Telegram-prompted visits.
    refetchOnWindowFocus: true,
  })

  const reply = useMutation({
    mutationFn: ({ id, message }: { id: string; message: string; onSuccess?: () => void }) =>
      replyToFeedback(id, message),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['admin-feedback'] })
      vars.onSuccess?.()
      notify('Reply sent.')
    },
    onError: (error: Error) => notify(`Couldn't send reply: ${error.message}`, 'error'),
  })

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: FeedbackStatus }) =>
      setFeedbackStatus(id, status),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['admin-feedback'] })
      notify(vars.status === 'closed' ? 'Thread closed.' : 'Thread reopened.')
    },
    onError: (error: Error) => notify(`Couldn't update thread: ${error.message}`, 'error'),
  })

  const visible = useMemo(
    () => (filter === 'all' ? threads : threads.filter((t) => t.status === filter)),
    [threads, filter],
  )

  const counts: Record<StatusFilter, number> = {
    open: threads.filter((t) => t.status === 'open').length,
    replied: threads.filter((t) => t.status === 'replied').length,
    closed: threads.filter((t) => t.status === 'closed').length,
    all: threads.length,
  }

  const busy = reply.isPending || setStatus.isPending

  return (
    <Panel bleed className="p-3 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-ink">Feedback</h2>
        <div className="flex gap-1 rounded-full bg-surface p-1 text-xs">
          {(
            [
              ['open', `Open (${counts.open})`],
              ['replied', `Replied (${counts.replied})`],
              ['closed', `Closed (${counts.closed})`],
              ['all', `All (${counts.all})`],
            ] as Array<[StatusFilter, string]>
          ).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setFilter(value)}
              className={`rounded-full px-2.5 py-1 transition-colors ${
                filter === value
                  ? 'bg-surface-bright font-medium text-ink shadow-sm'
                  : 'text-muted hover:text-ink'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <MessageState>Loading feedback…</MessageState>
      ) : isError ? (
        <MessageState tone="danger">Couldn&apos;t load feedback.</MessageState>
      ) : visible.length === 0 ? (
        <MessageState>
          {filter === 'all' ? 'No feedback yet.' : `No ${filter} threads.`}
        </MessageState>
      ) : (
        <div className="space-y-4">
          {visible.map((t) => (
            <FeedbackCard
              key={t.id}
              feedback={t}
              busy={busy}
              onReply={(id, message, onSuccess) => reply.mutate({ id, message, onSuccess })}
              onSetStatus={(id, status) => setStatus.mutate({ id, status })}
            />
          ))}
        </div>
      )}
    </Panel>
  )
}
