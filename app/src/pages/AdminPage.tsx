import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, Check, X, Edit, Plus, Home, Search, Trash2, Copy, LogIn } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { assumeIdentity, listSyntheticUsers } from '../lib/impersonation'
import Toast from '../components/Toast'
import {
  Badge,
  Button,
  ConfirmDialog,
  fieldClassName,
  MessageState,
  Modal,
  Panel,
  selectClassName,
} from '../components/ui'
import Avatar from '../components/ui/Avatar'
import {
  getPendingSubmissions,
  rejectSubmission,
  approveSubmission,
  isCoasterMaterial,
  isCoasterStatus,
  type CoasterSubmission,
  getAllCoastersAdmin,
  updateCoaster,
  createCoaster,
  deleteCoaster,
  getAllParksAdmin,
  updatePark,
  createPark,
  getOtherParkId,
  getCoastersInPark,
  moveCoasterToPark,
  slugify,
  useCoasterAliases,
  addAlias,
  updateAlias,
  deleteAlias,
  type Coaster,
  type AdminCoaster,
  type AdminPark,
  useParks,
  useManufacturers,
  type Park,
  type Manufacturer,
} from '../lib/coasters'

type RecomputeResponse = {
  updated: number
  durationMs: number
  iterations: number
  converged: boolean
}

type ToastState = { id: number; message: string; tone: 'info' | 'error' }

const COASTER_PAGE_SIZE = 50

const ADMIN_TABS = ['coasters', 'parks', 'rehome', 'submissions', 'impersonate'] as const
type AdminTab = (typeof ADMIN_TABS)[number]

function numberOrNull(value: FormDataEntryValue | null): number | null {
  if (value === null || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
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

  const copyToClipboard = async (text: string, field: string) => {
    await navigator.clipboard.writeText(text)
    setCopiedField(field)
    setTimeout(() => setCopiedField(null), 1500)
  }

  // Submissions state
  const [rejectNote, setRejectNote] = useState('')
  const [activeRejectId, setActiveRejectId] = useState<string | null>(null)

  // Coaster Management state
  const [searchQuery, setSearchQuery] = useState('')
  const [editingCoaster, setEditingCoaster] = useState<Partial<Coaster> | null>(null)
  const [isAddingCoaster, setIsAddingCoaster] = useState(false)
  const [coasterLimit, setCoasterLimit] = useState(COASTER_PAGE_SIZE)
  const [formPark, setFormPark] = useState<Park | null>(null)
  const [formParkSearch, setFormParkSearch] = useState('')
  const [formManufacturer, setFormManufacturer] = useState<Manufacturer | null>(null)
  const [formManufacturerSearch, setFormManufacturerSearch] = useState('')
  const [coasterToDelete, setCoasterToDelete] = useState<AdminCoaster | null>(null)
  const [copiedField, setCopiedField] = useState<string | null>(null)

  // Re-home state
  const [rehomeSearchPark, setRehomeSearchPark] = useState('')
  const [selectedRehomePark, setSelectedRehomePark] = useState<Park | null>(null)
  const [rehomeSearchName, setRehomeSearchName] = useState('')

  // Park Management state
  const [parkSearchQuery, setParkSearchQuery] = useState('')
  const [editingPark, setEditingPark] = useState<Partial<AdminPark> | null>(null)
  const [isAddingPark, setIsAddingPark] = useState(false)
  const [parkLimit, setParkLimit] = useState(COASTER_PAGE_SIZE)

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

  const syntheticUsers = useQuery({
    queryKey: ['synthetic-users'],
    queryFn: listSyntheticUsers,
    enabled: activeTab === 'impersonate',
  })

  const assume = useMutation({
    mutationFn: assumeIdentity,
    onError: (err: Error) => notify(err.message, 'error'),
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
      const { data } = await supabase
        .from('cron_execution_logs')
        .select('created_at, duration_ms, iterations, pairs, updated, converged')
        .eq('status', 'success')
        .order('created_at', { ascending: false })
        .limit(1)
        .single()
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
      const { data } = await supabase
        .from('cron_execution_logs')
        .select('created_at, error_message, duration_ms, trigger_source')
        .eq('status', 'error')
        .order('created_at', { ascending: false })
        .limit(1)
        .single()
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
      queryClient.invalidateQueries({ queryKey: ['rankings'] })
      queryClient.invalidateQueries({ queryKey: ['cron-execution-logs'] })
    },
  })

  const approve = useMutation({
    mutationFn: async ({ id, submission }: { id: string; submission: CoasterSubmission }) => {
      await approveSubmission(id, submission)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['submissions'] })
      queryClient.invalidateQueries({ queryKey: ['rankings'] })
      queryClient.invalidateQueries({ queryKey: ['coasters-admin'] })
      queryClient.invalidateQueries({ queryKey: ['parks-admin'] })
      notify('Submission approved and coaster created.')
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
      setActiveRejectId(null)
      setRejectNote('')
      notify('Submission rejected.')
    },
    onError: (error) => {
      notify(`Couldn't reject submission: ${error.message}`, 'error')
    },
  })

  const saveCoaster = useMutation({
    mutationFn: async (coaster: Partial<Coaster>) => {
      if (coaster.id) {
        await updateCoaster(coaster.id, coaster)
      } else {
        await createCoaster(coaster)
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['coasters-admin'] })
      setEditingCoaster(null)
      setIsAddingCoaster(false)
      notify('Coaster saved.')
    },
    onError: (error) => {
      notify(`Couldn't save coaster: ${error.message}`, 'error')
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

  const savePark = useMutation({
    mutationFn: async (park: Partial<AdminPark>) => {
      if (park.id) {
        await updatePark(park.id, park)
      } else {
        await createPark(park)
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['parks-admin'] })
      queryClient.invalidateQueries({ queryKey: ['parks'] })
      setEditingPark(null)
      setIsAddingPark(false)
      notify('Park saved.')
    },
    onError: (error) => {
      notify(`Couldn't save park: ${error.message}`, 'error')
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

  const filteredFormParks = allParks
    .filter((p) => p.name.toLowerCase().includes(formParkSearch.toLowerCase()))
    .slice(0, 5)

  const filteredFormManufacturers = allManufacturers
    .filter((m) => m.name.toLowerCase().includes(formManufacturerSearch.toLowerCase()))
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
    setFormPark(null)
    setFormParkSearch('')
    setFormManufacturer(null)
    setFormManufacturerSearch('')
  }

  function openEditForm(coaster: Partial<Coaster>) {
    setEditingCoaster(coaster)
    setIsAddingCoaster(false)
    setFormPark(allParks.find((p) => p.id === coaster.park_id) ?? null)
    setFormParkSearch('')
    setFormManufacturer(allManufacturers.find((m) => m.id === coaster.manufacturer_id) ?? null)
    setFormManufacturerSearch('')
  }

  function closeForm() {
    setEditingCoaster(null)
    setIsAddingCoaster(false)
    setFormPark(null)
    setFormParkSearch('')
    setFormManufacturer(null)
    setFormManufacturerSearch('')
  }

  function onCoasterSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!formPark) {
      notify('Pick a park for the coaster first.', 'error')
      return
    }
    const formData = new FormData(e.currentTarget)
    const name = (formData.get('name') as string).trim()
    const statusValue = formData.get('status')
    const materialValue = formData.get('material')
    const data: Partial<Coaster> = {
      id: editingCoaster?.id,
      name,
      slug: editingCoaster?.slug ?? slugify(name),
      park_id: formPark.id,
      manufacturer_id: formManufacturer?.id ?? null,
      model: (formData.get('model') as string).trim() || null,
      opening_date: (formData.get('opening_date') as string) || null,
      type: (formData.get('type') as string).trim() || null,
      status: isCoasterStatus(statusValue) ? statusValue : 'operating',
      material: isCoasterMaterial(materialValue) ? materialValue : 'steel',
      height_m: numberOrNull(formData.get('height')),
      speed_kmh: numberOrNull(formData.get('speed')),
      length_m: numberOrNull(formData.get('length')),
      inversions: numberOrNull(formData.get('inversions')),
      source: 'admin',
    }
    saveCoaster.mutate(data)
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

  function onParkSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    const name = (formData.get('name') as string).trim()
    const slugValue = editingPark?.slug ?? slugify(name)
    const data: Partial<AdminPark> = {
      id: editingPark?.id,
      name,
      slug: slugValue,
      country: (formData.get('country') as string).trim() || null,
      region: (formData.get('region') as string).trim() || null,
      city: (formData.get('city') as string).trim() || null,
      lat: numberOrNull(formData.get('lat')),
      lng: numberOrNull(formData.get('lng')),
      source: (formData.get('source') as string) || 'admin',
      external_id: (formData.get('external_id') as string).trim() || null,
    }
    savePark.mutate(data)
  }

  if (!isValidTab) return <Navigate to="/admin/coasters" replace />

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-accent-strong">
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
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </Link>
          ))}
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-4">
        <div className="md:col-span-3 space-y-6">
          {activeTab === 'submissions' && (
            <Panel className="p-6">
              <h2 className="mb-4 text-lg font-semibold text-ink">Submission Queue</h2>
              {submissionsLoading ? (
                <MessageState>Loading submissions...</MessageState>
              ) : submissionsError ? (
                <MessageState tone="danger">Couldn&apos;t load submissions.</MessageState>
              ) : submissions.length === 0 ? (
                <MessageState>No pending submissions.</MessageState>
              ) : (
                <div className="space-y-4">
                  {submissions.map((s) => (
                    <div key={s.id} className="rounded-xl border border-line bg-surface p-4">
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <h3 className="font-semibold">{s.coaster_name}</h3>
                          <p className="text-sm text-muted">{s.park_name}</p>
                          <div className="mt-2 flex items-center gap-2">
                            <Avatar
                              src={s.profiles?.avatar_url ?? null}
                              userId={s.submitted_by}
                              size={20}
                            />
                            <span className="text-xs text-muted">
                              {s.profiles?.username ?? 'Unknown user'}
                            </span>
                          </div>
                          <div className="mt-2 max-h-24 overflow-auto rounded-lg border border-line bg-surface-bright p-2 font-mono text-xs">
                            <pre>{JSON.stringify(s.suggested_fields, null, 2)}</pre>
                          </div>
                        </div>
                        <div className="flex gap-2 ml-4">
                          <button
                            onClick={() => approve.mutate({ id: s.id, submission: s })}
                            disabled={approve.isPending}
                            className="rounded-full bg-success p-2 text-white hover:bg-success/90 disabled:opacity-50"
                            title="Approve"
                          >
                            <Check size={16} />
                          </button>
                          <button
                            onClick={() => setActiveRejectId(s.id)}
                            disabled={reject.isPending}
                            className="rounded-full bg-danger p-2 text-white hover:bg-danger/90 disabled:opacity-50"
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
                            className="rounded-full bg-danger px-3 py-1.5 text-xs text-white hover:bg-danger/90 disabled:opacity-50"
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
                                className="rounded-full p-2 text-muted hover:bg-danger/10 hover:text-danger"
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

              <Modal
                isOpen={isAddingCoaster || !!editingCoaster}
                onClose={closeForm}
                title={isAddingCoaster ? 'Add New Coaster' : 'Edit Coaster'}
              >
                {editingCoaster && (
                  <div className="mb-4 grid grid-cols-[auto_2fr_auto_1fr] items-center gap-x-4 gap-y-1 rounded bg-surface p-3 text-xs">
                    <span className="rounded bg-black/5 px-1.5 py-0.5 text-muted">ID:</span>
                    <span className="flex items-center gap-1 font-mono text-ink">
                      {editingCoaster.id}
                      <button
                        type="button"
                        onClick={() => copyToClipboard(editingCoaster.id!, 'id')}
                        className="rounded p-0.5 text-muted hover:bg-surface-bright hover:text-ink"
                        title="Copy ID"
                      >
                        {copiedField === 'id' ? (
                          <Check size={12} className="text-success" />
                        ) : (
                          <Copy size={12} />
                        )}
                      </button>
                    </span>
                    <span className="rounded bg-black/5 px-1.5 py-0.5 text-muted">Source:</span>
                    <span className="text-ink">{editingCoaster.source}</span>
                    <span className="rounded bg-black/5 px-1.5 py-0.5 text-muted">Park ID:</span>
                    <span className="flex items-center gap-1 font-mono text-ink">
                      {editingCoaster.park_id}
                      <button
                        type="button"
                        onClick={() =>
                          editingCoaster.park_id &&
                          copyToClipboard(editingCoaster.park_id, 'parkId')
                        }
                        className="rounded p-0.5 text-muted hover:bg-surface-bright hover:text-ink"
                        title="Copy Park ID"
                      >
                        {copiedField === 'parkId' ? (
                          <Check size={12} className="text-success" />
                        ) : (
                          <Copy size={12} />
                        )}
                      </button>
                    </span>
                    <span className="rounded bg-black/5 px-1.5 py-0.5 text-muted">Rides:</span>
                    <span className="font-mono text-ink">
                      {'ride_count' in editingCoaster
                        ? (editingCoaster as AdminCoaster).ride_count
                        : 0}
                    </span>
                  </div>
                )}
                <form onSubmit={onCoasterSubmit} className="grid gap-4 md:grid-cols-2">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium">Name *</label>
                    <input
                      name="name"
                      required
                      defaultValue={editingCoaster?.name}
                      className={fieldClassName}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium">Status</label>
                    <select
                      name="status"
                      defaultValue={editingCoaster?.status ?? 'operating'}
                      className={`${selectClassName} w-full`}
                    >
                      <option value="operating">Operating</option>
                      <option value="defunct">Defunct</option>
                      <option value="sbno">SBNO</option>
                      <option value="under_construction">Under Construction</option>
                      <option value="relocated">Relocated</option>
                      <option value="unknown">Unknown</option>
                    </select>
                  </div>
                  <div className="flex flex-col gap-1 relative">
                    <label className="text-xs font-medium">Park *</label>
                    <input
                      required
                      value={formPark ? formPark.name : formParkSearch}
                      onChange={(e) => {
                        setFormParkSearch(e.target.value)
                        setFormPark(null)
                      }}
                      placeholder="Search for a park..."
                      className={fieldClassName}
                    />
                    {formParkSearch && !formPark && filteredFormParks.length > 0 && (
                      <ul className="absolute top-full z-10 w-full overflow-hidden rounded-xl border border-line bg-surface-bright shadow-lift">
                        {filteredFormParks.map((p) => (
                          <li
                            key={p.id}
                            className="cursor-pointer p-2 text-sm hover:bg-canvas"
                            onClick={() => {
                              setFormPark(p)
                              setFormParkSearch(p.name)
                            }}
                          >
                            {p.name} <span className="text-xs text-muted">({p.country})</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {formPark && (
                      <span className="text-xs text-muted">Selected: {formPark.name}</span>
                    )}
                  </div>
                  <div className="flex flex-col gap-1 relative">
                    <label className="text-xs font-medium">Manufacturer</label>
                    <input
                      value={formManufacturer ? formManufacturer.name : formManufacturerSearch}
                      onChange={(e) => {
                        setFormManufacturerSearch(e.target.value)
                        setFormManufacturer(null)
                      }}
                      placeholder="Search for a manufacturer..."
                      className={fieldClassName}
                    />
                    {formManufacturerSearch &&
                      !formManufacturer &&
                      filteredFormManufacturers.length > 0 && (
                        <ul className="absolute top-full z-10 w-full overflow-hidden rounded-xl border border-line bg-surface-bright shadow-lift">
                          {filteredFormManufacturers.map((m) => (
                            <li
                              key={m.id}
                              className="cursor-pointer p-2 text-sm hover:bg-canvas"
                              onClick={() => {
                                setFormManufacturer(m)
                                setFormManufacturerSearch(m.name)
                              }}
                            >
                              {m.name}
                            </li>
                          ))}
                        </ul>
                      )}
                    {formManufacturer && (
                      <span className="text-xs text-muted">Selected: {formManufacturer.name}</span>
                    )}
                  </div>
                  <div className="md:col-span-2 border-t border-line/50" />
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium">Material</label>
                    <select
                      name="material"
                      defaultValue={editingCoaster?.material ?? 'steel'}
                      className={`${selectClassName} w-full`}
                    >
                      <option value="steel">Steel</option>
                      <option value="wood">Wood</option>
                      <option value="hybrid">Hybrid</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium">Height (m)</label>
                    <input
                      name="height"
                      type="number"
                      step="0.1"
                      defaultValue={editingCoaster?.height_m ?? ''}
                      className={fieldClassName}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium">Speed (km/h)</label>
                    <input
                      name="speed"
                      type="number"
                      step="0.1"
                      defaultValue={editingCoaster?.speed_kmh ?? ''}
                      className={fieldClassName}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium">Length (m)</label>
                    <input
                      name="length"
                      type="number"
                      step="0.1"
                      defaultValue={editingCoaster?.length_m ?? ''}
                      className={fieldClassName}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium">Inversions</label>
                    <input
                      name="inversions"
                      type="number"
                      defaultValue={editingCoaster?.inversions ?? ''}
                      className={fieldClassName}
                    />
                  </div>
                  <div className="md:col-span-2 border-t border-line/50" />
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium">Model</label>
                    <input
                      name="model"
                      defaultValue={editingCoaster?.model ?? ''}
                      placeholder="e.g. B&M Hyper"
                      className={fieldClassName}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium">Type</label>
                    <input
                      name="type"
                      defaultValue={editingCoaster?.type ?? ''}
                      placeholder="e.g. Hyper Coaster"
                      className={fieldClassName}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium">Opening Date</label>
                    <input
                      name="opening_date"
                      type="date"
                      defaultValue={editingCoaster?.opening_date ?? ''}
                      className={fieldClassName}
                    />
                  </div>
                  {editingCoaster?.id && <CoasterAliasesSection coasterId={editingCoaster.id} />}
                  <div className="mt-2 flex justify-between gap-2 md:col-span-2">
                    {editingCoaster && (
                      <button
                        type="button"
                        onClick={() => setCoasterToDelete(editingCoaster as AdminCoaster)}
                        className="rounded-full px-3 py-1.5 text-xs text-danger hover:bg-danger/10"
                      >
                        Delete Coaster
                      </button>
                    )}
                    <div className="flex gap-2 ml-auto">
                      <button
                        type="button"
                        onClick={closeForm}
                        className="rounded-full px-3 py-1.5 text-xs text-muted hover:bg-surface"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={saveCoaster.isPending}
                        className="rounded-full bg-coral px-3 py-1.5 text-xs font-medium text-white hover:bg-coral/90 disabled:opacity-50"
                      >
                        {saveCoaster.isPending ? 'Saving...' : 'Save Coaster'}
                      </button>
                    </div>
                  </div>
                </form>
              </Modal>
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

              <Modal
                isOpen={isAddingPark || !!editingPark}
                onClose={closeParkForm}
                title={isAddingPark ? 'Add New Park' : 'Edit Park'}
              >
                {editingPark && (
                  <div className="mb-4 grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-1 rounded bg-surface p-3 text-xs">
                    <span className="rounded bg-black/5 px-1.5 py-0.5 text-muted">ID:</span>
                    <span className="flex items-center gap-1 font-mono text-ink">
                      {editingPark.id}
                      <button
                        type="button"
                        onClick={() => copyToClipboard(editingPark.id!, 'park-id')}
                        className="rounded p-0.5 text-muted hover:bg-surface-bright hover:text-ink"
                        title="Copy ID"
                      >
                        {copiedField === 'park-id' ? (
                          <Check size={12} className="text-success" />
                        ) : (
                          <Copy size={12} />
                        )}
                      </button>
                    </span>
                  </div>
                )}
                <form onSubmit={onParkSubmit} className="grid gap-4 md:grid-cols-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium">Name *</label>
                    <input
                      name="name"
                      required
                      defaultValue={editingPark?.name}
                      className={fieldClassName}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium">Slug</label>
                    <input
                      name="slug"
                      defaultValue={editingPark?.slug ?? slugify(editingPark?.name ?? '')}
                      placeholder="auto-generated"
                      className={fieldClassName}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium">Source</label>
                    <select
                      name="source"
                      defaultValue={editingPark?.source ?? 'admin'}
                      className={`${selectClassName} w-full`}
                    >
                      <option value="admin">Admin</option>
                      <option value="community">Community</option>
                      <option value="open-csv">Open CSV</option>
                    </select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium">Country</label>
                    <input
                      name="country"
                      defaultValue={editingPark?.country ?? ''}
                      className={fieldClassName}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium">Region</label>
                    <input
                      name="region"
                      defaultValue={editingPark?.region ?? ''}
                      className={fieldClassName}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium">City</label>
                    <input
                      name="city"
                      defaultValue={editingPark?.city ?? ''}
                      className={fieldClassName}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium">Latitude</label>
                    <input
                      name="lat"
                      type="number"
                      step="0.000001"
                      min="-90"
                      max="90"
                      defaultValue={editingPark?.lat ?? ''}
                      className={fieldClassName}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium">Longitude</label>
                    <input
                      name="lng"
                      type="number"
                      step="0.000001"
                      min="-180"
                      max="180"
                      defaultValue={editingPark?.lng ?? ''}
                      className={fieldClassName}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium">External ID</label>
                    <input
                      name="external_id"
                      defaultValue={editingPark?.external_id ?? ''}
                      className={fieldClassName}
                    />
                  </div>
                  <div className="mt-2 flex justify-end gap-2 md:col-span-3">
                    <button
                      type="button"
                      onClick={closeParkForm}
                      className="rounded-full px-3 py-1.5 text-xs text-muted hover:bg-surface"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={savePark.isPending}
                      className="rounded-full bg-coral px-3 py-1.5 text-xs font-medium text-white hover:bg-coral/90 disabled:opacity-50"
                    >
                      {savePark.isPending ? 'Saving...' : 'Save Park'}
                    </button>
                  </div>
                </form>
              </Modal>
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

          {activeTab === 'impersonate' && (
            <Panel className="p-6">
              <h2 className="mb-1 text-lg font-semibold text-ink">Assume identity</h2>
              <p className="mb-4 text-sm text-muted">
                Log in as a synthetic test user (seeded via{' '}
                <code className="rounded bg-surface px-1 text-xs">testride:seed</code>, or signed up
                on the{' '}
                <code className="rounded bg-surface px-1 text-xs">@test.coasterrank.dev</code>{' '}
                domain) to exercise the app from their perspective. Your admin session is preserved
                — use &quot;Return to admin&quot; in the banner below to switch back. Real users can
                never be impersonated.
              </p>
              {syntheticUsers.isLoading ? (
                <MessageState>Loading synthetic users…</MessageState>
              ) : syntheticUsers.isError ? (
                <MessageState tone="danger">
                  Couldn&apos;t load synthetic users — is the assume-identity Edge Function
                  deployed?
                </MessageState>
              ) : (syntheticUsers.data?.length ?? 0) === 0 ? (
                <MessageState>
                  No synthetic users found. Create some with{' '}
                  <code className="rounded bg-surface px-1 text-xs">
                    npm run testride:seed -- --users 5 --rides 10-20 --apply
                  </code>
                  .
                </MessageState>
              ) : (
                <div className="space-y-2">
                  {syntheticUsers.data?.map((u) => (
                    <div
                      key={u.id}
                      className="flex items-center justify-between gap-3 rounded-lg bg-surface p-3"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-ink">{u.email}</div>
                        <div className="text-xs text-muted">
                          {u.username ? `@${u.username}` : 'no username'} ·{' '}
                          {u.confirmed ? 'confirmed' : 'unconfirmed'}
                        </div>
                      </div>
                      <Button
                        type="button"
                        onClick={() => assume.mutate(u.id)}
                        disabled={assume.isPending}
                        className="shrink-0"
                      >
                        <LogIn size={16} />
                        Assume
                      </Button>
                    </div>
                  ))}
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
                  Last successful run: {formatTimeAgo(lastRun.data.created_at)}
                </div>
                <div className="mt-1 text-ink">
                  {formatDuration(lastRun.data.duration_ms)} &middot; {lastRun.data.pairs} pairs
                  &rarr; {lastRun.data.updated} coasters &middot; {lastRun.data.iterations}{' '}
                  iterations
                  {lastRun.data.converged ? '' : ' (hit cap)'}
                </div>
              </div>
            )}

            {lastRun.isLoading && (
              <div className="mt-4 text-sm text-muted">Loading run history…</div>
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

            {recompute.isError && (
              <p className="mt-3 text-sm text-danger">
                Recompute failed: {recompute.error.message}
              </p>
            )}
          </Panel>
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
    </div>
  )
}

function CoasterAliasesSection({ coasterId }: { coasterId: string }) {
  const queryClient = useQueryClient()
  const aliases = useCoasterAliases(coasterId)
  const [newAlias, setNewAlias] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['coaster-aliases', coasterId] })
  }

  async function handleAdd() {
    const name = newAlias.trim()
    if (!name) return
    await addAlias(coasterId, name)
    setNewAlias('')
    invalidate()
  }

  async function handleUpdate(id: string) {
    const name = editingName.trim()
    if (!name) return
    await updateAlias(id, name)
    setEditingId(null)
    setEditingName('')
    invalidate()
  }

  async function handleDelete(id: string) {
    await deleteAlias(id)
    invalidate()
  }

  return (
    <div className="md:col-span-2 flex flex-col gap-2">
      <label className="text-xs font-medium">Aliases</label>
      {aliases.data && aliases.data.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {aliases.data.map((alias) => (
            <li key={alias.id} className="flex items-center gap-1">
              {editingId === alias.id ? (
                <>
                  <input
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleUpdate(alias.id)
                      if (e.key === 'Escape') setEditingId(null)
                    }}
                    className={`${fieldClassName} !py-0.5 !text-xs`}
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => handleUpdate(alias.id)}
                    className="text-xs text-accent-strong hover:underline"
                  >
                    <Check className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    className="text-xs text-muted hover:underline"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </>
              ) : (
                <>
                  <span className="rounded-full bg-surface px-2 py-0.5 text-xs text-muted">
                    {alias.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(alias.id)
                      setEditingName(alias.name)
                    }}
                    className="text-muted hover:text-ink"
                  >
                    <Edit className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(alias.id)}
                    className="text-muted hover:text-danger"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <input
          value={newAlias}
          onChange={(e) => setNewAlias(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleAdd()
          }}
          placeholder="Add alias..."
          className={`${fieldClassName} !text-xs`}
        />
        <button
          type="button"
          onClick={handleAdd}
          disabled={!newAlias.trim()}
          className="rounded-full bg-surface px-2 py-0.5 text-xs text-muted hover:bg-surface-bright disabled:opacity-50"
        >
          <Plus className="h-3 w-3" />
        </button>
      </div>
    </div>
  )
}
