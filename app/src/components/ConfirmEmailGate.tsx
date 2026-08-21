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
    const { error } = await supabase.auth.resend({ type: 'signup', email })
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
