import { useState } from 'react'
import { Link } from 'react-router-dom'
import { riderPageUrl } from '../lib/rider'
import { CopyLinkButton } from './CopyLinkButton'
import Avatar from './ui/Avatar'

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
 * The subtle share nudge on My Coasters: three tight columns on one
 * accent-tinted banner — the "Want to share your board?" question, a condensed
 * skeleton of the rider share page (identity + top-3, Racing Sans One ranks,
 * #1 coral), and YES / NOT RIGHT NOW buttons. YES unfurls the copyable rider
 * link, or the profile-settings instructions when sharing isn't on (or the
 * username isn't claimed — rare: handle_new_user() falls back to NULL only on
 * signup unique-violation races). Eligibility is one-shot server-side (see
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
  topThree,
  onDismiss,
}: ShareNudgeBannerProps) {
  const [unfurled, setUnfurled] = useState(false)
  const url = username && publicList ? riderPageUrl(username) : null
  // Display without the protocol — the copy button still copies the full URL.
  const urlShown = url?.replace(/^https?:\/\//, '')

  return (
    // Plain div, not Panel — Panel's bg-surface-bright/border-line would win
    // the cascade over the banner's accent tint.
    <div
      className="rounded-xl border border-accent/30 bg-accent/10 p-4 shadow-panel sm:p-5"
      data-testid="share-nudge-banner"
    >
      {/* Desktop only: the column cluster is capped at max-w-5xl and centered
          so leftover space moves to the banner's own padding instead of
          pooling between the columns; justify-between then splits the small
          remainder evenly across the two gutters. Columns stay content-width
          (no flex-1 growth) and shrink gracefully below the cap; mobile
          stacks unwrapped and keeps the rows directly on the tint. */}
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-x-5 gap-y-4">
        <div className="min-w-0 flex-1 basis-52 sm:w-[260px] sm:flex-none">
          <p className="display-heading text-xl leading-tight text-ink">
            Want to share your board?
          </p>
          <p className="mt-1.5 text-sm leading-snug text-muted">Put your top 3 on the internet.</p>
        </div>

        <div className="min-w-0 flex-1 basis-72 sm:w-[440px] sm:basis-auto sm:grow-0 sm:rounded-xl sm:border sm:border-accent/30 sm:bg-surface-bright/70 sm:p-3.5">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            <Avatar
              src={avatarUrl}
              userId={userId}
              size={36}
              className="shrink-0 ring-2 ring-accent"
            />
            <div className="min-w-0">
              <p className="display-heading truncate text-sm leading-tight text-ink">
                {displayName || username || 'Your board'}
              </p>
              {username && (
                <p className="truncate text-[11px] font-medium text-accent-ink">@{username}</p>
              )}
            </div>
            <div className="ml-auto flex shrink-0 gap-1.5">
              <span className={pillCoral}>{rankedCount} ranked</span>
              {parkCount > 0 && <span className={pillCyan}>{parkCount} parks</span>}
            </div>
          </div>
          {topThree.length > 0 && (
            <ul className="mt-1 divide-y divide-accent/20">
              {topThree.map((ride) => (
                <li key={ride.rank} className="flex items-center gap-2.5 py-1.5 first:pt-2">
                  <span
                    className={`display-heading w-6 text-center text-[13px] leading-none ${
                      ride.rank === 1 ? 'text-coral-text' : 'text-muted'
                    }`}
                  >
                    #{ride.rank}
                  </span>
                  <span className="min-w-0 truncate text-[13px] leading-snug text-ink">
                    {ride.name}
                    {ride.parkName && (
                      <span className="text-[11px] text-muted"> · {ride.parkName}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex w-full gap-2 sm:w-auto sm:flex-col sm:shrink-0 sm:gap-2">
          <button
            type="button"
            onClick={() => setUnfurled(true)}
            className="flex-1 rounded-full bg-coral-text px-5 py-2 text-xs font-bold uppercase tracking-[0.14em] text-canvas transition-colors hover:bg-coral-text/85 sm:flex-none"
          >
            Yes
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-full px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted transition-colors hover:text-ink"
          >
            Not right now
          </button>
        </div>
      </div>

      {unfurled && (
        <div className="mt-4 animate-unfurl border-t border-accent/25 pt-3">
          {url ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span className="w-full min-w-0 truncate font-mono text-xs text-ink-soft sm:w-auto sm:flex-1 sm:basis-40">
                {urlShown}
              </span>
              <CopyLinkButton url={url} label="Copy" />
              <Link
                to={`/riders/${username}`}
                className="text-sm font-medium text-ink underline-offset-4 hover:underline"
              >
                Preview
              </Link>
            </div>
          ) : username ? (
            <p className="text-sm leading-snug text-muted">
              Turn on public sharing in your{' '}
              <Link to="/me/profile" className="link-brand">
                profile settings
              </Link>{' '}
              — your page is already waiting at{' '}
              <code className="rounded bg-surface px-1 py-0.5 font-mono text-xs">
                /riders/{username}
              </code>
              .
            </p>
          ) : (
            <p className="text-sm leading-snug text-muted">
              Claim a username in your{' '}
              <Link to="/me/profile" className="link-brand">
                profile settings
              </Link>{' '}
              and your board gets its own page at{' '}
              <code className="rounded bg-surface px-1 py-0.5 font-mono text-xs">
                /riders/your-name
              </code>
              .
            </p>
          )}
        </div>
      )}
    </div>
  )
}
