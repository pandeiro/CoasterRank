import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { Button, Panel } from './ui'

/**
 * Client-side email-confirmation gate (PLAN §4.6): shown in place of ranking
 * UI until the user confirms their email. RLS independently denies the writes.
 */
export default function ConfirmEmailGate({ email }: { email?: string }) {
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')

  async function resend() {
    if (!email) return
    setStatus('sending')
    // Same rule as the original signup (and the login-page resend): without
    // emailRedirectTo the fresh link lands on the site root, not
    // /login?confirmed=1.
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: `${window.location.origin}/login?confirmed=1` },
    })
    setStatus(error ? 'error' : 'sent')
  }

  return (
    <Panel className="mx-auto max-w-md border-warning/25 bg-warning/5 p-6 text-center">
      <h2 className="display-heading text-2xl text-ink">Confirm your email</h2>
      <p className="mt-2 text-sm text-muted">
        You&apos;ll be able to rank coasters once your email is confirmed.
        {email && (
          <>
            {' '}
            We sent a confirmation link to <strong>{email}</strong>.
          </>
        )}
      </p>
      {email && (
        <Button
          type="button"
          onClick={resend}
          disabled={status === 'sending' || status === 'sent'}
          className="mt-4"
        >
          {status === 'sent'
            ? 'Confirmation email sent'
            : status === 'sending'
              ? 'Sending…'
              : 'Resend confirmation email'}
        </Button>
      )}
      {status === 'error' && (
        <p className="mt-2 text-sm text-danger">Couldn&apos;t resend — try again later.</p>
      )}
    </Panel>
  )
}
