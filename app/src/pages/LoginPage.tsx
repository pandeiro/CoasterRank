import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

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
      <h1 className="text-2xl font-semibold text-slate-900">Log in</h1>
      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-slate-700">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
          />
        </div>
        <div>
          <label htmlFor="password" className="block text-sm font-medium text-slate-700">
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
          />
        </div>
        {error && (
          <div className="text-sm text-red-600">
            <p>{error}</p>
            {emailNotConfirmed && !resent && (
              <button
                type="button"
                onClick={resendConfirmation}
                className="mt-1 underline hover:text-red-800"
              >
                Resend confirmation email
              </button>
            )}
            {resent && <p className="mt-1 text-slate-600">Confirmation email sent.</p>}
          </div>
        )}
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded bg-slate-900 px-4 py-2 text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {submitting ? 'Logging in…' : 'Log in'}
        </button>
      </form>
      <p className="mt-4 text-sm text-slate-600">
        No account?{' '}
        <Link to="/signup" className="text-slate-900 underline">
          Sign up
        </Link>
      </p>
    </div>
  )
}
