import { useState, type FormEvent } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Button, fieldClassName, Panel } from '../components/ui'

type LocationState = { from?: string }

export default function ForgotPasswordPage() {
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [sent, setSent] = useState(false)

  // Preserve a deep link (RequireAuth stashes it as `from`) through the
  // reset-email round-trip: it rides along as ?next on the recovery redirect,
  // and ResetPasswordPage forwards to it once the new password is saved.
  const from = (location.state as LocationState | null)?.from
  const nextQuery = from && from.startsWith('/') ? `?next=${encodeURIComponent(from)}` : ''

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      // The recovery link lands on the public /reset-password page — same
      // reasoning as the confirmation flow: the PKCE code exchange must not
      // race the RequireAuth gate.
      redirectTo: `${window.location.origin}/reset-password${nextQuery}`,
    })
    setSubmitting(false)
    if (error) {
      setError(error.message)
      return
    }
    setSent(true)
  }

  if (sent) {
    return (
      <Panel className="mx-auto max-w-md p-6 text-center">
        <h1 className="display-heading text-3xl text-ink">Check your email</h1>
        <p className="mt-2 text-sm text-muted">
          If <strong>{email}</strong> has a CoasterRank account, a link to choose a new password is
          on its way. It expires in an hour.
        </p>
        <Link
          to="/login"
          state={from ? { from } : undefined}
          className="mt-4 inline-block text-sm font-medium text-ink underline underline-offset-4"
        >
          Back to login
        </Link>
      </Panel>
    )
  }

  return (
    <div className="mx-auto max-w-sm">
      <h1 className="display-heading text-4xl text-ink">Reset password</h1>
      <p className="mt-2 text-sm text-muted">
        Enter the email on your account and we'll send a link to choose a new password.
      </p>
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
        {error && <p className="text-sm text-danger">{error}</p>}
        <Button type="submit" disabled={submitting} className="w-full">
          {submitting ? 'Sending…' : 'Send reset link'}
        </Button>
      </form>
      <p className="mt-4 text-sm text-muted">
        Remembered it?{' '}
        <Link
          to="/login"
          state={from ? { from } : undefined}
          className="font-medium text-ink underline underline-offset-4"
        >
          Back to login
        </Link>
      </p>
    </div>
  )
}
