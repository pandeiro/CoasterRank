import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Camera, Trash2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth-context'
import { riderPageUrl } from '../lib/rider'
import { fetchProfile, type Profile } from '../lib/profile'
import { supabase } from '../lib/supabase'
import { useAvatarUpload } from '../lib/use-avatar-upload'
import { USERNAME_RE, USERNAME_RULES } from '../lib/validation'
import { Badge, Button, fieldClassName, MessageState, Panel } from '../components/ui'
import { CopyLinkButton } from '../components/ShareListCard'
import Avatar from '../components/ui/Avatar'

export type { Profile }

export default function ProfilePage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [publicList, setPublicList] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
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

  useEffect(() => {
    if (profile) {
      setUsername(profile.username ?? '')
      setDisplayName(profile.display_name ?? '')
      setPublicList(profile.public_list)
    }
  }, [profile])

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('profiles')
        .update({
          username: username || null,
          display_name: displayName || null,
          public_list: publicList,
        })
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
    <div className="mx-auto max-w-lg">
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
        {/* Avatar section */}
        <div className="flex items-center gap-4 pb-5 border-b border-line">
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
          </div>
          <div className="flex flex-col gap-2">
            <label className="block">
              <span className="sr-only">Change profile photo</span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                ref={fileInputRef}
                onChange={handleFileChange}
                disabled={isUploading}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
              >
                <Camera size={14} />
                Change photo
              </Button>
            </label>
            {profile?.avatar_url && (
              <Button variant="ghost" size="sm" onClick={handleRemove} disabled={isUploading}>
                <Trash2 size={14} />
                Remove photo
              </Button>
            )}
          </div>
        </div>
        {uploadError && <p className="mt-3 text-sm text-danger">{uploadError}</p>}

        <form onSubmit={onSubmit} className="space-y-5">
          <div>
            <label htmlFor="username" className="block text-sm font-medium text-ink-soft">
              Username
            </label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className={`mt-1 ${fieldClassName}`}
            />
            <p className="mt-1 text-xs text-muted">{USERNAME_RULES}</p>
            {username && USERNAME_RE.test(username) && (
              <div className="mt-2 flex items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-2">
                <code className="min-w-0 flex-1 truncate font-mono text-xs text-ink-soft">
                  {riderPageUrl(username)}
                </code>
                <CopyLinkButton url={riderPageUrl(username)} label="Copy" />
              </div>
            )}
          </div>
          <div className="flex items-start gap-3 rounded-lg border border-line bg-surface px-3 py-3">
            <input
              id="publicList"
              type="checkbox"
              checked={publicList}
              onChange={(e) => setPublicList(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-coral"
            />
            <label htmlFor="publicList" className="block text-sm">
              <span className="font-medium text-ink">Share my ranking publicly</span>
              <span className="mt-0.5 block text-xs text-muted">
                Puts your ranked list at{' '}
                <code className="font-mono">/riders/{username || '…'}</code>
                {username ? '' : ' (once you claim a username)'}. Your email and any unranked
                coasters stay private.
              </span>
            </label>
          </div>
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
            <p className="text-sm text-success">
              Saved.
              {publicList && username && (
                <>
                  {' '}
                  <Link
                    to={`/riders/${username}`}
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
      </Panel>
    </div>
  )
}
