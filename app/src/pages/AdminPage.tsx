import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, Check, X, Edit, Plus, Home, Search } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { 
  getPendingSubmissions, 
  rejectSubmission, 
  approveSubmission, 
  type CoasterSubmission,
  getAllCoastersAdmin,
  updateCoaster,
  createCoaster,
  getOtherParkId,
  getCoastersInPark,
  moveCoasterToPark,
  type Coaster,
  useParks,
  type Park
} from '../lib/coasters'

type RecomputeResponse = {
  updated: number
  durationMs: number
  iterations: number
  converged: boolean
}

export default function AdminPage() {
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<'submissions' | 'coasters' | 'rehome'>('submissions')
  const [message, setMessage] = useState<string | null>(null)
  
  // Submissions state
  const [rejectNote, setRejectNote] = useState('')
  const [activeRejectId, setActiveRejectId] = useState<string | null>(null)

  // Coaster Management state
  const [searchQuery, setSearchQuery] = useState('')
  const [editingCoaster, setEditingCoaster] = useState<Partial<Coaster> | null>(null)
  const [isAddingCoaster, setIsAddingCoaster] = useState(false)

  // Re-home state
  const [rehomeSearchPark, setRehomeSearchPark] = useState('')
  const [selectedRehomePark, setSelectedRehomePark] = useState<Park | null>(null)

  const { data: allParks = [] } = useParks()

  const { data: submissions = [], isLoading: submissionsLoading } = useQuery({
    queryKey: ['submissions'],
    queryFn: getPendingSubmissions,
    enabled: activeTab === 'submissions',
  })

  const { data: allCoasters = [], isLoading: coastersLoading } = useQuery({
    queryKey: ['coasters-admin'],
    queryFn: getAllCoastersAdmin,
    enabled: activeTab === 'coasters',
  })

  const { data: otherParkId } = useQuery({
    queryKey: ['other-park-id'],
    queryFn: getOtherParkId,
    enabled: activeTab === 'rehome',
  })

  const { data: otherCoasters = [], isLoading: otherCoastersLoading } = useQuery({
    queryKey: ['other-coasters'],
    queryFn: () => otherParkId ? getCoastersInPark(otherParkId) : Promise.resolve([]),
    enabled: activeTab === 'rehome' && !!otherParkId,
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
    onSuccess: (result) => {
      setMessage(
        `Updated ${result.updated} coaster ratings in ${result.durationMs} ms ` +
          `(${result.iterations} iterations, ${result.converged ? 'converged' : 'hit iteration cap'}).`,
      )
      queryClient.invalidateQueries({ queryKey: ['rankings'] })
    },
    onError: (error) => {
      setMessage(`Recompute failed: ${error.message}`)
    },
  })

  const approve = useMutation({
    mutationFn: async ({ id, submission }: { id: string; submission: CoasterSubmission }) => {
      await approveSubmission(id, submission)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['submissions'] })
      queryClient.invalidateQueries({ queryKey: ['rankings'] })
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
    },
  })

  const rehome = useMutation({
    mutationFn: async ({ coasterId, parkId }: { coasterId: string; parkId: string }) => {
      await moveCoasterToPark(coasterId, parkId)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['other-coasters'] })
    },
  })

  const filteredCoasters = allCoasters.filter(c => 
    c.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    c.parks?.name.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const filteredRehomeParks = allParks
    .filter(p => p.name.toLowerCase().includes(rehomeSearchPark.toLowerCase()))
    .slice(0, 5)

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">Admin</h1>
        <div className="flex bg-slate-100 p-1 rounded-lg">
          {(['submissions', 'coasters', 'rehome'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-1 text-sm rounded-md transition-colors ${
                activeTab === tab ? 'bg-white shadow-sm text-slate-900 font-medium' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-4">
        <div className="md:col-span-3 space-y-6">
          {activeTab === 'submissions' && (
            <section className="rounded border border-slate-200 bg-white p-6">
              <h2 className="font-medium text-slate-900 mb-4">Submission Queue</h2>
              {submissionsLoading ? (
                <p className="text-sm text-slate-500">Loading submissions...</p>
              ) : submissions.length === 0 ? (
                <p className="text-sm text-slate-500">No pending submissions.</p>
              ) : (
                <div className="space-y-4">
                  {submissions.map((s) => (
                    <div key={s.id} className="rounded border border-slate-100 p-4 bg-slate-50">
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <h3 className="font-semibold">{s.coaster_name}</h3>
                          <p className="text-sm text-slate-600">{s.park_name}</p>
                          <div className="mt-2 text-xs font-mono bg-white p-2 rounded border border-slate-200 overflow-auto max-h-24">
                            <pre>{JSON.stringify(s.suggested_fields, null, 2)}</pre>
                          </div>
                        </div>
                        <div className="flex gap-2 ml-4">
                          <button
                            onClick={() => approve.mutate({ id: s.id, submission: s })}
                            disabled={approve.isPending}
                            className="p-2 rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
                            title="Approve"
                          >
                            <Check size={16} />
                          </button>
                          <button
                            onClick={() => setActiveRejectId(s.id)}
                            disabled={reject.isPending}
                            className="p-2 rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                            title="Reject"
                          >
                            <X size={16} />
                          </button>
                        </div>
                      </div>
                      {activeRejectId === s.id && (
                        <div className="mt-4 flex gap-2">
                          <input
                            className="flex-1 rounded border p-1 text-sm"
                            placeholder="Reason for rejection..."
                            value={rejectNote}
                            onChange={(e) => setRejectNote(e.target.value)}
                          />
                          <button
                            onClick={() => reject.mutate({ id: s.id, note: rejectNote })}
                            disabled={!rejectNote}
                            className="rounded bg-red-900 px-3 py-1 text-xs text-white hover:bg-red-800 disabled:opacity-50"
                          >
                            Confirm Reject
                          </button>
                          <button
                            onClick={() => setActiveRejectId(null)}
                            className="rounded bg-slate-200 px-3 py-1 text-xs hover:bg-slate-300"
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {activeTab === 'coasters' && (
            <section className="rounded border border-slate-200 bg-white p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="font-medium text-slate-900">Coaster Management</h2>
                <button
                  onClick={() => {
                    setEditingCoaster(null)
                    setIsAddingCoaster(true)
                  }}
                  className="inline-flex items-center gap-1 rounded bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-700"
                >
                  <Plus size={14} /> Add Coaster
                </button>
              </div>

              <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                <input
                  className="w-full rounded border border-slate-200 pl-10 pr-4 py-2 text-sm"
                  placeholder="Search coasters or parks..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>

              {coastersLoading ? (
                <p className="text-sm text-slate-500">Loading coasters...</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 text-slate-500">
                        <th className="pb-2 font-medium">Name</th>
                        <th className="pb-2 font-medium">Park</th>
                        <th className="pb-2 font-medium">Status</th>
                        <th className="pb-2 text-right font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {filteredCoasters.map((c) => (
                        <tr key={c.id} className="hover:bg-slate-50">
                          <td className="py-2">{c.name}</td>
                          <td className="py-2 text-slate-600">{c.parks?.name || 'Unknown'}</td>
                          <td className="py-2">
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase font-bold text-slate-600">
                              {c.status}
                            </span>
                          </td>
                          <td className="py-2 text-right">
                            <button
                              onClick={() => setEditingCoaster(c)}
                              className="p-1 text-slate-400 hover:text-slate-600"
                            >
                              <Edit size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {(isAddingCoaster || editingCoaster) && (
                <div className="mt-6 rounded-lg border border-blue-100 bg-blue-50 p-6">
                  <h3 className="font-medium text-blue-900 mb-4">
                    {isAddingCoaster ? 'Add New Coaster' : 'Edit Coaster'}
                  </h3>
                  <form 
                    onSubmit={(e) => {
                      e.preventDefault()
                      const formData = new FormData(e.currentTarget)
                      const data = {
                        id: editingCoaster?.id,
                        name: formData.get('name') as string,
                        slug: (formData.get('name') as string).toLowerCase().replace(/\s+/g, '-'),
                        park_id: formData.get('park_id') as string,
                        status: formData.get('status') as any,
                        material: formData.get('material') as any,
                        height_m: formData.get('height') ? Number(formData.get('height')) : null,
                        speed_kmh: formData.get('speed') ? Number(formData.get('speed')) : null,
                        length_m: formData.get('length') ? Number(formData.get('length')) : null,
                        inversions: formData.get('inversions') ? Number(formData.get('inversions')) : null,
                        source: 'admin',
                      }
                      saveCoaster.mutate(data)
                    }}
                    className="grid gap-4 md:grid-cols-2"
                  >
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-medium">Name *</label>
                      <input 
                        name="name" 
                        required 
                        defaultValue={editingCoaster?.name} 
                        className="rounded border p-1.5 text-sm" 
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-medium">Park ID *</label>
                      <input 
                        name="park_id" 
                        required 
                        defaultValue={editingCoaster?.park_id} 
                        className="rounded border p-1.5 text-sm" 
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-medium">Status</label>
                      <select name="status" defaultValue={editingCoaster?.status} className="rounded border p-1.5 text-sm">
                        <option value="operating">Operating</option>
                        <option value="defunct">Defunct</option>
                        <option value="sbno">SBNO</option>
                        <option value="under_construction">Under Construction</option>
                        <option value="relocated">Relocated</option>
                        <option value="unknown">Unknown</option>
                      </select>
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-medium">Material</label>
                      <select name="material" defaultValue={editingCoaster?.material} className="rounded border p-1.5 text-sm">
                        <option value="steel">Steel</option>
                        <option value="wood">Wood</option>
                        <option value="hybrid">Hybrid</option>
                        <option value="other">Other</option>
                      </select>
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-medium">Height (m)</label>
                      <input name="height" type="number" step="0.1" defaultValue={editingCoaster?.height_m ?? ''} className="rounded border p-1.5 text-sm" />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-medium">Speed (km/h)</label>
                      <input name="speed" type="number" step="0.1" defaultValue={editingCoaster?.speed_kmh ?? ''} className="rounded border p-1.5 text-sm" />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-medium">Length (m)</label>
                      <input name="length" type="number" step="0.1" defaultValue={editingCoaster?.length_m ?? ''} className="rounded border p-1.5 text-sm" />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-medium">Inversions</label>
                      <input name="inversions" type="number" defaultValue={editingCoaster?.inversions ?? ''} className="rounded border p-1.5 text-sm" />
                    </div>
                    <div className="md:col-span-2 flex justify-end gap-2 mt-2">
                      <button 
                        type="button" 
                        onClick={() => { setEditingCoaster(null); setIsAddingCoaster(false); }}
                        className="px-3 py-1 text-xs text-slate-600 hover:underline"
                      >
                        Cancel
                      </button>
                      <button 
                        type="submit" 
                        disabled={saveCoaster.isPending}
                        className="rounded bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-700 disabled:opacity-50"
                      >
                        {saveCoaster.isPending ? 'Saving...' : 'Save Coaster'}
                      </button>
                    </div>
                  </form>
                </div>
              )}
            </section>
          )}

          {activeTab === 'rehome' && (
            <section className="rounded border border-slate-200 bg-white p-6">
              <div className="flex items-center gap-2 mb-4">
                <Home size={20} className="text-slate-900" />
                <h2 className="font-medium text-slate-900">Re-home Coasters</h2>
              </div>
              <p className="text-sm text-slate-600 mb-6">
                Move coasters from the <code className="bg-slate-100 px-1 rounded">Other (unknown location)</code> park to their correct locations.
              </p>

              <div className="flex gap-4 mb-6 p-4 rounded-lg bg-slate-50 border border-slate-100">
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                  <input
                    className="w-full rounded border border-slate-200 pl-10 pr-4 py-2 text-sm"
                    placeholder="Search for target park..."
                    value={rehomeSearchPark}
                    onChange={(e) => {
                      setRehomeSearchPark(e.target.value)
                      setSelectedRehomePark(null)
                    }}
                  />
                  {rehomeSearchPark && !selectedRehomePark && filteredRehomeParks.length > 0 && (
                    <ul className="absolute z-10 w-full rounded border bg-white shadow-lg mt-1">
                      {filteredRehomeParks.map((p) => (
                        <li
                          key={p.id}
                          className="cursor-pointer p-2 text-sm hover:bg-gray-100"
                          onClick={() => {
                            setSelectedRehomePark(p)
                            setRehomeSearchPark(p.name)
                          }}
                        >
                          {p.name} <span className="text-xs text-gray-500">({p.country})</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">Selected:</span>
                  <span className="text-sm font-medium">
                    {selectedRehomePark ? selectedRehomePark.name : 'None'}
                  </span>
                </div>
              </div>

              {otherCoastersLoading ? (
                <p className="text-sm text-slate-500">Loading coasters...</p>
              ) : otherCoasters.length === 0 ? (
                <p className="text-sm text-slate-500">No coasters found in the 'Other' park.</p>
              ) : (
                <div className="space-y-3">
                  {otherCoasters.map((c) => (
                    <div key={c.id} className="flex justify-between items-center p-3 rounded border border-slate-100 hover:bg-slate-50">
                      <span className="text-sm font-medium">{c.name}</span>
                      <button
                        onClick={() => {
                          if (!selectedRehomePark) {
                            alert('Please select a target park first.')
                            return
                          }
                          rehome.mutate({ coasterId: c.id, parkId: selectedRehomePark.id })
                        }}
                        disabled={rehome.isPending}
                        className="text-xs bg-white border border-slate-200 px-2 py-1 rounded hover:bg-slate-100 disabled:opacity-50"
                      >
                        Move to {selectedRehomePark?.name || 'Selected Park'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>

        <div className="space-y-6">
          <div className="rounded border border-slate-200 bg-white p-6">
            <h2 className="font-medium text-slate-900">Rankings</h2>
            <p className="mt-1 text-sm text-slate-600">
              Refits Bradley-Terry strengths from all ranked lists and upserts{' '}
              <code className="rounded bg-slate-100 px-1 text-xs">coaster_ratings</code>.
            </p>
            <button
              type="button"
              onClick={() => {
                setMessage(null)
                recompute.mutate()
              }}
              disabled={recompute.isPending}
              className="mt-4 inline-flex items-center gap-2 rounded bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-700 disabled:opacity-50"
            >
              <RefreshCw className={recompute.isPending ? 'animate-spin' : ''} size={16} />
              {recompute.isPending ? 'Recomputing…' : 'Recompute now'}
            </button>
            {message && (
              <p className={`mt-4 text-sm ${recompute.isError ? 'text-red-600' : 'text-green-700'}`}>
                {message}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
