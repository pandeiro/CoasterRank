import { useEffect, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth-context'
import { Button, fieldClassName, Panel } from '../components/ui'

type LocationState = { from?: string }

export default function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const { session, isLoading } = useAuth()
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
  // this (public) page — no form submit needed. Forward them on.
  useEffect(() => {
    if (!isLoading && session) {
      navigate(dest, { replace: true })
    }
  }, [isLoading, session, dest, navigate])

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
    navigate(dest, { replace: true })
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
    navigate(dest, { replace: true })
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
    </div>
  )
}
