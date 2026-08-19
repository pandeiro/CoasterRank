import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { useParks, type Park, submitCoaster } from '../lib/coasters'
import Toast from '../components/Toast'

export default function SubmitPage() {
  const navigate = useNavigate()
  const { data: parks = [] } = useParks()

  const [searchPark, setSearchPark] = useState('')
  const [selectedPark, setSelectedPark] = useState<Park | null>(null)
  const [toast, setToast] = useState<{ message: string; tone: 'info' | 'error' } | null>(null)

  const filteredParks = parks
    .filter((p) => p.name.toLowerCase().includes(searchPark.toLowerCase()))
    .slice(0, 5)

  const mutation = useMutation({
    mutationFn: submitCoaster,
    onSuccess: () => {
      setToast({ message: 'Submission submitted successfully!', tone: 'info' })
      setTimeout(() => {
        navigate('/me')
      }, 2000)
    },
    onError: (error: any) => {
      setToast({ message: error.message || 'Failed to submit coaster', tone: 'error' })
    },
  })

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)

    const data = {
      coaster_name: formData.get('coaster_name') as string,
      park_name: formData.get('park_name') as string,
      park_id: selectedPark?.id || null,
      suggested_fields: {
        height_m: formData.get('height') ? Number(formData.get('height')) : null,
        speed_kmh: formData.get('speed') ? Number(formData.get('speed')) : null,
        length_m: formData.get('length') ? Number(formData.get('length')) : null,
        inversions: formData.get('inversions') ? Number(formData.get('inversions')) : null,
        material: (formData.get('material') as string) || null,
      },
    }

    mutation.mutate(data)
  }

  return (
    <div className="mx-auto max-w-2xl py-8 px-4">
      <h1 className="text-3xl font-bold mb-6">Submit a Coaster</h1>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid gap-6 md:grid-cols-2">
          <div className="flex flex-col gap-2">
            <label htmlFor="coaster_name" className="text-sm font-medium">
              Coaster Name *
            </label>
            <input
              id="coaster_name"
              name="coaster_name"
              required
              className="rounded border p-2"
              placeholder="e.g. Steel Vengeance"
            />
          </div>

          <div className="flex flex-col gap-2 relative">
            <label htmlFor="park_name" className="text-sm font-medium">
              Park Name *
            </label>
            <input
              id="park_name"
              name="park_name"
              required
              value={selectedPark ? selectedPark.name : searchPark}
              onChange={(e) => {
                setSearchPark(e.target.value)
                setSelectedPark(null)
              }}
              className="rounded border p-2"
              placeholder="Search for a park..."
            />

            {searchPark && !selectedPark && filteredParks.length > 0 && (
              <ul className="absolute z-10 w-full rounded border bg-white shadow-lg">
                {filteredParks.map((p) => (
                  <li
                    key={p.id}
                    className="cursor-pointer p-2 hover:bg-gray-100"
                    onClick={() => {
                      setSelectedPark(p)
                      setSearchPark(p.name)
                    }}
                  >
                    {p.name} <span className="text-xs text-gray-500">({p.country})</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="border-t pt-6">
          <h3 className="text-lg font-medium mb-4">Suggested Stats (Optional)</h3>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-2">
              <label htmlFor="height" className="text-sm font-medium">
                Height (m)
              </label>
              <input
                id="height"
                name="height"
                type="number"
                step="0.1"
                className="rounded border p-2"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label htmlFor="speed" className="text-sm font-medium">
                Speed (km/h)
              </label>
              <input
                id="speed"
                name="speed"
                type="number"
                step="0.1"
                className="rounded border p-2"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label htmlFor="length" className="text-sm font-medium">
                Length (m)
              </label>
              <input
                id="length"
                name="length"
                type="number"
                step="0.1"
                className="rounded border p-2"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label htmlFor="inversions" className="text-sm font-medium">
                Inversions
              </label>
              <input
                id="inversions"
                name="inversions"
                type="number"
                className="rounded border p-2"
              />
            </div>
            <div className="flex flex-col gap-2 md:col-span-2">
              <label htmlFor="material" className="text-sm font-medium">
                Material
              </label>
              <select id="material" name="material" className="rounded border p-2">
                <option value="">Select material...</option>
                <option value="steel">Steel</option>
                <option value="wood">Wood</option>
                <option value="hybrid">Hybrid</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={mutation.isPending}
            className="rounded bg-blue-600 px-6 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {mutation.isPending ? 'Submitting...' : 'Submit for Review'}
          </button>
        </div>
      </form>

      {toast && (
        <Toast message={toast.message} tone={toast.tone} onDismiss={() => setToast(null)} />
      )}
    </div>
  )
}
