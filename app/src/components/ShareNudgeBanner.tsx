import { Link } from 'react-router-dom'
import { X } from 'lucide-react'
import { riderPageUrl } from '../lib/rider'
import { CopyLinkButton } from './CopyLinkButton'
import Avatar from './ui/Avatar'
import { Panel } from './ui'

export type ShareNudgeBannerProps = {
  userId: string
  username: string | null
  displayName: string | null
  avatarUrl: string | null
  publicList: boolean
  rankedCount: number
  topPick: string | null
  onDismiss: () => void
}

/**
 * The subtle share nudge on My Coasters: a flat, simplified preview of the
 * rider share card (avatar, name, ranked count, #1 pick) with the one action
 * that's still missing (claim username → opt in → copy/preview). Eligibility
 * is one-shot server-side (see lib/share-nudge.ts); dismissal is
 * session-local state only.
 */
export default function ShareNudgeBanner({
  userId,
  username,
  displayName,
  avatarUrl,
  publicList,
  rankedCount,
  topPick,
  onDismiss,
}: ShareNudgeBannerProps) {
  const url = username && publicList ? riderPageUrl(username) : null

  return (
    <Panel className="relative p-4" data-testid="share-nudge-banner">
      <button
        type="button"
        onClick={onDismiss}
        className="absolute right-2 top-2 rounded-full p-1.5 text-muted transition-colors hover:bg-surface hover:text-ink"
        aria-label="Dismiss"
      >
        <X size={14} />
      </button>

      {username ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 pr-6">
          <Avatar src={avatarUrl} userId={userId} size={36} />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-ink">{displayName || username}</p>
            <p className="truncate text-xs text-muted">
              @{username} · {rankedCount} ranked{topPick ? ` · #1 ${topPick}` : ''}
            </p>
          </div>
          {url ? (
            <div className="flex flex-wrap items-center gap-2">
              <code className="max-w-full truncate rounded bg-surface px-2 py-1 font-mono text-xs text-ink-soft">
                {url}
              </code>
              <CopyLinkButton url={url} label="Copy" />
              <Link
                to={`/riders/${username}`}
                className="text-sm font-medium text-ink underline-offset-4 hover:underline"
              >
                Preview
              </Link>
            </div>
          ) : (
            <Link
              to="/me/profile"
              className="rounded-full bg-ink px-3 py-1.5 text-sm font-medium text-canvas transition-colors hover:bg-ink-soft"
            >
              Turn on sharing
            </Link>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 pr-6">
          <p className="text-sm text-muted">
            Claim a username and your ranking gets its own shareable page at{' '}
            <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-xs">
              /riders/your-name
            </code>
            .
          </p>
          <Link
            to="/me/profile"
            className="rounded-full bg-ink px-3 py-1.5 text-sm font-medium text-canvas transition-colors hover:bg-ink-soft"
          >
            Claim your username
          </Link>
        </div>
      )}
    </Panel>
  )
}
