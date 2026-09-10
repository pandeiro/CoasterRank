import type { FormEvent } from 'react'
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, Copy } from 'lucide-react'
import { fieldClassName, Modal, selectClassName } from '../ui'
import {
  createPark,
  refreshBoardData,
  slugify,
  updatePark,
  type AdminPark,
} from '../../lib/coasters'

function numberOrNull(value: FormDataEntryValue | null): number | null {
  if (value === null || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export type ParkEditModalProps = {
  /** Seed row. Edit mode requires `id`; create mode starts blank. */
  initial: Partial<AdminPark> | null
  mode: 'create' | 'edit'
  onClose: () => void
  onSaved: () => void
  onError: (message: string) => void
  /** Admin console passes this to keep delete next to save; detail pages omit it. */
  onRequestDelete?: (park: Partial<AdminPark>) => void
}

// Shared park add/edit form — the single implementation behind the admin
// console and the detail-page quick-edit. Writes stay gated server-side by
// RLS (`parks admin manage` = is_admin()); this component is only ever
// mounted for admins (see useIsAdmin call sites).
export default function ParkEditModal({
  initial,
  mode,
  onClose,
  onSaved,
  onError,
  onRequestDelete,
}: ParkEditModalProps) {
  const queryClient = useQueryClient()
  const isAdding = mode === 'create'
  const [copiedField, setCopiedField] = useState<string | null>(null)

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
      // Detail + board freshness (same pattern as the coaster modal).
      queryClient.invalidateQueries({ queryKey: ['park'] })
      void refreshBoardData(queryClient).catch(() => {})
      onSaved()
    },
    onError: (error: Error) => {
      onError(`Couldn't save park: ${error.message}`)
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
    const formData = new FormData(e.currentTarget)
    const name = (formData.get('name') as string).trim()
    const slugValue = (formData.get('slug') as string).trim() || initial?.slug || slugify(name)
    const data: Partial<AdminPark> = {
      id: initial?.id,
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

  return (
    <Modal isOpen onClose={onClose} title={isAdding ? 'Add New Park' : 'Edit Park'}>
      {initial && !isAdding && (
        <div className="mb-4 grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-1 rounded bg-surface p-3 text-xs">
          <span className="rounded bg-black/5 px-1.5 py-0.5 text-muted">ID:</span>
          <span className="flex items-center gap-1 font-mono text-ink">
            {initial.id}
            <button
              type="button"
              onClick={() => copyToClipboard(initial.id!, 'park-id')}
              className="rounded p-0.5 text-muted hover:bg-surface-bright hover:text-ink"
              title="Copy ID"
            >
              {copiedField === 'park-id' ? (
                <Check size={12} className="text-success-text" />
              ) : (
                <Copy size={12} />
              )}
            </button>
          </span>
        </div>
      )}
      <form onSubmit={onSubmit} className="grid gap-4 md:grid-cols-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium">Name *</label>
          <input name="name" required defaultValue={initial?.name} className={fieldClassName} />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium">Slug</label>
          <input
            name="slug"
            defaultValue={initial?.slug ?? slugify(initial?.name ?? '')}
            placeholder="auto-generated"
            className={fieldClassName}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium">Source</label>
          <select
            name="source"
            defaultValue={initial?.source ?? 'admin'}
            className={`${selectClassName} w-full`}
          >
            <option value="admin">Admin</option>
            <option value="community">Community</option>
            <option value="open-csv">Open CSV</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium">Country</label>
          <input name="country" defaultValue={initial?.country ?? ''} className={fieldClassName} />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium">Region</label>
          <input name="region" defaultValue={initial?.region ?? ''} className={fieldClassName} />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium">City</label>
          <input name="city" defaultValue={initial?.city ?? ''} className={fieldClassName} />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium">Latitude</label>
          <input
            name="lat"
            type="number"
            step="0.000001"
            min="-90"
            max="90"
            defaultValue={initial?.lat ?? ''}
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
            defaultValue={initial?.lng ?? ''}
            className={fieldClassName}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium">External ID</label>
          <input
            name="external_id"
            defaultValue={initial?.external_id ?? ''}
            className={fieldClassName}
          />
        </div>
        <div className="mt-2 flex justify-between gap-2 md:col-span-3">
          {onRequestDelete && initial && !isAdding ? (
            <button
              type="button"
              onClick={() => onRequestDelete(initial)}
              className="rounded-full px-3 py-1.5 text-xs text-danger-text hover:bg-danger/10"
            >
              Delete Park
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
              disabled={savePark.isPending}
              className="rounded-full bg-coral-text px-3 py-1.5 text-xs font-medium text-white hover:bg-coral-text/90 disabled:opacity-50"
            >
              {savePark.isPending ? 'Saving...' : 'Save Park'}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  )
}
