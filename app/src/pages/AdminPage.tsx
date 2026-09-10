import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, Check, X, Edit, Plus, Home, Search, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import Toast from '../components/Toast'
import UsersPanel from '../components/admin/UsersPanel'
import SharingPanel from '../components/admin/SharingPanel'
import CoasterEditModal from '../components/admin/CoasterEditModal'
import ParkEditModal from '../components/admin/ParkEditModal'
import WeightingComparePanel from '../components/admin/WeightingComparePanel'
import { Badge, Button, ConfirmDialog, fieldClassName, MessageState, Panel } from '../components/ui'
import Avatar from '../components/ui/Avatar'
import {
  approveEditSubmission,
  getPendingSubmissions,
  rejectSubmission,
  approveSubmission,
  getCoastersByIds,
  getSubmitterTrust,
  capitalize,
  type CoasterSubmission,
  type SubmitterTrust,
  getAllCoastersAdmin,
  deleteCoaster,
  getAllParksAdmin,
  deletePark,
  getOtherParkId,
  getCoastersInPark,
  moveCoasterToPark,
  type Coaster,
  type AdminCoaster,
  type AdminPark,
  useParks,
  useManufacturers,
  refreshBoardData,
  type Park,
} from '../lib/coasters'

type RecomputeResponse = {
  updated: number
  durationMs: number
  iterations: number
  converged: boolean
}

type ToastState = { id: number; message: string; tone: 'info' | 'error' }

const COASTER_PAGE_SIZE = 50

const ADMIN_TABS = [
  'coasters',
  'parks',
  'rehome',
  'submissions',
  'users',
  'sharing',
  'control-panel',
] as const
type AdminTab = (typeof ADMIN_TABS)[number]

// Old deep links keep working: the Impersonate tab became the Users tab.
const LEGACY_TAB_REDIRECT: Partial<Record<string, AdminTab>> = { impersonate: 'users' }

type AppSetting = { key: string; enabled: boolean; label?: string | null; updated_at: string }

type SubmissionKindFilter = 'all' | 'new' | 'edit'

const SUBMISSION_FIELD_LABELS: Record<string, string> = {
  height_m: 'Height (m)',
  speed_kmh: 'Speed (km/h)',
  length_m: 'Length (m)',
  inversions: 'Inversions',
  material: 'Material',
  manufacturer_id: 'Manufacturer',
  status: 'Status',
  model: 'Model',
  type: 'Type',
  opening_date: 'Opening date',
  name: 'Name',
}

function formatSubmissionValue(
  key: string,
  value: number | string | null | undefined,
  manufacturerNameById?: Map<string, string>,
): string {
  if (value === null || value === undefined) return '—'
  if (key === 'manufacturer_id' && typeof value === 'string') {
    return manufacturerNameById?.get(value) ?? value
  }
  if (key === 'material' || key === 'status') return capitalize(String(value))
  return String(value)
}

// Submitter history chip: approved/rejected tallies so a reviewer can weigh
// the current suggestion against the track record at a glance.
function TrustChip({ trust }: { trust: SubmitterTrust | undefined }) {
  if (!trust) return null
  const decided = trust.approved + trust.rejected
  const rate = decided === 0 ? null : Math.round((trust.approved / decided) * 100)
  return (
    <span className="text-xs text-muted">
      {decided === 0 ? (
        'First-time submitter'
      ) : (
        <>
          {trust.approved} approved · {trust.rejected} rejected
          {rate !== null ? ` (${rate}%)` : ''}
        </>
      )}
      {trust.pending > 1 ? ` · ${trust.pending} pending` : ''}
    </span>
  )
}

// Typed stat list for new-coaster submissions (replaces the raw JSON dump —
// reviewers approve named fields, not a blob). The five stat keys always
// render; descriptive extras render only when suggested.
function NewSubmissionStats({
  submission,
  manufacturerNameById,
}: {
  submission: CoasterSubmission
  manufacturerNameById: Map<string, string>
}) {
  const fields = submission.suggested_fields as unknown as Record<string, number | string | null>
  const extraKeys = ['manufacturer_id', 'status', 'model', 'type', 'opening_date'].filter(
    (key) => fields[key] !== null && fields[key] !== undefined,
  )
  return (
    <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg border border-line bg-surface-bright p-2 text-xs sm:grid-cols-3">
      {[...['height_m', 'speed_kmh', 'length_m', 'inversions', 'material'], ...extraKeys].map(
        (key) => (
          <div key={key} className="flex justify-between gap-2">
            <dt className="text-muted">{SUBMISSION_FIELD_LABELS[key]}</dt>
            <dd className="font-medium text-ink">
              {formatSubmissionValue(key, fields[key], manufacturerNameById)}
            </dd>
          </div>
        ),
      )}
    </dl>
  )
}

// Before → after diff for edit suggestions. A park move is the highest
// blast-radius change, so it gets the warning treatment when it differs.
function EditSubmissionDiff({
  submission,
  target,
  parkNameById,
  manufacturerNameById,
}: {
  submission: CoasterSubmission
  target: Coaster | undefined
  parkNameById: Map<string, string>
  manufacturerNameById: Map<string, string>
}) {
  const fields = submission.suggested_fields as unknown as Record<string, number | string | null>
  const changedKeys = Object.keys(fields)
  const parkMoved = target && submission.park_id !== target.park_id
  return (
    <div className="mt-2 space-y-1 rounded-lg border border-line bg-surface-bright p-2 text-xs">
      {changedKeys.length === 0 && !parkMoved && (
        <p className="text-muted">Park move only (no scalar changes).</p>
      )}
      {changedKeys.map((key) => (
        <div key={key} className="flex items-baseline justify-between gap-2">
          <span className="shrink-0 text-muted">{SUBMISSION_FIELD_LABELS[key] ?? key}</span>
          <span className="truncate text-right">
            <span className="text-muted line-through">
              {formatSubmissionValue(
                key,
                target?.[key as keyof Coaster] as never,
                manufacturerNameById,
              )}
            </span>{' '}
            <span className="font-medium text-ink">
              → {formatSubmissionValue(key, fields[key], manufacturerNameById)}
            </span>
          </span>
        </div>
      ))}
      {target && (
        <div
          className={`flex items-baseline justify-between gap-2 rounded px-1 py-0.5 ${
            parkMoved ? 'bg-warning/10 font-medium text-warning' : ''
          }`}
        >
          <span className="shrink-0 text-muted">Park</span>
          <span className="truncate text-right">
            {parkMoved ? (
              <>
                {parkNameById.get(target.park_id) ?? target.park_id} → {submission.park_name} ⚠
              </>
            ) : (
              (parkNameById.get(target.park_id) ?? target.park_id)
            )}
          </span>
        </div>
      )}
      {!target && (
        <p className="text-danger">
          The target coaster no longer exists — approving will fail; reject this suggestion.
        </p>
      )}
    </div>
  )
}

function formatTimeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export default function AdminPage() {
  const queryClient = useQueryClient()
  const { tab } = useParams()
  const isValidTab = ADMIN_TABS.includes(tab as AdminTab)
  const activeTab: AdminTab = isValidTab ? (tab as AdminTab) : 'coasters'
  const [toast, setToast] = useState<ToastState | null>(null)
  const toastSeq = useRef(0)
  const notify = (message: string, tone: ToastState['tone'] = 'info') => {
    toastSeq.current += 1
    setToast({ id: toastSeq.current, message, tone })
  }

  // Submissions state
  const [rejectNote, setRejectNote] = useState('')
  const [activeRejectId, setActiveRejectId] = useState<string | null>(null)
  const [kindFilter, setKindFilter] = useState<SubmissionKindFilter>('all')

  // Coaster Management state
  const [searchQuery, setSearchQuery] = useState('')
  const [editingCoaster, setEditingCoaster] = useState<Partial<Coaster> | null>(null)
  const [isAddingCoaster, setIsAddingCoaster] = useState(false)
  const [coasterLimit, setCoasterLimit] = useState(COASTER_PAGE_SIZE)
  const [coasterToDelete, setCoasterToDelete] = useState<AdminCoaster | null>(null)

  // Re-home state
  const [rehomeSearchPark, setRehomeSearchPark] = useState('')
  const [selectedRehomePark, setSelectedRehomePark] = useState<Park | null>(null)
  const [rehomeSearchName, setRehomeSearchName] = useState('')

  // Park Management state
  const [parkSearchQuery, setParkSearchQuery] = useState('')
  const [editingPark, setEditingPark] = useState<Partial<AdminPark> | null>(null)
  const [isAddingPark, setIsAddingPark] = useState(false)
  const [parkLimit, setParkLimit] = useState(COASTER_PAGE_SIZE)
  const [parkToDelete, setParkToDelete] = useState<AdminPark | null>(null)

  const { data: allParks = [] } = useParks()
  const { data: allManufacturers = [] } = useManufacturers()

  const {
    data: submissions = [],
    isLoading: submissionsLoading,
    isError: submissionsError,
  } = useQuery({
    queryKey: ['submissions'],
    queryFn: getPendingSubmissions,
    enabled: activeTab === 'submissions',
  })

  const visibleSubmissions = useMemo(
    () => (kindFilter === 'all' ? submissions : submissions.filter((s) => s.kind === kindFilter)),
    [submissions, kindFilter],
  )

  // Current rows for edit targets (public read) — the "before" side of diffs.
  const editTargetIds = useMemo(
    () => [
      ...new Set(
        submissions
          .filter((s) => s.kind === 'edit' && s.coaster_id)
          .map((s) => s.coaster_id as string),
      ),
    ],
    [submissions],
  )
  const { data: editTargets = [] } = useQuery({
    queryKey: ['submission-edit-targets', editTargetIds],
    queryFn: () => getCoastersByIds(editTargetIds),
    enabled: activeTab === 'submissions' && editTargetIds.length > 0,
  })
  const editTargetMap = useMemo(() => new Map(editTargets.map((c) => [c.id, c])), [editTargets])

  // Submitter track records for the trust chips (one query for the queue).
  const submitterIds = useMemo(
    () => [...new Set(submissions.map((s) => s.submitted_by))],
    [submissions],
  )
  const { data: trustMap } = useQuery({
    queryKey: ['submitter-trust', submitterIds],
    queryFn: () => getSubmitterTrust(submitterIds),
    enabled: activeTab === 'submissions' && submitterIds.length > 0,
  })

  const parkNameById = useMemo(() => new Map(allParks.map((p) => [p.id, p.name])), [allParks])
  const manufacturerNameById = useMemo(
    () => new Map(allManufacturers.map((m) => [m.id, m.name])),
    [allManufacturers],
  )

  const {
    data: allCoasters = [],
    isLoading: coastersLoading,
    isError: coastersError,
  } = useQuery({
    queryKey: ['coasters-admin'],
    queryFn: getAllCoastersAdmin,
    enabled: activeTab === 'coasters',
  })

  const {
    data: allParksAdmin = [],
    isLoading: parksLoading,
    isError: parksError,
  } = useQuery({
    queryKey: ['parks-admin'],
    queryFn: getAllParksAdmin,
    enabled: activeTab === 'parks',
  })

  const { data: otherParkId, isError: otherParkError } = useQuery({
    queryKey: ['other-park-id'],
    queryFn: getOtherParkId,
    enabled: activeTab === 'rehome',
  })

  const appSettings = useQuery({
    queryKey: ['app-settings'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('app_settings')
        .select('key, enabled, label, updated_at')
        .order('key')
      if (error) throw error
      return data as AppSetting[]
    },
    enabled: activeTab === 'control-panel',
  })

  const toggleSetting = useMutation({
    mutationFn: async ({ key, enabled }: { key: string; enabled: boolean }) => {
      const { error } = await supabase.from('app_settings').update({ enabled }).eq('key', key)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['app-settings'] })
      notify('Setting updated.')
    },
    onError: (e: Error) => notify(e.message, 'error'),
  })

  const {
    data: otherCoasters = [],
    isLoading: otherCoastersLoading,
    isError: otherCoastersError,
  } = useQuery({
    queryKey: ['other-coasters', otherParkId],
    queryFn: () => (otherParkId ? getCoastersInPark(otherParkId) : Promise.resolve([])),
    enabled: activeTab === 'rehome' && !!otherParkId,
  })

  const filteredOtherCoasters = useMemo(() => {
    if (!rehomeSearchName) return otherCoasters
    try {
      const re = new RegExp(rehomeSearchName, 'i')
      return otherCoasters.filter((c) => re.test(c.name))
    } catch {
      return []
    }
  }, [otherCoasters, rehomeSearchName])

  const lastRun = useQuery({
    queryKey: ['cron-execution-logs', 'last-success'],
    queryFn: async () => {
      // maybeSingle: zero runs (fresh install) is expected, not an error.
      const { data, error } = await supabase
        .from('cron_execution_logs')
        .select('created_at, duration_ms, iterations, pairs, updated, converged')
        .eq('status', 'success')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw error
      return data as {
        created_at: string
        duration_ms: number
        iterations: number
        pairs: number
        updated: number
        converged: boolean
      } | null
    },
  })

  const lastError = useQuery({
    queryKey: ['cron-execution-logs', 'last-error'],
    queryFn: async () => {
      // maybeSingle: zero past errors is the happy path, not an error.
      const { data, error } = await supabase
        .from('cron_execution_logs')
        .select('created_at, error_message, duration_ms, trigger_source')
        .eq('status', 'error')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw error
      return data as {
        created_at: string
        error_message: string
        duration_ms: number
        trigger_source: string
      } | null
    },
  })

  const recompute = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke<RecomputeResponse>(
        'recompute-rankings',
        { method: 'POST' },
      )
      if (error) throw error
      return data!
    },
    onSuccess: () => {
      // Bypass the /api/ranking edge cache — the whole point of this button
      // is to see fresh scores immediately.
      void refreshBoardData(queryClient).catch(() => {})
      queryClient.invalidateQueries({ queryKey: ['cron-execution-logs'] })
    },
  })

  const approve = useMutation({
    mutationFn: async ({ id, submission }: { id: string; submission: CoasterSubmission }) => {
      if (submission.kind === 'edit') {
        await approveEditSubmission(id, submission)
      } else {
        await approveSubmission(id, submission)
      }
    },
    onSuccess: (_, { submission }) => {
      queryClient.invalidateQueries({ queryKey: ['submissions'] })
      queryClient.invalidateQueries({ queryKey: ['submitter-trust'] })
      queryClient.invalidateQueries({ queryKey: ['submission-edit-targets'] })
      // New coaster must show up on the board immediately, edge cache aside.
      void refreshBoardData(queryClient).catch(() => {})
      queryClient.invalidateQueries({ queryKey: ['coasters-admin'] })
      queryClient.invalidateQueries({ queryKey: ['parks-admin'] })
      notify(
        submission.kind === 'edit'
          ? 'Edit approved and coaster updated.'
          : 'Submission approved and coaster created.',
      )
    },
    onError: (error) => {
      notify(`Couldn't approve submission: ${error.message}`, 'error')
    },
  })

  const reject = useMutation({
    mutationFn: async ({ id, note }: { id: string; note: string }) => {
      await rejectSubmission(id, note)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['submissions'] })
      queryClient.invalidateQueries({ queryKey: ['submitter-trust'] })
      setActiveRejectId(null)
      setRejectNote('')
      notify('Submission rejected.')
    },
    onError: (error) => {
      notify(`Couldn't reject submission: ${error.message}`, 'error')
    },
  })

  const removeCoaster = useMutation({
    mutationFn: async (id: string) => {
      await deleteCoaster(id)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['coasters-admin'] })
      setEditingCoaster(null)
      setIsAddingCoaster(false)
      setCoasterToDelete(null)
      notify('Coaster deleted.')
    },
    onError: (error) => {
      notify(`Couldn't delete coaster: ${error.message}`, 'error')
    },
  })

  const rehome = useMutation({
    mutationFn: async ({ coasterId, parkId }: { coasterId: string; parkId: string }) => {
      await moveCoasterToPark(coasterId, parkId)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['other-coasters'] })
      queryClient.invalidateQueries({ queryKey: ['coasters-admin'] })
      notify('Coaster re-homed.')
    },
    onError: (error) => {
      notify(`Couldn't re-home coaster: ${error.message}`, 'error')
    },
  })

  const removePark = useMutation({
    mutationFn: async (id: string) => {
      await deletePark(id)
    },
    onSuccess: () => {
      // A park delete cascades to its coasters (and their rides/ratings), so
      // both admin lists and the board need refreshing.
      queryClient.invalidateQueries({ queryKey: ['parks-admin'] })
      queryClient.invalidateQueries({ queryKey: ['coasters-admin'] })
      void refreshBoardData(queryClient).catch(() => {})
      setEditingPark(null)
      setIsAddingPark(false)
      setParkToDelete(null)
      notify('Park deleted.')
    },
    onError: (error) => {
      notify(`Couldn't delete park: ${error.message}`, 'error')
    },
  })

  const filteredCoasters = useMemo(
    () =>
      allCoasters.filter(
        (c) =>
          c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          c.parks?.name.toLowerCase().includes(searchQuery.toLowerCase()),
      ),
    [allCoasters, searchQuery],
  )

  // A new search restarts the incremental window.
  useEffect(() => {
    setCoasterLimit(COASTER_PAGE_SIZE)
  }, [searchQuery])

  const visibleCoasters = filteredCoasters.slice(0, coasterLimit)
  const hasMoreCoasters = coasterLimit < filteredCoasters.length

  const filteredRehomeParks = allParks
    .filter((p) => p.name.toLowerCase().includes(rehomeSearchPark.toLowerCase()))
    .slice(0, 5)

  // Park management filtering & pagination
  const filteredParksAdmin = useMemo(
    () =>
      allParksAdmin.filter(
        (p) =>
          p.name.toLowerCase().includes(parkSearchQuery.toLowerCase()) ||
          (p.country && p.country.toLowerCase().includes(parkSearchQuery.toLowerCase())) ||
          (p.city && p.city.toLowerCase().includes(parkSearchQuery.toLowerCase())),
      ),
    [allParksAdmin, parkSearchQuery],
  )

  useEffect(() => {
    setParkLimit(COASTER_PAGE_SIZE)
  }, [parkSearchQuery])

  const visibleParks = filteredParksAdmin.slice(0, parkLimit)
  const hasMoreParks = parkLimit < filteredParksAdmin.length

  function openAddForm() {
    setEditingCoaster(null)
    setIsAddingCoaster(true)
  }

  function openEditForm(coaster: Partial<Coaster>) {
    setEditingCoaster(coaster)
    setIsAddingCoaster(false)
  }

  function closeForm() {
    setEditingCoaster(null)
    setIsAddingCoaster(false)
  }

  function openAddParkForm() {
    setEditingPark(null)
    setIsAddingPark(true)
  }

  function openEditParkForm(park: AdminPark) {
    setEditingPark(park)
    setIsAddingPark(false)
  }

  function closeParkForm() {
    setEditingPark(null)
    setIsAddingPark(false)
  }

  if (!isValidTab) {
    const legacy = tab ? LEGACY_TAB_REDIRECT[tab] : undefined
    return <Navigate to={`/admin/${legacy ?? 'coasters'}`} replace />
  }

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-accent-text">
            Track operations
          </p>
          <h1 className="display-heading text-4xl text-ink">Admin</h1>
        </div>
        <div className="flex rounded-full bg-surface p-1">
          {ADMIN_TABS.map((tab) => (
            <Link
              key={tab}
              to={`/admin/${tab}`}
              className={`rounded-full px-3 py-1.5 text-sm transition-colors ${
                activeTab === tab
                  ? 'bg-surface-bright font-medium text-ink shadow-sm'
                  : 'text-muted hover:text-ink'
              }`}
            >
              {tab === 'control-panel'
                ? 'Control Panel'
                : tab.charAt(0).toUpperCase() + tab.slice(1)}
            </Link>
          ))}
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-4">
        <div className="md:col-span-3 space-y-6">
          {activeTab === 'submissions' && (
            <Panel className="p-6">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-semibold text-ink">Submission Queue</h2>
                <div className="flex gap-1 rounded-full bg-surface p-1 text-xs">
                  {(
                    [
                      ['all', `All (${submissions.length})`],
                      ['new', `New (${submissions.filter((s) => s.kind === 'new').length})`],
                      ['edit', `Edits (${submissions.filter((s) => s.kind === 'edit').length})`],
                    ] as Array<[SubmissionKindFilter, string]>
                  ).map(([kind, label]) => (
                    <button
                      key={kind}
                      onClick={() => setKindFilter(kind)}
                      className={`rounded-full px-2.5 py-1 transition-colors ${
                        kindFilter === kind
                          ? 'bg-surface-bright font-medium text-ink shadow-sm'
                          : 'text-muted hover:text-ink'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {submissionsLoading ? (
                <MessageState>Loading submissions...</MessageState>
              ) : submissionsError ? (
                <MessageState tone="danger">Couldn&apos;t load submissions.</MessageState>
              ) : submissions.length === 0 ? (
                <MessageState>No pending submissions.</MessageState>
              ) : visibleSubmissions.length === 0 ? (
                <MessageState>
                  No pending {kindFilter === 'new' ? 'new-coaster submissions' : 'edit suggestions'}
                  .
                </MessageState>
              ) : (
                <div className="space-y-4">
                  {visibleSubmissions.map((s) => (
                    <div key={s.id} className="rounded-xl border border-line bg-surface p-4">
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <h3 className="font-semibold">
                            {s.coaster_name}{' '}
                            <span
                              className={`ml-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                                s.kind === 'edit'
                                  ? 'bg-accent/15 text-accent-strong'
                                  : 'bg-success/15 text-success'
                              }`}
                            >
                              {s.kind === 'edit' ? 'Edit' : 'New'}
                            </span>
                          </h3>
                          <p className="text-sm text-muted">{s.park_name}</p>
                          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                            <Avatar
                              src={s.profiles?.avatar_url ?? null}
                              userId={s.submitted_by}
                              size={20}
                            />
                            <span className="text-xs text-muted">
                              {s.profiles?.username ?? 'Unknown user'}
                            </span>
                            <TrustChip trust={trustMap?.get(s.submitted_by)} />
                          </div>
                          {s.kind === 'edit' ? (
                            <EditSubmissionDiff
                              submission={s}
                              target={s.coaster_id ? editTargetMap.get(s.coaster_id) : undefined}
                              parkNameById={parkNameById}
                              manufacturerNameById={manufacturerNameById}
                            />
                          ) : (
                            <NewSubmissionStats
                              submission={s}
                              manufacturerNameById={manufacturerNameById}
                            />
                          )}
                          {s.note && (
                            <p className="mt-2 rounded-lg border border-line bg-surface-bright p-2 text-xs text-muted">
                              <span className="font-medium text-ink-soft">Submitter note:</span>{' '}
                              {s.note}
                            </p>
                          )}
                        </div>
                        <div className="flex gap-2 ml-4">
                          <button
                            onClick={() => approve.mutate({ id: s.id, submission: s })}
                            disabled={approve.isPending}
                            className="rounded-full bg-success-text p-2 text-white hover:bg-success-text/90 disabled:opacity-50"
                            title={s.kind === 'edit' ? 'Approve edit' : 'Approve'}
                          >
                            <Check size={16} />
                          </button>
                          <button
                            onClick={() => setActiveRejectId(s.id)}
                            disabled={reject.isPending}
                            className="rounded-full bg-danger-text p-2 text-white hover:bg-danger-text/90 disabled:opacity-50"
                            title="Reject"
                          >
                            <X size={16} />
                          </button>
                        </div>
                      </div>
                      {activeRejectId === s.id && (
                        <div className="mt-4 flex gap-2">
                          <input
                            className={`flex-1 ${fieldClassName}`}
                            placeholder="Reason for rejection..."
                            value={rejectNote}
                            onChange={(e) => setRejectNote(e.target.value)}
                          />
                          <button
                            onClick={() => reject.mutate({ id: s.id, note: rejectNote })}
                            disabled={!rejectNote}
                            className="rounded-full bg-danger-text px-3 py-1.5 text-xs text-white hover:bg-danger-text/90 disabled:opacity-50"
                          >
                            Confirm Reject
                          </button>
                          <button
                            onClick={() => setActiveRejectId(null)}
                            className="rounded-full bg-surface px-3 py-1.5 text-xs text-muted hover:bg-line"
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          )}

          {activeTab === 'coasters' && (
            <Panel className="p-6">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-ink">Coaster Management</h2>
                <Button variant="coral" size="sm" onClick={openAddForm}>
                  <Plus size={14} /> Add Coaster
                </Button>
              </div>

              <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={16} />
                <input
                  className={`${fieldClassName} pl-10 pr-4`}
                  placeholder="Search coasters or parks..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>

              {coastersLoading ? (
                <MessageState>Loading coasters...</MessageState>
              ) : coastersError ? (
                <MessageState tone="danger">Couldn&apos;t load coasters.</MessageState>
              ) : filteredCoasters.length === 0 ? (
                <MessageState>No coasters match that search.</MessageState>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-line text-muted">
                          <th className="pb-2 font-medium">Name</th>
                          <th className="pb-2 font-medium">Park</th>
                          <th className="pb-2 font-medium">Status</th>
                          <th className="pb-2 text-right font-medium">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line/70">
                        {visibleCoasters.map((c) => (
                          <tr key={c.id} className="transition-colors hover:bg-canvas">
                            <td className="py-2">
                              <Link
                                to={`/coasters/${c.slug}`}
                                className="font-semibold text-ink underline-offset-4 hover:underline"
                              >
                                {c.name}
                              </Link>
                            </td>
                            <td className="py-2 text-muted">
                              {c.parks ? (
                                <Link to={`/parks/${c.parks.slug}`} className="hover:underline">
                                  {c.parks.name}
                                </Link>
                              ) : (
                                'Unknown'
                              )}
                            </td>
                            <td className="py-2">
                              <Badge>{c.status}</Badge>
                            </td>
                            <td className="py-2 text-right">
                              <button
                                onClick={() => openEditForm(c)}
                                className="rounded-full p-2 text-muted hover:bg-surface hover:text-ink"
                              >
                                <Edit size={14} />
                              </button>
                              <button
                                onClick={() => setCoasterToDelete(c)}
                                className="rounded-full p-2 text-muted hover:bg-danger/10 hover:text-danger-text"
                              >
                                <Trash2 size={14} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {hasMoreCoasters && (
                    <button
                      onClick={() => setCoasterLimit((n) => n + COASTER_PAGE_SIZE)}
                      className="mt-4 w-full rounded-full border border-line px-3 py-2 text-xs text-muted hover:bg-surface"
                    >
                      Show more ({filteredCoasters.length - coasterLimit} remaining)
                    </button>
                  )}
                </>
              )}

              {(isAddingCoaster || editingCoaster) && (
                <CoasterEditModal
                  initial={editingCoaster}
                  mode={isAddingCoaster ? 'create' : 'edit'}
                  onClose={closeForm}
                  onSaved={() => {
                    closeForm()
                    notify('Coaster saved.')
                  }}
                  onError={(message) => notify(message, 'error')}
                  onRequestDelete={(coaster) => setCoasterToDelete(coaster as AdminCoaster)}
                />
              )}
            </Panel>
          )}

          {activeTab === 'parks' && (
            <Panel className="p-6">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-ink">Park Management</h2>
                <Button variant="coral" size="sm" onClick={openAddParkForm}>
                  <Plus size={14} /> Add Park
                </Button>
              </div>

              <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={16} />
                <input
                  className={`${fieldClassName} pl-10 pr-4`}
                  placeholder="Search parks by name, country, or city..."
                  value={parkSearchQuery}
                  onChange={(e) => setParkSearchQuery(e.target.value)}
                />
              </div>

              {parksLoading ? (
                <MessageState>Loading parks...</MessageState>
              ) : parksError ? (
                <MessageState tone="danger">Couldn&apos;t load parks.</MessageState>
              ) : filteredParksAdmin.length === 0 ? (
                <MessageState>No parks match that search.</MessageState>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-line text-muted">
                          <th className="pb-2 font-medium">Name</th>
                          <th className="pb-2 font-medium">City</th>
                          <th className="pb-2 font-medium">Country</th>
                          <th className="pb-2 font-medium">Coords</th>
                          <th className="pb-2 font-medium tabular-nums">Coasters</th>
                          <th className="pb-2 text-right font-medium">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line/70">
                        {visibleParks.map((p) => (
                          <tr key={p.id} className="transition-colors hover:bg-canvas">
                            <td className="py-2">
                              <Link
                                to={`/parks/${p.slug}`}
                                className="font-semibold text-ink underline-offset-4 hover:underline"
                              >
                                {p.name}
                              </Link>
                            </td>
                            <td className="py-2 text-muted">{p.city || '—'}</td>
                            <td className="py-2 text-muted">{p.country || '—'}</td>
                            <td className="py-2 text-muted">
                              {p.lat != null && p.lng != null ? (
                                <span title={`${p.lat}, ${p.lng}`}>&#x1F310;</span>
                              ) : (
                                <span className="inline-block h-2.5 w-2.5 rounded-full bg-line" />
                              )}
                            </td>
                            <td className="py-2 tabular-nums font-mono text-sm">
                              {p.coaster_count}
                            </td>
                            <td className="py-2 text-right">
                              <button
                                onClick={() => openEditParkForm(p)}
                                className="rounded-full p-2 text-muted hover:bg-surface hover:text-ink"
                              >
                                <Edit size={14} />
                              </button>
                              <button
                                onClick={() => setParkToDelete(p)}
                                title="Delete park"
                                className="rounded-full p-2 text-muted hover:bg-danger/10 hover:text-danger-text"
                              >
                                <Trash2 size={14} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {hasMoreParks && (
                    <button
                      onClick={() => setParkLimit((n) => n + COASTER_PAGE_SIZE)}
                      className="mt-4 w-full rounded-full border border-line px-3 py-2 text-xs text-muted hover:bg-surface"
                    >
                      Show more ({filteredParksAdmin.length - parkLimit} remaining)
                    </button>
                  )}
                </>
              )}

              {(isAddingPark || editingPark) && (
                <ParkEditModal
                  initial={editingPark}
                  mode={isAddingPark ? 'create' : 'edit'}
                  onClose={closeParkForm}
                  onSaved={() => {
                    closeParkForm()
                    notify('Park saved.')
                  }}
                  onError={(message) => notify(message, 'error')}
                  onRequestDelete={(park) => setParkToDelete(park as AdminPark)}
                />
              )}
            </Panel>
          )}

          {activeTab === 'rehome' && (
            <Panel className="p-6">
              <div className="mb-4 flex items-center gap-2">
                <Home size={20} className="text-ink" />
                <h2 className="text-lg font-semibold text-ink">Re-home Coasters</h2>
              </div>
              <p className="mb-6 text-sm text-muted">
                Move coasters from the{' '}
                <code className="rounded bg-surface px-1">Other (unknown location)</code> park to
                their correct locations.
              </p>

              <div className="mb-6 flex gap-4 rounded-xl border border-line bg-surface p-4">
                <div className="flex-1 relative">
                  <Search
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-muted"
                    size={16}
                  />
                  <input
                    className={`${fieldClassName} pl-10 pr-4`}
                    placeholder="Search for target park..."
                    value={rehomeSearchPark}
                    onChange={(e) => {
                      setRehomeSearchPark(e.target.value)
                      setSelectedRehomePark(null)
                    }}
                  />
                  {rehomeSearchPark && !selectedRehomePark && filteredRehomeParks.length > 0 && (
                    <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-xl border border-line bg-surface-bright shadow-lift">
                      {filteredRehomeParks.map((p) => (
                        <li
                          key={p.id}
                          className="cursor-pointer p-2 text-sm hover:bg-canvas"
                          onClick={() => {
                            setSelectedRehomePark(p)
                            setRehomeSearchPark(p.name)
                          }}
                        >
                          {p.name} <span className="text-xs text-muted">({p.country})</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted">Selected:</span>
                  <span className="text-sm font-medium">
                    {selectedRehomePark ? selectedRehomePark.name : 'None'}
                  </span>
                </div>
              </div>

              <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={16} />
                <input
                  className={`${fieldClassName} pl-10 pr-4`}
                  placeholder="Filter coasters (eg /some-reg(e)x/)"
                  value={rehomeSearchName}
                  onChange={(e) => setRehomeSearchName(e.target.value)}
                />
              </div>

              {otherCoastersLoading ? (
                <MessageState>Loading coasters...</MessageState>
              ) : otherParkError || otherCoastersError ? (
                <MessageState tone="danger">Couldn&apos;t load the re-home list.</MessageState>
              ) : otherCoasters.length === 0 ? (
                <MessageState>No coasters found in the 'Other' park.</MessageState>
              ) : filteredOtherCoasters.length === 0 ? (
                <MessageState>No coasters match that search.</MessageState>
              ) : (
                <div className="space-y-3">
                  {filteredOtherCoasters.map((c) => (
                    <div
                      key={c.id}
                      className="flex items-center justify-between rounded-xl border border-line p-3 transition-colors hover:bg-canvas"
                    >
                      <span className="text-sm font-medium">{c.name}</span>
                      <button
                        onClick={() => {
                          if (!selectedRehomePark) {
                            notify('Select a target park first.', 'error')
                            return
                          }
                          rehome.mutate({ coasterId: c.id, parkId: selectedRehomePark.id })
                        }}
                        disabled={rehome.isPending}
                        className="rounded-full border border-line bg-surface-bright px-2 py-1 text-xs text-muted hover:bg-surface disabled:opacity-50"
                      >
                        Move to {selectedRehomePark?.name || 'Selected Park'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          )}

          {activeTab === 'users' && <UsersPanel notify={notify} />}

          {activeTab === 'sharing' && <SharingPanel />}

          {activeTab === 'control-panel' && (
            <Panel className="p-6">
              <h2 className="text-lg font-semibold text-ink">Control Panel</h2>
              <p className="mt-1 text-sm text-muted">
                Toggle Telegram event notifications on or off in real-time without redeploying code.
              </p>
              {appSettings.isLoading ? (
                <MessageState>Loading settings…</MessageState>
              ) : appSettings.isError ? (
                <MessageState tone="danger">Couldn&apos;t load app settings.</MessageState>
              ) : (
                <div className="mt-6 space-y-3">
                  {(appSettings.data ?? []).map((s) => (
                    <label
                      key={s.key}
                      className="flex items-center justify-between gap-4 rounded-xl border border-line bg-surface p-3"
                    >
                      <span className="text-sm font-medium text-ink">
                        {s.label ??
                          s.key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                      </span>
                      <input
                        type="checkbox"
                        checked={s.enabled}
                        disabled={toggleSetting.isPending}
                        onChange={(e) =>
                          toggleSetting.mutate({ key: s.key, enabled: e.target.checked })
                        }
                        className="h-5 w-5 accent-coral"
                      />
                    </label>
                  ))}
                  <p className="text-xs text-muted">
                    Changes apply immediately to backend triggers (no redeploy).
                  </p>
                </div>
              )}
            </Panel>
          )}
        </div>

        <div className="order-first md:order-last space-y-6">
          <Panel className="p-6">
            <h2 className="text-lg font-semibold text-ink">Rankings</h2>
            <p className="mt-1 text-sm text-muted">
              Refits Bradley-Terry strengths from all ranked lists and upserts{' '}
              <code className="rounded bg-surface px-1 text-xs">coaster_ratings</code>.
            </p>
            <Button
              type="button"
              onClick={() => recompute.mutate()}
              disabled={recompute.isPending}
              className="mt-4"
            >
              <RefreshCw className={recompute.isPending ? 'animate-spin' : ''} size={16} />
              {recompute.isPending ? 'Recomputing…' : 'Recompute now'}
            </Button>

            {/* Last successful run */}
            {lastRun.data && (
              <div className="mt-4 rounded-lg bg-surface p-3 text-sm">
                <div className="flex items-center gap-2 text-muted">
                  <span className="inline-block h-2 w-2 rounded-full bg-success" />
                  Last success: {formatTimeAgo(lastRun.data.created_at)}
                </div>
                <div className="mt-1 text-ink">
                  {`${lastRun.data.iterations + 1} iteration${lastRun.data.iterations + 1 === 1 ? '' : 's'}`}{' '}
                  &middot; {formatDuration(lastRun.data.duration_ms)}
                  {lastRun.data.converged ? '' : ' (hit cap)'}
                </div>
                <div className="text-ink">
                  {lastRun.data.pairs} pairs &rarr; {lastRun.data.updated} coasters
                </div>
              </div>
            )}

            {lastRun.isLoading && (
              <div className="mt-4 text-sm text-muted">Loading run history…</div>
            )}

            {lastRun.isError && (
              <div className="mt-4 text-sm text-danger">Couldn&apos;t load run history.</div>
            )}

            {/* Last error */}
            {lastError.data && (
              <div className="mt-3 rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm">
                <div className="flex items-center gap-2 text-danger">
                  <span className="inline-block h-2 w-2 rounded-full bg-danger" />
                  Last error: {formatTimeAgo(lastError.data.created_at)}
                </div>
                <div className="mt-1 text-ink">{lastError.data.error_message}</div>
                <div className="mt-0.5 text-xs text-muted">
                  Trigger: {lastError.data.trigger_source} &middot; Failed after{' '}
                  {formatDuration(lastError.data.duration_ms)}
                </div>
              </div>
            )}

            {lastError.isError && (
              <div className="mt-3 text-sm text-danger">Couldn&apos;t load error history.</div>
            )}

            {recompute.isError && (
              <p className="mt-3 text-sm text-danger">
                Recompute failed: {recompute.error.message}
              </p>
            )}
          </Panel>

          <WeightingComparePanel />
        </div>
      </div>

      {toast && (
        <Toast
          key={toast.id}
          message={toast.message}
          tone={toast.tone}
          onDismiss={() => setToast(null)}
        />
      )}

      <ConfirmDialog
        isOpen={!!coasterToDelete}
        onClose={() => setCoasterToDelete(null)}
        onConfirm={() => {
          if (coasterToDelete) {
            removeCoaster.mutate(coasterToDelete.id)
          }
        }}
        title="Delete Coaster"
        message={`Are you sure you want to delete "${coasterToDelete?.name}"? This will also remove all user rides and rankings for this coaster. This action cannot be undone.`}
      />

      <ConfirmDialog
        isOpen={!!parkToDelete}
        onClose={() => setParkToDelete(null)}
        onConfirm={() => {
          if (parkToDelete) {
            removePark.mutate(parkToDelete.id)
          }
        }}
        title="Delete Park"
        message={
          parkToDelete && parkToDelete.coaster_count > 0
            ? `Are you sure you want to delete "${parkToDelete.name}"? This will also delete its ${parkToDelete.coaster_count} coaster(s) plus all user rides and rankings for them. This action cannot be undone.`
            : `Are you sure you want to delete "${parkToDelete?.name}"? This action cannot be undone.`
        }
      />
    </div>
  )
}
