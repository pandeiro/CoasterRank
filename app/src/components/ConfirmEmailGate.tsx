import { useState } from 'react'
import { supabase } from '../lib/supabase'

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
    <div className="mx-auto max-w-md rounded-lg border border-amber-200 bg-amber-50 p-6 text-center">
      <h2 className="text-lg font-semibold text-amber-900">Confirm your email</h2>
      <p className="mt-2 text-sm text-amber-800">
        You&apos;ll be able to rank coasters once your email is confirmed.
        {email && (
          <>
            {' '}
            We sent a confirmation link to <strong>{email}</strong>.
          </>
        )}
      </p>
      {email && (
        <button
          type="button"
          onClick={resend}
          disabled={status === 'sending' || status === 'sent'}
          className="mt-4 rounded bg-amber-900 px-4 py-2 text-sm text-white hover:bg-amber-800 disabled:opacity-50"
        >
          {status === 'sent'
            ? 'Confirmation email sent'
            : status === 'sending'
              ? 'Sending…'
              : 'Resend confirmation email'}
        </button>
      )}
      {status === 'error' && (
        <p className="mt-2 text-sm text-red-600">Couldn&apos;t resend — try again later.</p>
      )}
    </div>
  )
}
