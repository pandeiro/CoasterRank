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
  parkCount: number
  topPick: string | null
  onDismiss: () => void
}

const pill =
  'rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]'
const pillCoral = `${pill} border-coral/50 text-coral`
const pillAccent = `${pill} border-accent/50 text-accent`
const pillNeutral = `${pill} border-canvas/25 text-canvas/80`

/**
 * The subtle share nudge on My Coasters: "Share your board anytime" over a
 * flat, simplified take on the rider OG share card (dark mini-card with the
 * avatar, display-font name, cyan @handle, and the ranked/parks/#1 pills)
 * plus the one action that's still missing (claim username → opt in →
 * copy/preview). Eligibility is one-shot server-side (see
 * lib/share-nudge.ts); dismissal is session-local state only.
 */
export default function ShareNudgeBanner({
  userId,
  username,
  displayName,
  avatarUrl,
  publicList,
  rankedCount,
  parkCount,
  topPick,
  onDismiss,
}: ShareNudgeBannerProps) {
  const url = username && publicList ? riderPageUrl(username) : null

  return (
    <Panel className="relative p-4 sm:p-5" data-testid="share-nudge-banner">
      <button
        type="button"
        onClick={onDismiss}
        className="absolute right-2 top-2 rounded-full p-1.5 text-muted transition-colors hover:bg-surface hover:text-ink"
        aria-label="Dismiss"
      >
        <X size={14} />
      </button>

      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent-ink">
        Share your board anytime
      </p>

      {username ? (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-3 pr-6">
          <div className="flex min-w-0 flex-1 basis-80 items-center gap-3 rounded-xl bg-ink p-3.5 sm:p-4">
            <Avatar
              src={avatarUrl}
              userId={userId}
              size={40}
              className="shrink-0 ring-2 ring-accent"
            />
            <div className="min-w-0">
              <p className="display-heading truncate text-lg leading-tight text-canvas">
                {displayName || username}
              </p>
              <p className="truncate text-xs font-medium text-accent">@{username}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <span className={pillCoral}>{rankedCount} ranked</span>
                {parkCount > 0 && <span className={pillAccent}>{parkCount} parks</span>}
                {topPick && <span className={pillNeutral}>#1 {topPick}</span>}
              </div>
            </div>
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
            <div className="max-w-64">
              <p className="text-sm text-muted">
                Your page is ready — turn on public sharing to make{' '}
                <code className="rounded bg-surface px-1 py-0.5 font-mono text-xs">
                  /riders/{username}
                </code>{' '}
                visible.
              </p>
              <Link
                to="/me/profile"
                className="mt-2 inline-block rounded-full bg-ink px-4 py-2 text-sm font-medium text-canvas transition-colors hover:bg-ink-soft"
              >
                Turn on sharing
              </Link>
            </div>
          )}
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-3 pr-6">
          <p className="text-sm text-muted">
            Claim a username and your ranking gets its own shareable page at{' '}
            <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-xs">
              /riders/your-name
            </code>
            .
          </p>
          <Link
            to="/me/profile"
            className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-canvas transition-colors hover:bg-ink-soft"
          >
            Claim your username
          </Link>
        </div>
      )}
    </Panel>
  )
}
