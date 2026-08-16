import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import CoasterTable from '../components/CoasterTable'
import { useAllCoasters, usePark } from '../lib/coasters'

export default function ParkDetailPage() {
  const { slug } = useParams()
  const park = usePark(slug)
  const coasters = useAllCoasters()

  const parkCoasters = useMemo(() => {
    const parkData = park.data
    if (!coasters.data || !parkData) return []
    return coasters.data.filter((c) => c.park_id === parkData.id)
  }, [coasters.data, park.data])

  if (park.isPending || coasters.isPending) {
    return <p className="py-16 text-center text-slate-500">Loading…</p>
  }

  if (park.isError || coasters.isError) {
    return <p className="py-16 text-center text-red-600">Couldn&apos;t load that park.</p>
  }

  if (!park.data) {
    return <p className="py-16 text-center text-slate-500">Park not found.</p>
  }

  const location = [park.data.city, park.data.region, park.data.country].filter(Boolean).join(' · ')

  return (
    <div>
      <h1 className="text-3xl font-semibold text-slate-900">{park.data.name}</h1>
      <p className="mt-1 text-slate-600">
        {location ? `${location} · ` : ''}
        {parkCoasters.length} coasters
      </p>
      <div className="mt-6">
        <CoasterTable rows={parkCoasters} showPark={false} />
      </div>
      <div className="mt-8">
        <Link to="/" className="text-sm text-slate-600 hover:underline">
          ← Back to the board
        </Link>
      </div>
    </div>
  )
}
