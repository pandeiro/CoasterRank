import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, Copy } from 'lucide-react'
import { fieldClassName, Modal, selectClassName } from '../ui'
import ManufacturerMultiPicker from '../ManufacturerMultiPicker'
import {
  createCoaster,
  isCoasterMaterial,
  isCoasterStatus,
  refreshBoardData,
  setCoasterLineage,
  slugify,
  updateCoaster,
  useManufacturers,
  useParks,
  type AdminCoaster,
  type Coaster,
  type ManufacturerPick,
  type RankingRow,
  type Park,
} from '../../lib/coasters'
import CoasterAliasesManager from './CoasterAliasesManager'

function numberOrNull(value: FormDataEntryValue | null): number | null {
  if (value === null || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

// Ordered lineage ids from either seed shape: the admin console passes an
// AdminCoaster (junction embed), the detail-page quick-edit passes a view row
// (manufacturer_ids/names; legacy single id as final fallback).
function initialLineageIds(initial: Partial<Coaster> | null): string[] {
  if (!initial) return []
  const cm = (initial as Partial<AdminCoaster>).coaster_manufacturers
  if (cm && cm.length > 0) return cm.map((row) => row.manufacturer_id)
  const row = initial as Partial<RankingRow>
  if (row.manufacturer_ids && row.manufacturer_ids.length > 0) {
    return row.manufacturer_ids.filter((id): id is string => Boolean(id))
  }
  return row.manufacturer_id ? [row.manufacturer_id] : []
}

export type CoasterEditModalProps = {
  /** Seed row. Edit mode requires `id`; create mode starts blank. */
  initial: Partial<Coaster> | null
  mode: 'create' | 'edit'
  onClose: () => void
  onSaved: () => void
  onError: (message: string) => void
  /** Admin console passes this to keep delete next to save; detail pages omit it. */
  onRequestDelete?: (coaster: Partial<Coaster>) => void
}

// Shared coaster add/edit form — the single implementation behind the admin
// console and the detail-page quick-edit. Writes stay gated server-side by
// RLS (`coasters admin manage` = is_admin()); this component is only ever
// mounted for admins (see useIsAdmin call sites).
export default function CoasterEditModal({
  initial,
  mode,
  onClose,
  onSaved,
  onError,
  onRequestDelete,
}: CoasterEditModalProps) {
  const queryClient = useQueryClient()
  const isAdding = mode === 'create'
  const [formPark, setFormPark] = useState<Park | null>(null)
  const [formParkSearch, setFormParkSearch] = useState('')
  // Manufacturer lineage (multi): ordered list, index 0 = primary.
  const [formLineage, setFormLineage] = useState<ManufacturerPick[]>([])
  const [copiedField, setCopiedField] = useState<string | null>(null)
  // Park/manufacturer pickers resolve the initial ids to display rows once the
  // (cached) reference lists arrive — same pattern the admin page used inline.
  const [resolved, setResolved] = useState(false)

  const { data: allParks = [] } = useParks()
  const { data: allManufacturers = [] } = useManufacturers()

  // Pre-select the seed row's park/lineage once the (cached) reference lists
  // arrive, so the form shows current values instead of empty pickers.
  useEffect(() => {
    if (resolved || allParks.length === 0) return
    if (initial?.park_id) {
      const match = allParks.find((p) => p.id === initial.park_id)
      if (match) setFormPark(match)
    }
    const seedIds = initialLineageIds(initial)
    if (seedIds.length > 0) {
      const byId = new Map(allManufacturers.map((m) => [m.id, m]))
      setFormLineage(
        seedIds.flatMap((id) => {
          const m = byId.get(id)
          return m ? [{ id: m.id, name: m.name }] : []
        }),
      )
    }
    setResolved(true)
  }, [resolved, allParks, allManufacturers, initial])

  const filteredFormParks = allParks
    .filter((p) => p.name.toLowerCase().includes(formParkSearch.toLowerCase()))
    .slice(0, 5)

  const saveCoaster = useMutation({
    mutationFn: async ({ coaster, lineage }: { coaster: Partial<Coaster>; lineage: string[] }) => {
      if (coaster.id) {
        await updateCoaster(coaster.id, coaster)
        await setCoasterLineage(coaster.id, lineage, 'admin')
      } else {
        await createCoaster(coaster, lineage)
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['coasters-admin'] })
      // Detail + board freshness: the detail query key is ['coaster', slug],
      // so invalidate the whole ['coaster'] prefix; the board bypasses its
      // edge cache via refreshBoardData (same as the admin park save).
      queryClient.invalidateQueries({ queryKey: ['coaster'] })
      void refreshBoardData(queryClient).catch(() => {})
      onSaved()
    },
    onError: (error: Error) => {
      onError(`Couldn't save coaster: ${error.message}`)
    },
  })

  function copyToClipboard(text: string, field: string) {
    void navigator.clipboard.writeText(text).then(() => {
      setCopiedField(field)
      setTimeout(() => setCopiedField(null), 1500)
    })
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!formPark) {
      onError('Pick a park for the coaster first.')
      return
    }
    const formData = new FormData(e.currentTarget)
    const name = (formData.get('name') as string).trim()
    const statusValue = formData.get('status')
    const materialValue = formData.get('material')
    // NOTE: no manufacturer_id here — the primary pointer is trigger-maintained
    // from coaster_manufacturers; lineage rides as the ordered id list below.
    const data: Partial<Coaster> = {
      id: initial?.id,
      name,
      slug: initial?.slug ?? slugify(name),
      park_id: formPark.id,
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
    saveCoaster.mutate({
      coaster: data,
      lineage: formLineage.filter((p) => p.id !== null).map((p) => p.id),
    })
  }

  return (
    <Modal isOpen onClose={onClose} title={isAdding ? 'Add New Coaster' : 'Edit Coaster'}>
      {initial && !isAdding && (
        <div className="mb-4 grid grid-cols-[auto_2fr_auto_1fr] items-center gap-x-4 gap-y-1 rounded bg-surface p-3 text-xs">
          <span className="rounded bg-black/5 px-1.5 py-0.5 text-muted">ID:</span>
          <span className="flex items-center gap-1 font-mono text-ink">
            {initial.id}
            <button
              type="button"
              onClick={() => copyToClipboard(initial.id!, 'id')}
              className="rounded p-0.5 text-muted hover:bg-surface-bright hover:text-ink"
              title="Copy ID"
            >
              {copiedField === 'id' ? (
                <Check size={12} className="text-success-text" />
              ) : (
                <Copy size={12} />
              )}
            </button>
          </span>
          <span className="rounded bg-black/5 px-1.5 py-0.5 text-muted">Source:</span>
          <span className="text-ink">{initial.source}</span>
          <span className="rounded bg-black/5 px-1.5 py-0.5 text-muted">Park ID:</span>
          <span className="flex items-center gap-1 font-mono text-ink">
            {initial.park_id}
            <button
              type="button"
              onClick={() => initial.park_id && copyToClipboard(initial.park_id, 'parkId')}
              className="rounded p-0.5 text-muted hover:bg-surface-bright hover:text-ink"
              title="Copy Park ID"
            >
              {copiedField === 'parkId' ? (
                <Check size={12} className="text-success-text" />
              ) : (
                <Copy size={12} />
              )}
            </button>
          </span>
          <span className="rounded bg-black/5 px-1.5 py-0.5 text-muted">Rides:</span>
          <span className="font-mono text-ink">
            {'ride_count' in initial ? (initial as AdminCoaster).ride_count : 0}
          </span>
        </div>
      )}
      <form onSubmit={onSubmit} className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium">Name *</label>
          <input name="name" required defaultValue={initial?.name} className={fieldClassName} />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium">Status</label>
          <select
            name="status"
            defaultValue={initial?.status ?? 'operating'}
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
          {formPark && <span className="text-xs text-muted">Selected: {formPark.name}</span>}
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium">Manufacturers</label>
          <ManufacturerMultiPicker
            manufacturers={allManufacturers}
            selected={formLineage}
            onChange={setFormLineage}
            placeholder="Search for a manufacturer..."
          />
        </div>
        <div className="md:col-span-2 border-t border-line/50" />
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium">Material</label>
          <select
            name="material"
            defaultValue={initial?.material ?? 'steel'}
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
            step="any"
            defaultValue={initial?.height_m ?? ''}
            className={fieldClassName}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium">Speed (km/h)</label>
          <input
            name="speed"
            type="number"
            step="any"
            defaultValue={initial?.speed_kmh ?? ''}
            className={fieldClassName}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium">Length (m)</label>
          <input
            name="length"
            type="number"
            step="any"
            defaultValue={initial?.length_m ?? ''}
            className={fieldClassName}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium">Inversions</label>
          <input
            name="inversions"
            type="number"
            defaultValue={initial?.inversions ?? ''}
            className={fieldClassName}
          />
        </div>
        <div className="md:col-span-2 border-t border-line/50" />
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium">Model</label>
          <input
            name="model"
            defaultValue={initial?.model ?? ''}
            placeholder="e.g. B&M Hyper"
            className={fieldClassName}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium">Type</label>
          <input
            name="type"
            defaultValue={initial?.type ?? ''}
            placeholder="e.g. Hyper Coaster"
            className={fieldClassName}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium">Opening Date</label>
          <input
            name="opening_date"
            type="date"
            defaultValue={initial?.opening_date ?? ''}
            className={fieldClassName}
          />
        </div>
        {initial?.id && !isAdding && <CoasterAliasesManager coasterId={initial.id} />}
        <div className="mt-2 flex justify-between gap-2 md:col-span-2">
          {onRequestDelete && initial && !isAdding ? (
            <button
              type="button"
              onClick={() => onRequestDelete(initial)}
              className="rounded-full px-3 py-1.5 text-xs text-danger-text hover:bg-danger/10"
            >
              Delete Coaster
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2 ml-auto">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full px-3 py-1.5 text-xs text-muted hover:bg-surface"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saveCoaster.isPending}
              className="rounded-full bg-coral-text px-3 py-1.5 text-xs font-medium text-white hover:bg-coral-text/90 disabled:opacity-50"
            >
              {saveCoaster.isPending ? 'Saving...' : 'Save Coaster'}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  )
}
