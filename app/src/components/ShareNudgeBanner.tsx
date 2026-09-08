import { Link } from 'react-router-dom'
import { X } from 'lucide-react'
import { riderPageUrl } from '../lib/rider'
import { CopyLinkButton } from './CopyLinkButton'
import Avatar from './ui/Avatar'
import { Panel } from './ui'

export type ShareNudgeTopRide = {
  rank: number
  name: string
  parkName: string | null
}

export type ShareNudgeBannerProps = {
  userId: string
  username: string | null
  displayName: string | null
  avatarUrl: string | null
  publicList: boolean
  rankedCount: number
  parkCount: number
  topThree: ShareNudgeTopRide[]
  onDismiss: () => void
}

const pill =
  'rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]'
const pillCoral = `${pill} border-coral/40 text-coral-text`
const pillCyan = `${pill} border-accent-dark/40 text-accent-ink`

/**
 * The subtle share nudge on My Coasters: "Share your board anytime" over a
 * flat, simplified take on the rider OG share card — an accent-tinted
 * mini-card with the avatar, display-font name, ranked/parks pills, a live
 * top-3 mini table, and the copyable rider URL right in the card. The
 * turn-on/claim CTA covers whatever step is still missing. Eligibility is
 * one-shot server-side (see lib/share-nudge.ts); dismissal is session-local
 * state only.
 */
export default function ShareNudgeBanner({
  userId,
  username,
  displayName,
  avatarUrl,
  publicList,
  rankedCount,
  parkCount,
  topThree,
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
        <div className="mt-3 rounded-xl border border-accent/30 bg-accent/10 p-3.5 pr-4 sm:p-4">
          <div className="flex flex-wrap gap-3">
            <div className="flex min-w-0 flex-1 basis-64 items-center gap-3">
              <Avatar
                src={avatarUrl}
                userId={userId}
                size={40}
                className="shrink-0 ring-2 ring-accent"
              />
              <div className="min-w-0">
                <p className="display-heading truncate text-lg leading-tight text-ink">
                  {displayName || username}
                </p>
                <p className="truncate text-xs font-medium text-accent-ink">@{username}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <span className={pillCoral}>{rankedCount} ranked</span>
                  {parkCount > 0 && <span className={pillCyan}>{parkCount} parks</span>}
                </div>
              </div>
            </div>

            {topThree.length > 0 && (
              <div className="min-w-0 flex-1 basis-64 rounded-lg bg-surface-bright p-3">
                <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
                  <span className="h-1.5 w-1.5 rounded-full bg-coral" aria-hidden="true" />
                  Top 3
                </p>
                <ul className="mt-1 divide-y divide-line">
                  {topThree.map((ride) => (
                    <li key={ride.rank} className="flex items-baseline gap-2 py-1.5 first:pt-1">
                      <span
                        className={`text-xs font-semibold ${
                          ride.rank === 1 ? 'text-coral-text' : 'text-muted'
                        }`}
                      >
                        #{ride.rank}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm leading-snug text-ink">
                          {ride.name}
                        </span>
                        {ride.parkName && (
                          <span className="block truncate text-xs leading-snug text-muted">
                            {ride.parkName}
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {url ? (
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-accent/20 pt-3">
              <code className="min-w-0 flex-1 truncate rounded bg-surface-bright px-2 py-1 font-mono text-xs text-ink-soft">
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
            <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-accent/20 pt-3">
              <p className="text-sm text-muted">
                Your page is ready — turn on public sharing to make{' '}
                <code className="rounded bg-surface-bright px-1 py-0.5 font-mono text-xs">
                  /riders/{username}
                </code>{' '}
                visible.
              </p>
              <Link
                to="/me/profile"
                className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-canvas transition-colors hover:bg-ink-soft"
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
