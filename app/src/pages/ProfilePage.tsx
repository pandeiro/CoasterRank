import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../lib/auth-context'
import { supabase } from '../lib/supabase'
import { USERNAME_RE, USERNAME_RULES } from '../lib/validation'

type Profile = {
  id: string
  username: string | null
  display_name: string | null
  avatar_url: string | null
  is_admin: boolean
}

export default function ProfilePage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const {
    data: profile,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['profile', user?.id],
    enabled: Boolean(user),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, username, display_name, avatar_url, is_admin')
        .eq('id', user!.id)
        .single()
      if (error) throw error
      return data as Profile
    },
  })

  useEffect(() => {
    if (profile) {
      setUsername(profile.username ?? '')
      setDisplayName(profile.display_name ?? '')
    }
  }, [profile])

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('profiles')
        .update({ username: username || null, display_name: displayName || null })
        .eq('id', user!.id)
      if (error) throw error
    },
    onSuccess: () => {
      setSaved(true)
      queryClient.invalidateQueries({ queryKey: ['profile', user?.id] })
    },
    onError: (error) => {
      // Postgres unique_violation => profiles.username is taken.
      setFormError(
        'code' in error && error.code === '23505' ? 'That username is taken.' : error.message,
      )
    },
  })

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    setSaved(false)
    if (username && !USERNAME_RE.test(username)) {
      setFormError(`Username must be ${USERNAME_RULES}`)
      return
    }
    save.mutate()
  }

  if (isLoading) {
    return <p className="py-16 text-center text-slate-500">Loading…</p>
  }

  if (isError) {
    return <p className="py-16 text-center text-red-600">Couldn&apos;t load your profile.</p>
  }

  return (
    <div className="mx-auto max-w-sm">
      <h1 className="text-2xl font-semibold text-slate-900">Profile</h1>
      <p className="mt-1 text-sm text-slate-600">
        {user?.email}
        {profile?.is_admin && (
          <span className="ml-2 rounded bg-slate-900 px-2 py-0.5 text-xs text-white">admin</span>
        )}
      </p>
      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        <div>
          <label htmlFor="username" className="block text-sm font-medium text-slate-700">
            Username
          </label>
          <input
            id="username"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
          />
          <p className="mt-1 text-xs text-slate-500">{USERNAME_RULES}</p>
        </div>
        <div>
          <label htmlFor="displayName" className="block text-sm font-medium text-slate-700">
            Display name
          </label>
          <input
            id="displayName"
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
          />
        </div>
        {formError && <p className="text-sm text-red-600">{formError}</p>}
        {saved && <p className="text-sm text-green-700">Saved.</p>}
        <button
          type="submit"
          disabled={save.isPending}
          className="w-full rounded bg-slate-900 px-4 py-2 text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
      </form>
    </div>
  )
}
