import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Camera, Trash2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth-context'
import { riderShareUrl } from '../lib/rider'
import { fetchProfile, claimErrorMessage, type Profile } from '../lib/profile'
import { supabase } from '../lib/supabase'
import { useAvatarUpload } from '../lib/use-avatar-upload'
import { isReservedUsername, USERNAME_RE, USERNAME_RULES } from '../lib/validation'
import { Badge, Button, fieldClassName, MessageState, Panel } from '../components/ui'
import { CopyLinkButton } from '../components/CopyLinkButton'
import Avatar from '../components/ui/Avatar'
export type { Profile }

export default function ProfilePage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  // Set/change password — invited accounts start without one (they accept the
  // invite via an emailed link), so this doubles as their "set password" step.
  const [newPassword, setNewPassword] = useState('')
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [passwordSaved, setPasswordSaved] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { upload, remove, isUploading, error: uploadError } = useAvatarUpload(user!.id)

  const {
    data: profile,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['profile', user?.id],
    enabled: Boolean(user),
    queryFn: () => fetchProfile(user!.id),
  })

  // Sharing is live — the checkbox writes straight to `profiles.public_list`
  // so a copied URL is never a pre-Save 404 that unfurlers cache. The
  // display name stays on the explicit Save path; the share state lives
  // outside the form draft. Usernames are claim-once: editable only until
  // first set (the public /riders/<username> URL derives from the handle,
  // so renames would break shared links).
  const persistedUsername = profile?.username ?? ''
  const isClaimed = persistedUsername !== ''
  const persistedShareActive =
    Boolean(profile?.public_list) &&
    Boolean(persistedUsername) &&
    USERNAME_RE.test(persistedUsername)
  const persistedShareUrl = persistedShareActive ? riderShareUrl(persistedUsername) : null
  const canShare = Boolean(persistedUsername && USERNAME_RE.test(persistedUsername))
  useEffect(() => {
    if (profile) {
      setUsername(profile.username ?? '')
      setDisplayName(profile.display_name ?? '')
    }
  }, [profile])

  const togglePublic = useMutation({
    mutationFn: async (next: boolean) => {
      const { error } = await supabase
        .from('profiles')
        .update({ public_list: next })
        .eq('id', user!.id)
      if (error) throw error
      return next
    },
    onMutate: async (next: boolean) => {
      await queryClient.cancelQueries({ queryKey: ['profile', user?.id] })
      const previous = queryClient.getQueryData<Profile>(['profile', user?.id])
      if (previous) {
        queryClient.setQueryData<Profile>(['profile', user?.id], {
          ...previous,
          public_list: next,
        })
      }
      return { previous }
    },
    onError: (error, _next, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(['profile', user?.id], ctx.previous)
      setFormError(claimErrorMessage(error))
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['profile', user?.id] })
    },
  })

  const save = useMutation({
    mutationFn: async () => {
      // Claimed usernames are immutable (DB trigger is the backstop) — never
      // send username once set, so a stale draft can't clobber the handle.
      const payload = isClaimed
        ? { display_name: displayName || null }
        : { username: username || null, display_name: displayName || null }
      const { error } = await supabase.from('profiles').update(payload).eq('id', user!.id)
      if (error) throw error
    },
    onSuccess: () => {
      setSaved(true)
      queryClient.invalidateQueries({ queryKey: ['profile', user?.id] })
    },
    onError: (error) => {
      setFormError(claimErrorMessage(error))
    },
  })

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    setSaved(false)
    // Claimed usernames are locked; only the first claim is validated here.
    // (Direct-API renames hit the profiles_username_immutable trigger and map
    // to a friendly message via claimErrorMessage.)
    if (!isClaimed) {
      if (username && !USERNAME_RE.test(username)) {
        setFormError(`Username must be ${USERNAME_RULES}`)
        return
      }
      if (isReservedUsername(username)) {
        setFormError('That username is reserved.')
        return
      }
    }
    save.mutate()
  }

  async function handlePasswordSubmit(e: FormEvent) {
    e.preventDefault()
    setPasswordError(null)
    setPasswordSaved(false)
    if (newPassword.length < 6) {
      setPasswordError('At least 6 characters.')
      return
    }
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (error) {
      setPasswordError(error.message)
      return
    }
    setNewPassword('')
    setPasswordSaved(true)
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      await upload(file)
    } catch {
      // Error is captured in the hook's error state
    }
    // Reset the input so the same file can be selected again
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function handleRemove() {
    try {
      await remove()
    } catch {
      // Error is captured in the hook's error state
    }
  }

  if (isLoading) {
    return <MessageState>Loading…</MessageState>
  }

  if (isError) {
    return <MessageState tone="danger">Couldn&apos;t load your profile.</MessageState>
  }

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="display-heading text-4xl text-ink">Profile</h1>
      <p className="mt-1 text-sm text-muted">
        {user?.email}
        {profile?.is_admin && (
          <Badge tone="coral" className="ml-2">
            admin
          </Badge>
        )}
      </p>
      <Panel className="mt-6 p-5 sm:p-6">
        <div className="grid gap-6 sm:grid-cols-4">
          <div className="flex items-start justify-center sm:justify-start">
            <div className="relative">
              <Avatar
                src={profile?.avatar_url ?? null}
                userId={user!.id}
                size={96}
                className={isUploading ? 'opacity-50' : ''}
              />
              {isUploading && (
                <div className="absolute inset-0 flex items-center justify-center rounded-full bg-surface/80">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                </div>
              )}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                ref={fileInputRef}
                onChange={handleFileChange}
                disabled={isUploading}
              />
              <button
                type="button"
                title="Change photo"
                aria-label="Change profile photo"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                className="absolute -right-1 -bottom-1 flex h-7 w-7 items-center justify-center rounded-full bg-ink text-canvas ring-2 ring-surface-bright transition-colors hover:bg-ink-soft disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Camera size={14} />
              </button>
              {profile?.avatar_url && (
                <button
                  type="button"
                  title="Remove photo"
                  aria-label="Remove profile photo"
                  onClick={handleRemove}
                  disabled={isUploading}
                  className="absolute -top-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full bg-danger-text text-white ring-2 ring-surface-bright transition-colors hover:bg-danger-text/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          </div>

          <form onSubmit={onSubmit} className="space-y-5 sm:col-span-3">
            <div>
              <label htmlFor="username" className="block text-sm font-medium text-ink-soft">
                Username
              </label>
              {isClaimed ? (
                <>
                  <input
                    id="username"
                    type="text"
                    value={persistedUsername}
                    disabled
                    readOnly
                    aria-readonly="true"
                    className={`mt-1 ${fieldClassName} cursor-not-allowed opacity-70`}
                  />
                  <p className="mt-1 text-xs text-muted">
                    Usernames can&apos;t be changed once claimed — they&apos;re part of your public
                    page URL. Username typo? Email{' '}
                    <a
                      href="mailto:admin@coasterrank.app"
                      className="font-medium text-ink underline underline-offset-4"
                    >
                      admin@coasterrank.app
                    </a>{' '}
                    and we&apos;ll fix it.
                  </p>
                </>
              ) : (
                <>
                  <input
                    id="username"
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className={`mt-1 ${fieldClassName}`}
                  />
                  <p className="mt-1 text-xs text-muted">
                    {USERNAME_RULES} Once claimed, it can&apos;t be changed.
                  </p>
                </>
              )}
            </div>
            <div className="flex items-start gap-3 rounded-lg border border-line bg-surface px-3 py-3">
              <input
                id="publicList"
                type="checkbox"
                checked={profile?.public_list ?? false}
                disabled={!canShare || togglePublic.isPending}
                onChange={(e) => {
                  if (!canShare) return
                  setFormError(null)
                  togglePublic.mutate(e.target.checked)
                }}
                className="mt-0.5 h-4 w-4 shrink-0 accent-coral disabled:cursor-not-allowed disabled:opacity-50"
              />
              <label htmlFor="publicList" className="block text-sm">
                <span className="font-medium text-ink">Share my ranking</span>
                <span className="mt-0.5 block text-xs text-muted">
                  {!canShare ? (
                    <>
                      Claim a valid username first — then your ranked list will live at{' '}
                      <code className="font-mono">/@{username || '…'}</code>. Your email and any
                      unranked coasters stay private.
                    </>
                  ) : (
                    <>
                      Puts your ranked list at{' '}
                      <code className="font-mono">/@{persistedUsername}</code>. Your email and any
                      unranked coasters stay private.
                    </>
                  )}
                </span>
                {togglePublic.isPending && (
                  <span className="mt-1 block text-xs font-medium text-muted">Saving…</span>
                )}
              </label>
            </div>
            {persistedShareUrl && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-2">
                  <code className="min-w-0 flex-1 truncate font-mono text-xs text-ink-soft">
                    {persistedShareUrl}
                  </code>
                  <CopyLinkButton url={persistedShareUrl} label="Copy" />
                </div>
              </div>
            )}
            <div>
              <label htmlFor="displayName" className="block text-sm font-medium text-ink-soft">
                Display name
              </label>
              <input
                id="displayName"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className={`mt-1 ${fieldClassName}`}
              />
            </div>
            {formError && <p className="text-sm text-danger">{formError}</p>}
            {saved && (
              <p className="text-sm text-success-text">
                Saved.
                {persistedShareActive && (
                  <>
                    {' '}
                    <Link
                      to={`/riders/${persistedUsername}`}
                      className="font-medium text-ink underline underline-offset-4"
                    >
                      View your public page →
                    </Link>
                  </>
                )}
              </p>
            )}
            <Button type="submit" disabled={save.isPending} className="w-full">
              {save.isPending ? 'Saving…' : 'Save'}
            </Button>
          </form>
        </div>
        {uploadError && <p className="mt-3 text-sm text-danger">{uploadError}</p>}
      </Panel>

      <Panel className="mt-6 p-5 sm:p-6">
        <h2 className="text-lg font-semibold text-ink">Password</h2>
        <p className="mt-1 text-sm text-muted">
          Used for email + password logins. Invited accounts start without one — you can also log in
          with an emailed sign-in link anytime.
        </p>
        <form onSubmit={handlePasswordSubmit} className="mt-4 max-w-sm space-y-3">
          <div>
            <label htmlFor="newPassword" className="block text-sm font-medium text-ink-soft">
              New password
            </label>
            <input
              id="newPassword"
              type="password"
              required
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className={`mt-1 ${fieldClassName}`}
            />
            <p className="mt-1 text-xs text-muted">At least 6 characters.</p>
          </div>
          {passwordError && <p className="text-sm text-danger">{passwordError}</p>}
          {passwordSaved && <p className="text-sm text-success-text">Password updated.</p>}
          <Button type="submit" variant="outline">
            Update password
          </Button>
        </form>
      </Panel>
    </div>
  )
}
