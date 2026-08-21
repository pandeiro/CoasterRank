import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Button, fieldClassName } from '../components/ui'

type LocationState = { from?: string }

export default function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [resent, setResent] = useState(false)

  const emailNotConfirmed = error !== null && /not confirmed/i.test(error)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setResent(false)
    setSubmitting(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setSubmitting(false)
    if (error) {
      setError(error.message)
      return
    }
    const from = (location.state as LocationState | null)?.from ?? '/me'
    navigate(from, { replace: true })
  }

  async function resendConfirmation() {
    const { error } = await supabase.auth.resend({ type: 'signup', email })
    if (!error) setResent(true)
  }

  return (
    <div className="mx-auto max-w-sm">
      <h1 className="display-heading text-4xl text-ink">Log in</h1>
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
                className="mt-1 underline underline-offset-4 hover:text-danger/80"
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
        <Link to="/signup" className="font-medium text-ink underline underline-offset-4">
          Sign up
        </Link>
      </p>
    </div>
  )
}
