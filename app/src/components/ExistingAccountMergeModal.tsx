import { Button, Panel } from './ui'

type Props = {
  guestCount: number
  remoteCount: number
  busy?: boolean
  onAppend: () => void
  onDiscard: () => void
}

// GUEST_UX.md §3.5 Mode 5: "Ironclad clobber protection". No "Replace
// existing list" option exists — append or discard are the only choices.
// Rendered by LoginPage (login interception, §4.4) and MyCoastersPage (the
// /me reconciliation safety net).
export default function ExistingAccountMergeModal({
  guestCount,
  remoteCount,
  busy = false,
  onAppend,
  onDiscard,
}: Props) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Merge your guest ranking"
      className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4 backdrop-blur-sm"
    >
      <Panel className="w-full max-w-md p-6">
        <h2 className="display-heading text-2xl text-ink">You have coasters in progress</h2>
        <p className="mt-3 text-sm text-muted">
          You selected {guestCount} coaster{guestCount === 1 ? '' : 's'} in this session, and
          already have {remoteCount} coaster{remoteCount === 1 ? '' : 's'} ranked in your account.
        </p>
        <div className="mt-5 flex flex-col gap-2">
          <Button onClick={onAppend} disabled={busy}>
            {busy ? 'Saving…' : `Add ${guestCount} to the bottom of my account`}
          </Button>
          <Button variant="outline" onClick={onDiscard} disabled={busy}>
            Discard session and keep my existing {remoteCount}
          </Button>
        </div>
        <p className="mt-4 text-xs text-muted">
          Your existing order is never replaced — guest coasters join at the bottom.
        </p>
      </Panel>
    </div>
  )
}
