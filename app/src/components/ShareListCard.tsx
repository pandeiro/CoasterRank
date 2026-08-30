import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, Link2, Share2, X } from 'lucide-react'
import { riderPageUrl } from '../lib/rider'
import { copyToClipboard } from '../lib/clipboard'
import { Button, Panel } from './ui'

export function CopyLinkButton({ url, label = 'Copy link' }: { url: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => clearTimeout(timerRef.current), [])

  const onCopy = useCallback(async () => {
    const ok = await copyToClipboard(url)
    if (ok) {
      setCopied(true)
      clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setCopied(false), 1500)
    }
  }, [url])

  return (
    <Button type="button" variant="outline" size="sm" onClick={onCopy}>
      {copied ? <Check size={14} className="text-success" /> : <Link2 size={14} />}
      {copied ? 'Copied!' : label}
    </Button>
  )
}

/**
 * Native share sheet on supporting (mobile) browsers; hidden elsewhere.
 */
function WebShareButton({ url, title }: { url: string; title: string }) {
  const supported = typeof navigator.share === 'function'
  if (!supported) return null

  async function onShare() {
    try {
      await navigator.share({ url, title })
    } catch {
      // User cancelled the share sheet — nothing to do.
    }
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={onShare}>
      <Share2 size={14} />
      Share…
    </Button>
  )
}

export type ShareListCardProps = {
  username: string | null
  publicList: boolean
  rankedCount: number
  /** 1 = first milestone (5+), 2 = stronger nudge (10+). */
  milestone: 1 | 2
  onDismiss: () => void
}

/**
 * The share nudge on My Coasters. Leads the user through whatever is missing
 * (username → opt-in → copy/share the live page) and is dismissible; the page
 * persists dismissal per milestone.
 */
export default function ShareListCard({
  username,
  publicList,
  rankedCount,
  milestone,
  onDismiss,
}: ShareListCardProps) {
  const url = username ? riderPageUrl(username) : null
  const live = Boolean(username && publicList)

  // State-aware heading (issue #91): "Your list is taking shape" clashed with
  // the "your page is ready" body once a username existed, and with the live
  // body once sharing was on. Milestone 2 stays count-led regardless of state.
  let heading: string
  if (milestone === 2) {
    heading = `${rankedCount} coasters ranked!`
  } else if (!username) {
    heading = 'Your list is taking shape'
  } else if (!publicList) {
    heading = 'Your page is ready'
  } else {
    heading = 'Your ranking is live'
  }

  return (
    <Panel
      className={`relative p-5 ${milestone === 2 ? 'border-accent/50 shadow-accent' : ''}`}
      data-testid="share-list-card"
    >
      <button
        type="button"
        onClick={onDismiss}
        className="absolute right-3 top-3 rounded-full p-1.5 text-muted transition-colors hover:bg-surface hover:text-ink"
        aria-label="Dismiss"
      >
        <X size={14} />
      </button>

      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent-strong">
        {milestone === 2 ? 'Milestone unlocked' : 'Milestone'}
      </p>
      <h2 className="display-heading mt-1 text-2xl text-ink">{heading}</h2>

      <div className="mt-3">
        {!username ? (
          <>
            <p className="text-sm text-muted">
              Claim a username and your ranking gets its own shareable page at{' '}
              <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-xs">
                /riders/your-name
              </code>
              .
            </p>
            <Link
              to="/me/profile"
              className="mt-3 inline-block rounded-full bg-ink px-4 py-2 text-sm font-medium text-canvas transition-colors hover:bg-ink-soft"
            >
              Claim your username
            </Link>
          </>
        ) : !publicList ? (
          <>
            <p className="text-sm text-muted">
              Your page is ready — turn on public sharing to make{' '}
              <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-xs">
                /riders/{username}
              </code>{' '}
              visible to everyone.
            </p>
            <Link
              to="/me/profile"
              className="mt-3 inline-block rounded-full bg-ink px-4 py-2 text-sm font-medium text-canvas transition-colors hover:bg-ink-soft"
            >
              Turn on sharing
            </Link>
          </>
        ) : (
          <>
            <p className="text-sm text-muted">
              Your ranking is live and worth an audience. Send it to your park crew.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <code className="max-w-full truncate rounded bg-surface px-2 py-1 font-mono text-xs text-ink-soft">
                {url}
              </code>
              {url && <CopyLinkButton url={url} />}
              {url && <WebShareButton url={url} title="My coaster ranking on CoasterRank" />}
              <Link
                to={`/riders/${username}`}
                className="text-sm font-medium text-ink underline-offset-4 hover:underline"
              >
                Preview
              </Link>
            </div>
          </>
        )}
      </div>

      {!live && rankedCount >= 10 && (
        <p className="mt-3 text-xs text-muted">
          You&apos;re at {rankedCount} ranked coasters — the more you rank, the better your page
          looks when you share it.
        </p>
      )}
    </Panel>
  )
}
