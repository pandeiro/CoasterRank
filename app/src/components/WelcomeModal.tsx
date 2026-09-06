import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Camera, Lock } from 'lucide-react'
import { useAllCoasters } from '../lib/coasters'
import { useAvatarUpload } from '../lib/use-avatar-upload'
import Avatar from './ui/Avatar'
import { Badge, Button, Modal } from './ui'

// A taste of what a finished ranking looks like: 5 coasters sampled from the
// current top 20, reshuffled once per mount so repeat views feel fresh. Real
// board data (not hard-coded names) so the preview never goes stale.
function useExampleTopFive() {
  const { data } = useAllCoasters()
  return useMemo(() => {
    const top = (data ?? [])
      .filter((r) => r.rank !== null)
      .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
      .slice(0, 20)
    for (let i = top.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[top[i], top[j]] = [top[j]!, top[i]!]
    }
    return top.slice(0, 5)
  }, [data])
}

export default function WelcomeModal({
  username,
  userId,
  avatarUrl,
  onClose,
}: {
  username: string | null
  userId: string
  avatarUrl: string | null | undefined
  onClose: () => void
}) {
  const example = useExampleTopFive()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { upload, isUploading, error: uploadError } = useAvatarUpload(userId)
  const [photoDone, setPhotoDone] = useState(false)

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      await upload(file)
      setPhotoDone(true)
    } catch {
      // Error surfaces via the hook's error state below.
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={username ? `You're in, ${username}!` : "You're in!"}
      panelClassName="max-w-lg"
    >
      <p className="text-sm leading-6 text-muted">
        Rank the coasters you&apos;ve ridden and CoasterRank builds your personal list — which also
        feeds the live community board.
      </p>

      {/* Example preview: what a finished ranking looks like. */}
      <div className="mt-4 overflow-hidden rounded-xl border border-line bg-surface">
        <div className="flex items-center justify-between border-b border-line px-4 py-2">
          <span className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
            What yours will look like
          </span>
          <Badge tone="neutral">Example</Badge>
        </div>
        <ol>
          {example.length === 0 ? (
            <li className="px-4 py-3 text-sm text-muted">Loading popular coasters…</li>
          ) : (
            example.map((row, i) => (
              <li
                key={row.id}
                className="flex items-baseline gap-3 border-b border-line/60 px-4 py-2 text-sm last:border-0"
              >
                <span className="display-heading w-5 shrink-0 text-base text-muted">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate font-medium text-ink">{row.name}</span>
                {row.park_name && (
                  <span className="hidden shrink-0 text-xs text-muted sm:inline">
                    {row.park_name}
                  </span>
                )}
              </li>
            ))
          )}
        </ol>
      </div>

      {/* Optional avatar: one tap, never a blocker. */}
      <div className="mt-4 flex items-center gap-3">
        <Avatar src={avatarUrl} userId={userId} size={44} />
        <div className="min-w-0 text-sm">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="inline-flex items-center gap-1.5 font-medium text-ink underline underline-offset-4 disabled:opacity-50"
          >
            <Camera size={14} />
            {isUploading ? 'Uploading…' : photoDone ? 'Photo added!' : 'Add a photo (optional)'}
          </button>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            ref={fileInputRef}
            onChange={handleFileChange}
            disabled={isUploading}
            aria-label="Upload profile photo"
          />
          {uploadError && <p className="mt-0.5 text-xs text-danger">{uploadError}</p>}
          {!uploadError && (
            <p className="mt-0.5 text-xs text-muted">Shows on your public page if you share it.</p>
          )}
        </div>
      </div>

      <p className="mt-4 flex items-start gap-2 rounded-xl bg-surface px-3 py-2.5 text-xs leading-5 text-muted">
        <Lock size={14} className="mt-0.5 shrink-0" />
        <span>
          Your ranking is <strong className="text-ink">private by default</strong> — only you can
          see it. You can share it publicly anytime from your profile.
        </span>
      </p>

      <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button type="button" variant="coral" size="lg" onClick={onClose} className="flex-1">
          Start ranking
        </Button>
        <Link
          to="/"
          onClick={onClose}
          className="text-center text-sm font-medium text-muted underline-offset-4 hover:text-ink hover:underline"
        >
          See the live board first
        </Link>
      </div>
    </Modal>
  )
}
