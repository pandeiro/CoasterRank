import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Upload } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import ConfirmEmailGate from '../components/ConfirmEmailGate'
import CoasterSearchBar from '../components/CoasterSearchBar'
import ExistingAccountMergeModal from '../components/ExistingAccountMergeModal'
import ImportListModal, {
  IMPORT_UNDO_MS,
  type AppliedImport,
} from '../components/import/ImportListModal'
import RankedCoasterList, { REMOVE_UNDO_MS, type PendingAdd } from '../components/RankedCoasterList'
import ShareNudgeBanner from '../components/ShareNudgeBanner'
import Toast from '../components/Toast'
import WelcomeModal from '../components/WelcomeModal'
import { persistWelcomeDismissed, readWelcomeDismissed } from '../lib/welcome'
import { Button, MessageState, PageHeader } from '../components/ui'
import { useAuth } from '../lib/auth-context'
import { clearGuestRides, readGuestRanking } from '../lib/guest-rides'
import {
  fetchMyRankedRideIds,
  logGuestMergeDecision,
  materializeGuestRides,
  triageGuestState,
} from '../lib/guest-promotion'
import { applyImport, logImportEvent } from '../lib/import/apply'
import { fetchProfile } from '../lib/profile'
import { dismissShareNudge, useShareNudge } from '../lib/share-nudge'
import { startReplay, stopReplay } from '../lib/sentry'
import { useMyRides } from '../lib/rides'
import { isCoarsePointer } from '../lib/use-media-query'

type ToastAction = { label: string; onClick: () => void }
type ToastState = {
  id: number
  message: string
  tone: 'info' | 'error'
  action?: ToastAction
  durationMs?: number
}

type MergePromptState = {
  remoteIds: string[]
  guestOnlyIds: string[]
  guestCount: number
  remoteCount: number
}

// The sticky search bar only gets its backdrop once it has actually stuck to
// the header — in normal flow it stays transparent so adjacent card shadows
// (header above, first ranked card below) aren't painted over.
const SEARCH_STUCK_ROOT_MARGIN = '-64px 0px 0px 0px'

export default function MyCoastersPage() {
  const { user, isConfirmed } = useAuth()
  const { data: rides, isPending, isError } = useMyRides()
  const qc = useQueryClient()

  // Shared ['profile', userId] cache (same key/shape as ProfilePage/Layout).
  const { data: profile } = useQuery({
    queryKey: ['profile', user?.id],
    enabled: Boolean(user),
    queryFn: () => fetchProfile(user!.id),
  })

  // One-shot share nudge (idle-settled banner). Eligibility comes from the
  // claiming RPC at this page's mount only; dismiss is session-local state.
  const { data: nudge } = useShareNudge()
  const [nudgeDismissed, setNudgeDismissed] = useState(false)

  const [toast, setToast] = useState<ToastState | null>(null)
  const toastSeq = useRef(0)
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const [pendingAdd, setPendingAdd] = useState<PendingAdd | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  // Desktop shortcut from the pending-add banner: one-shot insertion request
  // at either end of the list, so a long list doesn't force a scroll to reach
  // the top/bottom dividers. The list consumes it and clears pendingAdd.
  const [quickInsert, setQuickInsert] = useState<'top' | 'bottom' | null>(null)
  // First-run welcome: shown exactly once, on the first login after signup.
  // The redirect chain (signup / login) lands fresh users on /me?welcome=1;
  // the persisted flag is the backstop (back-button revisit, board-link
  // exit) and the zero-rides guard keeps it from ever firing mid-life.
  const [searchParams, setSearchParams] = useSearchParams()
  const [welcomeDismissed, setWelcomeDismissed] = useState(readWelcomeDismissed)
  const showWelcome =
    isConfirmed &&
    !isPending &&
    !isError &&
    (rides ?? []).length === 0 &&
    searchParams.get('welcome') === '1' &&
    !welcomeDismissed

  const dismissWelcome = useCallback(() => {
    persistWelcomeDismissed()
    setWelcomeDismissed(true)
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete('welcome')
        return next
      },
      { replace: true },
    )
  }, [setSearchParams])
  const searchSentinelRef = useRef<HTMLDivElement>(null)
  const [searchStuck, setSearchStuck] = useState(false)
  // Touch users skip position picking: the add lands at the end of the list
  // instantly and can be long-press dragged into place (keyboard/scroll
  // constraints make the desktop pick-a-position flow hostile on mobile).
  const [isTouch] = useState(isCoarsePointer)

  useEffect(() => {
    const sentinel = searchSentinelRef.current
    if (!sentinel) return
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (entry) setSearchStuck(!entry.isIntersecting)
      },
      { rootMargin: SEARCH_STUCK_ROOT_MARGIN },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    startReplay()
    return () => stopReplay()
  }, [])

  const existingIds = useMemo(() => new Set((rides ?? []).map((r) => r.coaster_id)), [rides])
  const rankedCount = useMemo(() => (rides ?? []).filter((r) => r.rank !== null).length, [rides])
  // The nudge's mini table mirrors the rider share card's top rows.
  const topThree = useMemo(
    () =>
      (rides ?? [])
        .filter((r) => r.rank !== null)
        .slice(0, 3)
        .map((r) => ({
          rank: r.rank as number,
          name: r.coaster.name,
          parkName: r.coaster.park_name ?? null,
        })),
    [rides],
  )
  const parkCount = useMemo(
    () => new Set((rides ?? []).filter((r) => r.rank !== null).map((r) => r.coaster.park_id)).size,
    [rides],
  )
  const showShareNudge = nudge?.eligible === true && !nudgeDismissed

  // Dismiss hides the banner now (local state) AND writes eligible=false into
  // the shareNudge cache — the staleTime Infinity cache would otherwise keep
  // serving the pre-dismiss eligible=true on every SPA remount of /me.
  const handleNudgeDismiss = useCallback(() => {
    setNudgeDismissed(true)
    dismissShareNudge(qc, user?.id)
  }, [qc, user?.id])

  const notify = useCallback(
    (
      message: string,
      tone: ToastState['tone'] = 'info',
      extra?: Omit<ToastState, 'id' | 'message' | 'tone'>,
    ) => {
      toastSeq.current += 1
      setToast({ id: toastSeq.current, message, tone, ...extra })
    },
    [],
  )
  const dismissToast = useCallback(() => setToast(null), [])

  const handleAdd = useCallback((coasterId: string, coasterName: string) => {
    setPendingAdd({ id: coasterId, name: coasterName })
  }, [])

  const clearPendingAdd = useCallback(() => {
    setPendingAdd(null)
    setQuickInsert(null)
  }, [])

  const handleInserted = useCallback(
    (coasterId: string, coasterName: string, rank: number) => {
      notify(`Added ${coasterName} at #${rank}`)
      setHighlightId(coasterId)
      setTimeout(() => setHighlightId(null), 2000)
    },
    [notify],
  )

  // Removal is deferred client-side; the undo action rolls it back with zero
  // server calls. Toast lifetime mirrors the list's undo window.
  const handleRemoved = useCallback(
    (coasterName: string, undo: () => void) => {
      notify(`Removed ${coasterName}`, 'info', {
        action: { label: 'Undo', onClick: undo },
        durationMs: REMOVE_UNDO_MS,
      })
    },
    [notify],
  )

  const handleError = useCallback((message: string) => notify(message, 'error'), [notify])

  // ── Guest reconciliation safety net (GUEST_UX.md §4.4, review round 2 C):
  // a user with a live session can reach /me without visiting /login (left
  // the tab days ago, direct deep link). Runs once per mount after the rides
  // query settles; the login page normally consumes guest state first, so
  // this is a no-op in the common path.
  const reconciledRef = useRef(false)
  const [mergePrompt, setMergePrompt] = useState<MergePromptState | null>(null)

  useEffect(() => {
    if (isPending || isError || !user || !isConfirmed) return
    if (reconciledRef.current) return
    reconciledRef.current = true
    let cancelled = false
    void (async () => {
      const guest = readGuestRanking()
      if (!guest || guest.orderedIds.length === 0) return
      try {
        const remoteIds = await fetchMyRankedRideIds()
        if (cancelled) return
        const verdict = triageGuestState(remoteIds)
        if (verdict.action === 'silent_clear') {
          clearGuestRides()
          return
        }
        if (verdict.action === 'materialize') {
          await materializeGuestRides(
            guest.orderedIds,
            'materialize',
            new Date(guest.createdAt).toISOString(),
          )
          clearGuestRides()
          await qc.invalidateQueries({ queryKey: ['myRides', user.id] })
          notify('Your guest ranking was added to this account')
          return
        }
        if (verdict.action === 'conflict') {
          setMergePrompt({
            remoteIds,
            guestOnlyIds: verdict.guestOnlyIds,
            guestCount: guest.orderedIds.length,
            remoteCount: remoteIds.length,
          })
        }
      } catch {
        if (!cancelled) notify("Couldn't check your guest list — try reloading.", 'error')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isPending, isError, user, isConfirmed, qc, notify])

  const handleMergeAppend = useCallback(async () => {
    if (!mergePrompt) return
    try {
      // §4.4 Rule 3: the COMPLETE merged ladder, guest-only ids at the bottom.
      await materializeGuestRides(
        [...mergePrompt.remoteIds, ...mergePrompt.guestOnlyIds],
        'merge_append',
        null,
      )
      clearGuestRides()
      setMergePrompt(null)
      await qc.invalidateQueries({ queryKey: ['myRides', user?.id] })
    } catch {
      notify("Couldn't save your guest coasters — try again or discard.", 'error')
    }
  }, [mergePrompt, qc, user?.id, notify])

  const handleMergeDiscard = useCallback(async () => {
    await logGuestMergeDecision().catch(() => {})
    clearGuestRides()
    setMergePrompt(null)
  }, [])

  // Bulk-apply undo: restores the pre-import state in one RPC call —
  // replace mode re-inserts the prior ranked list AND re-unranks any
  // holding-pen rows the import promoted (unrankIds), since those rows would
  // otherwise be deleted by the replace and lost entirely.
  const handleImportApplied = useCallback(
    (result: AppliedImport) => {
      const undo = async () => {
        try {
          await applyImport({
            orderedIds: result.priorRankedIds,
            replace: true,
            source: result.source,
            stats: {},
            unrankIds: result.unrankIds,
          })
          void logImportEvent('undo', result.source, { rowsTotal: result.priorRankedIds.length })
          void qc.invalidateQueries({ queryKey: ['myRides', user?.id] })
          notify('Import undone — your previous list is back')
        } catch {
          notify("Couldn't undo the import. Reload the page and remove rows manually.", 'error')
        }
      }
      notify(`Imported ${result.appliedCount} coasters`, 'info', {
        action: { label: 'Undo', onClick: () => void undo() },
        durationMs: IMPORT_UNDO_MS,
      })
    },
    [notify, qc, user?.id],
  )

  if (!isConfirmed) {
    return (
      <div>
        <h1 className="display-heading text-4xl text-ink">My Coasters</h1>
        <div className="mt-6">
          <ConfirmEmailGate email={user?.email} />
        </div>
      </div>
    )
  }

  return (
    <div>
      {/* Custom header layout (vs. PageHeader) so the share nudge can sit
          between the title and the Import list button on mobile — the import
          entry point belongs next to the search/ranking machinery, not
          separated from it by the banner. Desktop keeps Import top-right. */}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-5">
        <div className="order-1 min-w-0 sm:flex-1">
          <PageHeader
            title="My Coasters"
            description={
              rankedCount > 0
                ? `${rankedCount} coaster${rankedCount === 1 ? '' : 's'} ranked`
                : 'Search for coasters below to start building your list.'
            }
          />
        </div>

        {showShareNudge && profile && (
          <div className="order-2 w-full sm:order-3">
            <ShareNudgeBanner
              userId={profile.id}
              username={profile.username}
              displayName={profile.display_name}
              avatarUrl={profile.avatar_url}
              publicList={profile.public_list}
              rankedCount={nudge.ranked_count}
              parkCount={parkCount}
              topThree={topThree}
              onDismiss={handleNudgeDismiss}
            />
          </div>
        )}

        <div className="order-3 w-full sm:order-2 sm:w-auto">
          <Button
            variant="outline"
            size="sm"
            className="w-full sm:w-auto"
            onClick={() => setImportOpen(true)}
          >
            <Upload className="h-3.5 w-3.5" />
            Import list
          </Button>
        </div>
      </div>

      {showWelcome && user?.id && (
        <WelcomeModal
          username={profile?.username ?? null}
          userId={user.id}
          avatarUrl={profile?.avatar_url}
          onClose={dismissWelcome}
          onImportList={() => {
            dismissWelcome()
            setImportOpen(true)
          }}
        />
      )}

      <ImportListModal
        isOpen={importOpen}
        onClose={() => setImportOpen(false)}
        rides={rides ?? []}
        onApplied={handleImportApplied}
        onError={handleError}
      />

      <div ref={searchSentinelRef} aria-hidden="true" className="h-px" />

      <div
        className={`sticky top-16 z-20 pb-3 pt-3 transition-colors duration-200 ${
          searchStuck ? 'bg-canvas/95 backdrop-blur' : ''
        }`}
      >
        <CoasterSearchBar existingCoasterIds={existingIds} onAdd={handleAdd} />
        {pendingAdd && !isTouch && (
          <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 rounded-xl border border-accent/40 bg-accent/10 px-3 py-2 text-sm text-ink-soft">
            <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
              <span>
                Adding <span className="font-medium">{pendingAdd.name}</span> — choose a position
                below or
              </span>
              {(['top', 'bottom'] as const).map((where) => (
                <button
                  key={where}
                  type="button"
                  onClick={() => setQuickInsert(where)}
                  className="rounded-full border border-accent/50 bg-surface px-2 py-0.5 text-xs font-medium text-ink transition-colors hover:bg-accent/20 hover:text-accent-text"
                >
                  Add to {where}
                </button>
              ))}
            </span>
            <button
              type="button"
              onClick={clearPendingAdd}
              className="shrink-0 rounded-full px-2.5 py-1 text-xs text-muted hover:bg-accent/20 hover:text-ink"
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      <div>
        {isPending ? (
          <MessageState>Loading your rides…</MessageState>
        ) : isError ? (
          <MessageState tone="danger">Couldn&apos;t load your rides.</MessageState>
        ) : (
          <RankedCoasterList
            rides={rides}
            highlightId={highlightId}
            pendingAdd={pendingAdd}
            quickInsert={quickInsert}
            instantAdd={isTouch}
            onPendingClear={clearPendingAdd}
            onInserted={handleInserted}
            onRemoved={handleRemoved}
            onError={handleError}
          />
        )}
      </div>

      {/* Scroll headroom so the newest row can rest ~2/3 down the viewport
          instead of flush against the bottom device edge. */}
      <div aria-hidden="true" className="h-[30vh]" />

      {toast && (
        <Toast
          key={toast.id}
          message={toast.message}
          tone={toast.tone}
          durationMs={toast.durationMs}
          action={toast.action}
          onDismiss={dismissToast}
        />
      )}

      {mergePrompt && (
        <ExistingAccountMergeModal
          guestCount={mergePrompt.guestCount}
          remoteCount={mergePrompt.remoteCount}
          busy={false}
          onAppend={() => void handleMergeAppend()}
          onDiscard={() => void handleMergeDiscard()}
        />
      )}
    </div>
  )
}
