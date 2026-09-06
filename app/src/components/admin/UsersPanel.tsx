// Admin "Users" tab: baseline stats over all users + a filterable list with
// ops (impersonate synthetic users, confirm email, delete) and a detail view.
// Data comes from the admin-users Edge Function via lib/adminUsers; the
// impersonation flow itself lives in lib/impersonation.
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronLeft, ChevronRight, Copy, Eye, LogIn, Search, Trash2 } from 'lucide-react'
import Avatar from '../ui/Avatar'
import StatBlock from '../StatBlock'
import { Badge, Button, ConfirmDialog, MessageState, Modal, Panel, fieldClassName } from '../ui'
import {
  confirmUser,
  deleteUser,
  filterUsers,
  listAllUsers,
  pageCount,
  pageSlice,
  type AdminUserRow,
  type UserFilter,
} from '../../lib/adminUsers'
import { assumeIdentity } from '../../lib/impersonation'

const USERS_PAGE_SIZE = 50

type Notify = (message: string, tone?: 'info' | 'error') => void

const FILTERS: Array<{ value: UserFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'real', label: 'Real' },
  { value: 'test', label: 'Test' },
]

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString()
}

function userLabel(u: AdminUserRow): string {
  return u.displayName || (u.username ? `@${u.username}` : u.email || u.id)
}

export default function UsersPanel({ notify }: { notify: Notify }) {
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState<UserFilter>('all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [detail, setDetail] = useState<AdminUserRow | null>(null)
  const [toDelete, setToDelete] = useState<AdminUserRow | null>(null)

  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin-users'],
    queryFn: listAllUsers,
  })

  const filtered = useMemo(
    () => filterUsers(data?.users ?? [], filter, search),
    [data?.users, filter, search],
  )
  const pages = pageCount(filtered.length, USERS_PAGE_SIZE)
  const visible = useMemo(() => pageSlice(filtered, page, USERS_PAGE_SIZE), [filtered, page])

  // Clamp when a filter/search change shrinks the list.
  useEffect(() => {
    if (page > pages) setPage(pages)
  }, [page, pages])

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin-users'] })

  const assume = useMutation({
    mutationFn: assumeIdentity,
    onError: (err: Error) => notify(err.message, 'error'),
  })

  const confirmEmail = useMutation({
    mutationFn: confirmUser,
    onSuccess: () => {
      invalidate()
      notify('Email confirmed.')
    },
    onError: (err: Error) => notify(err.message, 'error'),
  })

  const removeUser = useMutation({
    mutationFn: deleteUser,
    onSuccess: () => {
      invalidate()
      setToDelete(null)
      setDetail(null)
      notify('User deleted.')
    },
    onError: (err: Error) => notify(err.message, 'error'),
  })

  const copyId = async (id: string) => {
    await navigator.clipboard.writeText(id)
    notify('User ID copied.')
  }

  const stats = data?.stats
  const actionsFor = (u: AdminUserRow) => (
    <>
      {u.synthetic && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => assume.mutate(u.id)}
          disabled={assume.isPending}
        >
          <LogIn size={14} />
          Assume
        </Button>
      )}
      {!u.confirmed && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => confirmEmail.mutate(u.id)}
          disabled={confirmEmail.isPending}
        >
          <Check size={14} />
          Confirm
        </Button>
      )}
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="px-2"
        aria-label={`Details for ${userLabel(u)}`}
        onClick={() => setDetail(u)}
      >
        <Eye size={14} />
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="px-2"
        aria-label={`Delete ${userLabel(u)}`}
        disabled={u.isAdmin}
        title={u.isAdmin ? 'Admins are removed via the SQL bootstrap runbook, not here' : undefined}
        onClick={() => setToDelete(u)}
      >
        <Trash2 size={14} className={u.isAdmin ? 'text-muted' : 'text-danger-text'} />
      </Button>
    </>
  )

  return (
    <>
      {stats && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatBlock label="Users" value={stats.totalUsers} />
          <StatBlock label="Confirmed" value={stats.confirmedUsers} />
          <StatBlock label="Ranked" value={stats.rankedUsers} />
          <StatBlock label="Test" value={stats.testUsers} />
          <StatBlock label="Signups 7d" value={stats.signups7d} />
          <StatBlock label="Signups 30d" value={stats.signups30d} />
        </div>
      )}

      <Panel className="p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex shrink-0 self-start rounded-full bg-surface p-1">
            {FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => {
                  setFilter(f.value)
                  setPage(1)
                }}
                className={`rounded-full px-3 py-1.5 text-sm transition-colors ${
                  filter === f.value
                    ? 'bg-surface-bright font-medium text-ink shadow-sm'
                    : 'text-muted hover:text-ink'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPage(1)
              }}
              placeholder="Search email, @username, name…"
              className={`${fieldClassName} pl-9`}
            />
          </div>
        </div>
        <p className="mt-3 text-xs text-muted">
          {filtered.length} user{filtered.length === 1 ? '' : 's'}
          {data?.truncated ? ' · list truncated at the GoTrue page cap' : ''}
        </p>
      </Panel>

      <Panel className="p-6">
        <h2 className="mb-1 text-lg font-semibold text-ink">Users</h2>
        <p className="mb-4 text-sm text-muted">
          Synthetic test users (
          <code className="rounded bg-surface px-1 text-xs">testride:seed</code> or the{' '}
          <code className="rounded bg-surface px-1 text-xs">@test.coasterrank.dev</code> domain) can
          be impersonated; your admin session is preserved via the banner below. Real users can
          never be impersonated.
        </p>
        {isLoading ? (
          <MessageState>Loading users…</MessageState>
        ) : isError ? (
          <MessageState tone="danger">
            Couldn&apos;t load users — is the admin-users Edge Function deployed?
          </MessageState>
        ) : visible.length === 0 ? (
          <MessageState>
            No users match. Create test users with{' '}
            <code className="rounded bg-surface px-1 text-xs">
              npm run testride:seed -- --users 5 --rides 10-20 --apply
            </code>
            .
          </MessageState>
        ) : (
          <>
            <div className="space-y-2">
              {visible.map((u) => (
                <div key={u.id} className="flex items-center gap-3 rounded-lg bg-surface p-3">
                  <Avatar src={u.avatarUrl} userId={u.id} size={36} className="shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium text-ink">{userLabel(u)}</span>
                      {u.synthetic && <Badge tone="coral">Test</Badge>}
                      {u.isAdmin && <Badge tone="accent">Admin</Badge>}
                      {!u.confirmed && <Badge tone="warning">Unconfirmed</Badge>}
                    </div>
                    <div className="truncate text-xs text-muted">
                      {u.email || 'no email'} · joined {formatDate(u.createdAt)} · {u.ridesRanked}/
                      {u.ridesTotal} ranked
                      {u.submissionsMade > 0 ? ` · ${u.submissionsMade} submission(s)` : ''}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">{actionsFor(u)}</div>
                </div>
              ))}
            </div>
            {pages > 1 && (
              <div className="mt-4 flex items-center justify-between gap-3 text-sm text-muted">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft size={14} />
                  Prev
                </Button>
                <span>
                  Page {page} of {pages}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={page >= pages}
                  onClick={() => setPage((p) => Math.min(pages, p + 1))}
                >
                  Next
                  <ChevronRight size={14} />
                </Button>
              </div>
            )}
          </>
        )}
      </Panel>

      <Modal
        isOpen={!!detail}
        onClose={() => setDetail(null)}
        title="User details"
        panelClassName="max-w-xl"
      >
        {detail && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Avatar src={detail.avatarUrl} userId={detail.id} size={48} />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-semibold text-ink">{userLabel(detail)}</span>
                  {detail.synthetic && <Badge tone="coral">Test</Badge>}
                  {detail.isAdmin && <Badge tone="accent">Admin</Badge>}
                  {!detail.confirmed && <Badge tone="warning">Unconfirmed</Badge>}
                </div>
                <div className="truncate text-sm text-muted">{detail.email || 'no email'}</div>
              </div>
            </div>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg bg-surface p-4 text-sm">
              <dt className="text-muted">Joined</dt>
              <dd className="text-ink">{formatDate(detail.createdAt)}</dd>
              <dt className="text-muted">Email status</dt>
              <dd className="text-ink">{detail.confirmed ? 'Confirmed' : 'Unconfirmed'}</dd>
              <dt className="text-muted">Rides</dt>
              <dd className="text-ink">
                {detail.ridesRanked} ranked / {detail.ridesTotal} total
              </dd>
              <dt className="text-muted">Submissions</dt>
              <dd className="text-ink">
                {detail.submissionsMade} made · {detail.submissionsReviewed} reviewed
              </dd>
              <dt className="text-muted">Public page</dt>
              <dd className="text-ink">
                {detail.username && detail.publicList ? (
                  <a
                    href={`/riders/${detail.username}`}
                    className="text-accent-text hover:underline"
                  >
                    /riders/{detail.username}
                  </a>
                ) : detail.username ? (
                  'Off'
                ) : (
                  '—'
                )}
              </dd>
              <dt className="text-muted">User ID</dt>
              <dd className="flex items-center gap-1.5">
                <span className="truncate font-mono text-xs text-ink">{detail.id}</span>
                <button
                  type="button"
                  onClick={() => void copyId(detail.id)}
                  className="shrink-0 rounded-full p-1 text-muted transition-colors hover:bg-surface-bright hover:text-ink"
                  aria-label="Copy user ID"
                >
                  <Copy size={14} />
                </button>
              </dd>
            </dl>

            <div className="flex flex-wrap items-center gap-2">{actionsFor(detail)}</div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        isOpen={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={() => toDelete && removeUser.mutate(toDelete.id)}
        title="Delete user"
        message={`Permanently delete ${toDelete?.email || toDelete?.id} and everything they own (profile, rides, submissions)? This cannot be undone.`}
        confirmLabel="Delete user"
      />
    </>
  )
}
