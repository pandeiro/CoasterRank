import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Check, Edit, Plus, X } from 'lucide-react'
import { fieldClassName } from '../ui'
import { addAlias, deleteAlias, updateAlias, useCoasterAliases } from '../../lib/coasters'

// Alias manager for the coaster edit form (moved verbatim from AdminPage so
// the admin console and the detail-page quick-edit share one implementation).
export default function CoasterAliasesManager({ coasterId }: { coasterId: string }) {
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
                    className="text-xs text-accent-text hover:underline"
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
                    className="text-muted hover:text-danger-text"
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
