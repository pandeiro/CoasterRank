import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { USERNAME_RE, USERNAME_RULES } from '../lib/validation'
import { Button, fieldClassName, Panel } from '../components/ui'

type LocationState = { from?: string }

export default function SignupPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false)

  // Preserve a deep link (RequireAuth stashes it as `from`) through the
  // email round-trip: the confirmation link lands on /login, which forwards
  // `next` on to the final destination after the code exchange signs the
  // user in.
  const from = (location.state as LocationState | null)?.from
  const nextQuery = from && from.startsWith('/') ? `&next=${encodeURIComponent(from)}` : ''

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!USERNAME_RE.test(username)) {
      setError(`Username must be ${USERNAME_RULES}`)
      return
    }
    setSubmitting(true)
    // username/display_name go through raw_user_meta_data into the
    // handle_new_user() trigger, which creates the profiles row.
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { username, display_name: username },
        // The confirmation link lands on /login (public, so the PKCE code
        // exchange can't race a RequireAuth bounce) and forwards on to
        // /me?welcome=1 for the first-run nudge.
        emailRedirectTo: `${window.location.origin}/login?confirmed=1${nextQuery}`,
      },
    })
    setSubmitting(false)
    if (error) {
      setError(error.message)
      return
    }
    if (data.session) {
      // Confirmation off (dev/test): a session is returned immediately.
      navigate(from ?? '/me?welcome=1', { replace: true })
    } else {
      setAwaitingConfirmation(true)
    }
  }

  if (awaitingConfirmation) {
    return (
      <Panel className="mx-auto max-w-md p-6 text-center">
        <h1 className="display-heading text-3xl text-ink">Check your email</h1>
        <p className="mt-2 text-sm text-muted">
          We sent a confirmation link to <strong>{email}</strong>. Confirm your address, then log in
          to start ranking — the link brings you right back here.
        </p>
        <Link
          to="/login"
          state={from ? { from } : undefined}
          className="mt-4 inline-block text-sm font-medium text-ink underline underline-offset-4"
        >
          Go to login
        </Link>
      </Panel>
    )
  }

  return (
    <div className="mx-auto max-w-sm">
      <h1 className="display-heading text-4xl text-ink">Sign up</h1>
      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        <div>
          <label htmlFor="username" className="block text-sm font-medium text-ink-soft">
            Username
          </label>
          <input
            id="username"
            type="text"
            required
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className={`mt-1 ${fieldClassName}`}
          />
          <p className="mt-1 text-xs text-muted">{USERNAME_RULES}</p>
        </div>
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
            minLength={6}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={`mt-1 ${fieldClassName}`}
          />
          <p className="mt-1 text-xs text-muted">At least 6 characters.</p>
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
        <Button type="submit" disabled={submitting} className="w-full">
          {submitting ? 'Creating account…' : 'Create account'}
        </Button>
        <p className="text-center text-xs text-muted">
          Free · Your ranking stays private by default
        </p>
      </form>
      <p className="mt-4 text-sm text-muted">
        Already have an account?{' '}
        <Link
          to="/login"
          state={from ? { from } : undefined}
          className="font-medium text-ink underline underline-offset-4"
        >
          Log in
        </Link>
      </p>
    </div>
  )
}
