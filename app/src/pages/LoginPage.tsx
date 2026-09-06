import { useEffect, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth-context'
import { Button, fieldClassName } from '../components/ui'

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

  const emailNotConfirmed = error !== null && /not confirmed/i.test(error)

  // Where to send the user after login. `next` survives the confirmation-email
  // round-trip (signup encodes the original deep link into the redirect URL);
  // `state.from` covers the plain RequireAuth → login → … path. Freshly
  // confirmed users land on the first-run welcome nudge on /me.
  const confirmed = searchParams.get('confirmed') === '1'
  const nextParam = searchParams.get('next')
  const stateFrom = (location.state as LocationState | null)?.from
  const dest =
    nextParam && nextParam.startsWith('/')
      ? nextParam
      : (stateFrom ?? (confirmed ? '/me?welcome=1' : '/me'))

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
    const { error } = await supabase.auth.resend({ type: 'signup', email })
    if (!error) setResent(true)
  }

  return (
    <div className="mx-auto max-w-sm">
      <h1 className="display-heading text-4xl text-ink">Log in</h1>
      {confirmed && (
        <p className="mt-4 rounded-xl border border-success/25 bg-success/10 px-4 py-3 text-sm text-ink">
          Email confirmed — welcome! Log in to start ranking.
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
                className="mt-1 underline underline-offset-4 hover:text-danger-text"
              >
                Resend confirmation email
              </button>
            )}
            {resent && <p className="mt-1 text-muted">Confirmation email sent.</p>}
          </div>
        )}
        <Button type="submit" disabled={submitting} className="w-full">
          {submitting ? 'Logging in…' : 'Log in'}
        </Button>
      </form>
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
