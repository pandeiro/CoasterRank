import type { ReactNode } from 'react'
import { Panel } from './ui'

export default function StatBlock({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Panel className="p-4">
      <dt className="text-xs uppercase tracking-[0.12em] text-muted">{label}</dt>
      <dd className="mt-1 text-lg font-semibold text-ink">{value}</dd>
    </Panel>
  )
}
