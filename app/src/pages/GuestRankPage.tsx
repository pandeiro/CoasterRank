import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, Link, useNavigate } from 'react-router-dom'
import { Helmet } from 'react-helmet-async'
import { useQueryClient } from '@tanstack/react-query'
import RankedCoasterList, {
  REMOVE_UNDO_MS,
  type RankingStorageAdapter,
} from '../components/RankedCoasterList'
import Toast from '../components/Toast'
import { Button, Panel } from '../components/ui'
import { useAuth } from '../lib/auth-context'
import {
  clearGuestRides,
  lockGuestOrderOnWorkbenchVisit,
  removeGuestRideById,
  reorderGuestRideList,
  useGuestRides,
  userRidesFromGuestState,
} from '../lib/guest-rides'
import { materializeGuestRides } from '../lib/guest-promotion'
import { useMyRides } from '../lib/rides'

type ToastAction = { label: string; onClick: () => void }
type ToastState = {
  id: number
  message: string
  tone: 'info' | 'error'
  action?: ToastAction
  durationMs?: number
}

// GUEST_UX.md §3.3 Mode 3: the ranking workbench. The exact /me sortable card
// UI, backed by the localStorage guest store instead of Supabase.
export default function GuestRankPage() {
  const { user, isLoading: authLoading } = useAuth()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const guest = useGuestRides()
  const rides = useMemo(
    () => (guest.state ? userRidesFromGuestState(guest.state) : []),
    [guest.state],
  )
  const [saving, setSaving] = useState(false)

  // §3.1 routing: a logged-in user with rides owns /me — send them there.
  // A logged-in user with ZERO rides gets the workbench in seed mode: Save
  // materializes via materialize_guest_rides (no signup, no merge modal).
  const { data: myRides, isPending: ridesPending } = useMyRides()
  const authedHasRides = Boolean(user) && (myRides?.some((r) => r.rank !== null) ?? false)
  const authedRedirect = !authLoading && Boolean(user) && (authedHasRides || ridesPending)

  // Order lifecycle (§3.3.5 Phase 2): the first workbench visit locks the
  // order — later "+ Add More Coasters" selections append to the bottom.
  // One-shot per mount: this is the trip-wire, not a reactive effect.
  useEffect(() => {
    lockGuestOrderOnWorkbenchVisit()
  }, [])

  const [toast, setToast] = useState<ToastState | null>(null)
  const toastSeq = useRef(0)
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

  // Guest storage adapter (§3.2): persists through the local store; the
  // save path doubles as the drag-reorder commit and locks the order.
  const storage: RankingStorageAdapter = useMemo(
    () => ({
      isLocal: true,
      saveRanks: async (orderedIds) => {
        reorderGuestRideList(orderedIds)
      },
      removeRide: async (coasterId) => {
        removeGuestRideById(coasterId)
      },
    }),
    [],
  )

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

  const handleSave = useCallback(() => {
    const state = guest.state
    if (!state || saving) return
    if (!user) {
      // Guest path: the signup payload rides auth metadata (§4.1); the
      // confirmed login materializes it.
      navigate('/signup?from=guest')
      return
    }
    // Seed mode (§3.1): a zero-ride account adopts the guest ranking
    // directly through the RPC.
    setSaving(true)
    void materializeGuestRides(
      state.orderedIds,
      'materialize',
      new Date(state.createdAt).toISOString(),
    )
      .then(async () => {
        clearGuestRides()
        await qc.invalidateQueries({ queryKey: ['myRides', user.id] })
        navigate('/me')
      })
      .catch(() => notify("Couldn't save your ranking. Please try again.", 'error'))
      .finally(() => setSaving(false))
  }, [guest.state, saving, user, navigate, qc, notify])

  const handleAddMore = useCallback(() => {
    navigate('/?mark=1')
  }, [navigate])

  if (authLoading || (Boolean(user) && ridesPending)) {
    return <Panel className="text-center text-sm text-muted">Loading…</Panel>
  }
  if (authedRedirect) {
    return <Navigate to="/me" replace />
  }

  if (!guest.state || guest.count === 0) {
    // §3.3.4: direct/empty visits get the explainer, not a blank page.
    return (
      <div className="mx-auto max-w-xl">
        <Helmet>
          <title>Rank Your Rides — CoasterRank</title>
        </Helmet>
        <Panel className="mt-8 p-8 text-center">
          <h1 className="display-heading text-3xl text-ink">Rank My Rides</h1>
          <p className="mx-auto mt-3 max-w-sm text-sm text-muted">
            Nothing marked yet. Head back to the board, tap the coasters you've ridden, and drag
            them into your own ranking here.
          </p>
          <Button className="mt-6" onClick={handleAddMore}>
            Rank My Rides
          </Button>
          <p className="mx-auto mt-4 max-w-xs text-xs text-muted">
            Have a big list? You can also just import a spreadsheet once you{' '}
            <Link to="/signup" className="link-brand">
              Sign Up
            </Link>
            .
          </p>
        </Panel>
      </div>
    )
  }

  return (
    <div>
      <Helmet>
        <title>Rank Your Rides — CoasterRank</title>
      </Helmet>
      <div className="mb-4 rounded-xl border border-accent/40 bg-accent/10 px-4 py-3 text-sm">
        <p className="font-semibold text-ink">New Rider Ranking</p>
        <p className="mt-0.5 text-muted">
          Drag to re-order your lineup. Create a free account to join the global board and save your
          list.
        </p>
        {/* Power-user escape hatch (§3.3): someone with an existing
            spreadsheet wants to jump straight to import after signup, not
            toy-rank first. No import integration in the guest flow. */}
        <p className="mt-1.5 text-xs text-muted">
          Have a big list? You can also just import a spreadsheet once you{' '}
          <Link to="/signup" className="link-brand">
            Sign Up
          </Link>
          .
        </p>
      </div>

      <RankedCoasterList
        rides={rides}
        storage={storage}
        onRemoved={handleRemoved}
        onError={handleError}
      />

      {/* Scroll headroom so the sticky footer never covers the last card. */}
      <div aria-hidden="true" className="h-24" />

      <div className="sticky bottom-0 z-20 -mx-2 border-t border-line/70 bg-canvas/95 px-2 py-3 backdrop-blur sm:-mx-3 sm:px-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Button variant="outline" size="sm" onClick={handleAddMore}>
            + Add More Coasters
          </Button>
          {/* Coral: the brand "YES" pill tone (share banner precedent) — the
              save action pops via color, no motion gimmicks. */}
          <Button variant="coral" size="md" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save Ranking & Join Board'}
          </Button>
        </div>
      </div>

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
    </div>
  )
}
