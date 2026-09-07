import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../lib/auth-context'
import { supabase } from '../lib/supabase'
import { Button, fieldClassName, MessageState, Panel } from '../components/ui'

// Landing page for the password-recovery email link. The link carries a PKCE
// code that supabase-js exchanges during client init — the session showing up
// here IS the recovery confirmation (supabase-js also fires PASSWORD_RECOVERY
// for listeners; the session check is what we actually gate on).
export default function ResetPasswordPage() {
  const { session, isLoading } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Deep link preserved from ForgotPasswordPage (originally stashed by
  // RequireAuth before the login → forgot-password hop).
  const nextParam = searchParams.get('next')
  const dest = nextParam && nextParam.startsWith('/') ? nextParam : '/me'

  if (isLoading) {
    return <MessageState>Checking your reset link…</MessageState>
  }
  // No session = the link was already used, expired (1 hour), or is missing —
  // send them back for a fresh one rather than showing a form that can't save.
  if (!session) {
    return <Navigate to="/forgot-password" replace />
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < 6) {
      setError('Passwords must be at least 6 characters.')
      return
    }
    if (password !== confirm) {
      setError("Passwords don't match.")
      return
    }
    setSubmitting(true)
    const { error } = await supabase.auth.updateUser({ password })
    setSubmitting(false)
    if (error) {
      setError(error.message)
      return
    }
    navigate(dest, { replace: true })
  }

  return (
    <Panel className="mx-auto max-w-sm p-6">
      <h1 className="display-heading text-3xl text-ink">Choose a new password</h1>
      <form onSubmit={onSubmit} className="mt-5 space-y-4">
        <div>
          <label htmlFor="password" className="block text-sm font-medium text-ink-soft">
            New password
          </label>
          <input
            id="password"
            type="password"
            required
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={`mt-1 ${fieldClassName}`}
          />
        </div>
        <div>
          <label htmlFor="confirm" className="block text-sm font-medium text-ink-soft">
            Confirm new password
          </label>
          <input
            id="confirm"
            type="password"
            required
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className={`mt-1 ${fieldClassName}`}
          />
          <p className="mt-1 text-xs text-muted">At least 6 characters.</p>
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
        <Button type="submit" disabled={submitting} className="w-full">
          {submitting ? 'Saving…' : 'Save password'}
        </Button>
      </form>
    </Panel>
  )
}
