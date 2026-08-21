import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import CoasterTable from '../components/CoasterTable'
import { MessageState } from '../components/ui'
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
    return <MessageState>Loading…</MessageState>
  }

  if (park.isError || coasters.isError) {
    return <MessageState tone="danger">Couldn&apos;t load that park.</MessageState>
  }

  if (!park.data) {
    return <MessageState>Park not found.</MessageState>
  }

  const location = [park.data.city, park.data.region, park.data.country].filter(Boolean).join(' · ')

  return (
    <div>
      <h1 className="display-heading text-4xl text-ink">{park.data.name}</h1>
      <p className="mt-2 text-muted">
        {location ? `${location} · ` : ''}
        {parkCoasters.length} coasters
      </p>
      <div className="mt-6">
        <CoasterTable rows={parkCoasters} showPark={false} />
      </div>
      <div className="mt-8">
        <Link to="/" className="text-sm font-medium text-ink underline-offset-4 hover:underline">
          ← Back to the board
        </Link>
      </div>
    </div>
  )
}
