import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import * as Sentry from '@sentry/react'
import { useQueryClient } from '@tanstack/react-query'
import ExistingAccountMergeModal from '../components/ExistingAccountMergeModal'
import { Button, fieldClassName, Panel } from '../components/ui'
import { useAuth } from '../lib/auth-context'
import { clearGuestRides, exitGuestMarkMode, readGuestRanking } from '../lib/guest-rides'
import {
  fetchMyRankedRideIds,
  isGuestStaleError,
  logGuestMergeDecision,
  materializeGuestRides,
  readPendingGuestPayload,
  triageGuestState,
  wipePendingGuestPayload,
} from '../lib/guest-promotion'
import { supabase } from '../lib/supabase'

type LocationState = { from?: string }

type MergePrompt = {
  guestCount: number
  remoteCount: number
  remoteIds: string[]
  guestOnlyIds: string[]
  startedAtIso: string | null
}

export default function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const { session, user, isLoading } = useAuth()
  const qc = useQueryClient()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [resent, setResent] = useState(false)
  const [resending, setResending] = useState(false)
  const [resendError, setResendError] = useState<string | null>(null)

  // Passwordless sign-in: after requesting a magic link the form swaps for a
  // "check your email" panel with a code-entry field (the email carries both
  // a one-click link and an 8-digit code, so sign-in works cross-device).
  const [magicSent, setMagicSent] = useState(false)
  const [code, setCode] = useState('')
  const [magicError, setMagicError] = useState<string | null>(null)
  const [magicSubmitting, setMagicSubmitting] = useState(false)

  // Guest promotion (GUEST_UX.md §4.2/§4.4): a session landing here may be
  // carrying a pending guest ranking (fresh confirmation on any device) or a
  // local guest list that must be merged before navigation continues.
  const [hold, setHold] = useState<'materializing' | 'merging' | null>(null)
  const [mergePrompt, setMergePrompt] = useState<MergePrompt | null>(null)
  const [promoError, setPromoError] = useState<string | null>(null)
  // Serialize the async session-effect: auth events (USER_UPDATED after the
  // metadata wipe) re-enter the flow, and the effect must never run twice
  // concurrently.
  const busyRef = useRef(false)

  const emailNotConfirmed = error !== null && /not confirmed/i.test(error)

  // Where to send the user after login. `next` survives the confirmation-email
  // round-trip (signup encodes the original deep link into the redirect URL);
  // `state.from` covers the plain RequireAuth → login → … path. Freshly
  // confirmed users land on the first-run welcome nudge on /me.
  const confirmed = searchParams.get('confirmed') === '1'
  const invited = searchParams.get('invited') === '1'
  const nextParam = searchParams.get('next')
  const stateFrom = (location.state as LocationState | null)?.from
  const dest =
    nextParam && nextParam.startsWith('/')
      ? nextParam
      : (stateFrom ?? (confirmed || invited ? '/me?welcome=1' : '/me'))

  // The confirmation link signs the user in via the PKCE code exchange on
  // this (public) page — no form submit needed. Navigation is GATED here:
  // a pending guest payload (review round 2, B) must materialize and wipe
  // before /me renders, and a local guest list (review round 2, C) must be
  // triaged — otherwise the redirect wins the race and /me flashes empty.
  // The same gate runs from the password/OTP submit handlers (the useAuth
  // session update races them) — busyRef serializes every entry point.
  const runGate = useCallback(async () => {
    if (busyRef.current) return
    // Cheap sync short-circuit: no pending payload AND no local guest list
    // means plain navigation. (The RPCs are session-gated server-side; this
    // only skips pointless work when the gate runs pre-context-update.)
    const pendingEarly = readPendingGuestPayload(user)
    const guestEarly = readGuestRanking()
    if (!pendingEarly && !guestEarly) {
      exitGuestMarkMode()
      navigate(dest, { replace: true })
      return
    }
    busyRef.current = true

    const finish = () => {
      exitGuestMarkMode()
      navigate(dest, { replace: true })
    }

    try {
      // 1. Pending metadata payload: fresh confirmation on ANY device.
      const pending = readPendingGuestPayload(user)
      if (pending) {
        setHold('materializing')
        try {
          await materializeGuestRides(pending.ids, 'materialize', pending.started_at)
          clearGuestRides()
        } catch (err) {
          if (isGuestStaleError(err)) {
            // §4.2 (E): the account ladder progressed past the stored
            // payload — wipe and continue; nothing is destroyed.
            clearGuestRides()
            await wipePendingGuestPayload().catch(() => {})
          } else {
            // Generic failure: keep the payload for the next login, stay
            // on the form with an explanation.
            Sentry.captureException(err, { extra: { flow: 'guest-materialize' } })
            setPromoError(
              "We couldn't restore your guest ranking. Sign in anyway — we'll try again next time.",
            )
            setHold(null)
            return
          }
        }
        // Wipe even after the stale path (idempotent; one-time marker).
        await wipePendingGuestPayload().catch((err) =>
          Sentry.captureException(err, { extra: { flow: 'guest-wipe' } }),
        )
        await qc.invalidateQueries({ queryKey: ['myRides', user?.id] })
        finish()
        return
      }

      // 2. Local guest list on login (§4.4): silent no-op, seed mode, or
      // the merge modal (navigation holds until a choice is made).
      const guest = readGuestRanking()
      if (guest && guest.orderedIds.length > 0) {
        setHold('merging')
        const remoteIds = await fetchMyRankedRideIds()
        const verdict = triageGuestState(remoteIds)
        if (verdict.action === 'silent_clear') {
          clearGuestRides()
          setHold(null)
          finish()
          return
        }
        if (verdict.action === 'materialize') {
          setHold('materializing')
          await materializeGuestRides(
            guest.orderedIds,
            'materialize',
            new Date(guest.createdAt).toISOString(),
          )
          clearGuestRides()
          await qc.invalidateQueries({ queryKey: ['myRides', user?.id] })
          setHold(null)
          finish()
          return
        }
        if (verdict.action === 'conflict') {
          setHold(null)
          setMergePrompt({
            guestCount: guest.orderedIds.length,
            remoteCount: remoteIds.length,
            remoteIds,
            guestOnlyIds: verdict.guestOnlyIds,
            startedAtIso: new Date(guest.createdAt).toISOString(),
          })
          return
        }
      }

      finish()
    } finally {
      busyRef.current = false
    }
  }, [user, dest, navigate, qc])

  useEffect(() => {
    if (isLoading || !session) return
    void runGate()
  }, [isLoading, session, runGate])

  async function handleAppend() {
    if (!mergePrompt) return
    setHold('materializing')
    try {
      // §4.4 Rule 3: the COMPLETE merged ladder — existing ids (order
      // unchanged) with the guest-only ids appended at the bottom.
      await materializeGuestRides(
        [...mergePrompt.remoteIds, ...mergePrompt.guestOnlyIds],
        'merge_append',
        mergePrompt.startedAtIso,
      )
      clearGuestRides()
      setMergePrompt(null)
      setHold(null)
      await qc.invalidateQueries({ queryKey: ['myRides', user?.id] })
      navigate(dest, { replace: true })
    } catch (err) {
      Sentry.captureException(err, { extra: { flow: 'guest-merge-append' } })
      setPromoError("Couldn't save your guest coasters. Try again, or discard to continue.")
      setHold(null)
    }
  }

  async function handleDiscard() {
    if (!mergePrompt) return
    // Telemetry-only failure is non-blocking.
    await logGuestMergeDecision().catch(() => {})
    clearGuestRides()
    setMergePrompt(null)
    navigate(dest, { replace: true })
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setResent(false)
    setSubmitting(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setSubmitting(false)
    if (error) {
      // Friendlier copy for the common wrong-credentials case; everything
      // else (e.g. "Email not confirmed") passes through so the resend
      // affordance keeps working (issue #91).
      setError(
        /invalid login credentials/i.test(error.message)
          ? 'Incorrect email or password.'
          : error.message,
      )
      return
    }
    // Navigation is owned by the guest-promotion gate (runGate), which the
    // session update and this call both feed — busyRef serializes them.
    void runGate()
  }

  async function resendConfirmation() {
    setResending(true)
    setResendError(null)
    // The original signup encodes the deep link into emailRedirectTo; the
    // resend must do the same, or GoTrue falls back to the Site URL and the
    // fresh link drops the user on the site root (the pre-#142 behavior).
    const deepLink = nextParam && nextParam.startsWith('/') ? nextParam : stateFrom
    const nextQuery =
      deepLink && deepLink.startsWith('/') ? `&next=${encodeURIComponent(deepLink)}` : ''
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: `${window.location.origin}/login?confirmed=1${nextQuery}` },
    })
    setResending(false)
    if (error) {
      // A 429 right after signup is normal (short per-address resend cooldown):
      // say so instead of failing silently.
      setResendError("Couldn't resend — try again in a minute.")
      return
    }
    setResent(true)
  }

  async function requestMagicLink() {
    setMagicError(null)
    if (!email.trim()) {
      setMagicError('Enter your email above first, then tap for a sign-in link.')
      return
    }
    setMagicSubmitting(true)
    // If the address isn't confirmed yet, Supabase sends its confirmation
    // email instead of a sign-in link — the panel copy below covers both.
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/login?magic=1` },
    })
    setMagicSubmitting(false)
    if (error) {
      setMagicError(error.message)
      return
    }
    setMagicSent(true)
  }

  async function verifyCode(e: FormEvent) {
    e.preventDefault()
    setMagicError(null)
    setMagicSubmitting(true)
    const { error } = await supabase.auth.verifyOtp({ email, token: code.trim(), type: 'email' })
    setMagicSubmitting(false)
    if (error) {
      setMagicError(
        /expired/i.test(error.message)
          ? 'That code has expired — request a new one.'
          : error.message,
      )
      return
    }
    // Navigation is owned by the guest-promotion gate (runGate), which the
    // session update and this call both feed — busyRef serializes them.
    void runGate()
  }

  // GUEST_UX.md §4.2 (B): hold navigation while the guest ranking
  // materializes — /me must never flash an empty state before the rows land.
  if (hold) {
    return (
      <div className="mx-auto max-w-md" role="status" aria-live="polite">
        <Panel className="p-8 text-center">
          <p className="display-heading text-2xl text-ink">Preparing your rankings…</p>
          <p className="mt-2 text-sm text-muted">
            Restoring the coasters you marked as a guest into your account.
          </p>
        </Panel>
      </div>
    )
  }

  if (magicSent) {
    return (
      <Panel className="mx-auto max-w-md p-6 text-center">
        <h1 className="display-heading text-3xl text-ink">Check your email</h1>
        <p className="mt-2 text-sm text-muted">
          We sent a sign-in link and a code to <strong>{email}</strong>. Click the link — or type
          the code below. Both expire in an hour. (If your email still needs confirming, this email
          does that instead.)
        </p>
        <form onSubmit={verifyCode} className="mt-5 space-y-4">
          <input
            id="otp"
            aria-label="Sign-in code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={8}
            required
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            className={`${fieldClassName} mx-auto block max-w-48 text-center text-lg tracking-[0.4em]`}
          />
          {magicError && <p className="text-sm text-danger">{magicError}</p>}
          <Button type="submit" disabled={magicSubmitting} className="w-full">
            {magicSubmitting ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
        <button
          type="button"
          onClick={() => {
            setMagicSent(false)
            setCode('')
            setMagicError(null)
          }}
          className="mt-4 text-sm text-muted underline underline-offset-4 hover:text-ink"
        >
          Wrong address? Go back
        </button>
      </Panel>
    )
  }

  return (
    <div className="mx-auto max-w-sm">
      <h1 className="display-heading text-4xl text-ink">Log in</h1>
      {confirmed && (
        <p className="mt-4 rounded-xl border border-success/25 bg-success/10 px-4 py-3 text-sm text-ink">
          Email confirmed — welcome! Log in to start ranking.
        </p>
      )}
      {invited && (
        <p className="mt-4 rounded-xl border border-success/25 bg-success/10 px-4 py-3 text-sm text-ink">
          Invite accepted — welcome aboard!
        </p>
      )}
      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-ink-soft">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={`mt-1 ${fieldClassName}`}
          />
        </div>
        <div>
          <label htmlFor="password" className="block text-sm font-medium text-ink-soft">
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={`mt-1 ${fieldClassName}`}
          />
        </div>
        {error && (
          <div className="text-sm text-danger">
            <p>{error}</p>
            {emailNotConfirmed && !resent && (
              <button
                type="button"
                onClick={resendConfirmation}
                disabled={resending}
                className="mt-1 underline underline-offset-4 hover:text-danger-text disabled:opacity-50"
              >
                {resending ? 'Resending…' : 'Resend confirmation email'}
              </button>
            )}
            {resent && <p className="mt-1 text-muted">Confirmation email sent.</p>}
            {resendError && <p className="mt-1">{resendError}</p>}
          </div>
        )}
        {promoError && (
          <p role="alert" className="text-sm text-danger">
            {promoError}
          </p>
        )}
        <Button type="submit" disabled={submitting} className="w-full">
          {submitting ? 'Logging in…' : 'Log in'}
        </Button>
      </form>
      <div className="mt-5 flex items-center gap-3 text-xs text-muted" aria-hidden="true">
        <span className="h-px flex-1 bg-line" />
        or
        <span className="h-px flex-1 bg-line" />
      </div>
      <Button
        type="button"
        variant="outline"
        className="mt-4 w-full"
        onClick={requestMagicLink}
        disabled={magicSubmitting}
      >
        {magicSubmitting ? 'Sending…' : 'Email me a sign-in link'}
      </Button>
      {magicError && <p className="mt-2 text-sm text-danger">{magicError}</p>}
      <p className="mt-4 text-center text-sm">
        <Link
          to="/forgot-password"
          state={stateFrom || nextParam ? { from: stateFrom ?? nextParam } : undefined}
          className="text-muted underline underline-offset-4 hover:text-ink"
        >
          Forgot password?
        </Link>
      </p>
      <p className="mt-4 text-sm text-muted">
        No account?{' '}
        <Link
          to="/signup"
          state={stateFrom || nextParam ? { from: stateFrom ?? nextParam } : undefined}
          className="font-medium text-ink underline underline-offset-4"
        >
          Sign up
        </Link>
      </p>
      {mergePrompt && (
        <ExistingAccountMergeModal
          guestCount={mergePrompt.guestCount}
          remoteCount={mergePrompt.remoteCount}
          onAppend={() => void handleAppend()}
          onDiscard={() => void handleDiscard()}
        />
      )}
    </div>
  )
}
