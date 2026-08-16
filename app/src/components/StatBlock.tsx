import type { ReactNode } from 'react'

export default function StatBlock({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded border border-slate-200 bg-white p-4">
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 text-lg font-semibold text-slate-900">{value}</dd>
    </div>
  )
}
