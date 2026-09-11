import { Panel } from './ui'

// Loading skeleton for the park detail page: mirrors the loaded anatomy
// (hero panel + coaster-table slot) so the fill-in happens inside reserved
// space with no layout jump. Same animate-pulse bar language as
// BoardSkeleton / CoasterDetailSkeleton.
const ROWS = Array.from({ length: 5 }, (_, index) => index)

export default function ParkDetailSkeleton() {
  return (
    <div role="status" aria-label="Loading park details">
      <Panel className="p-5 sm:p-6">
        <div aria-hidden="true" className="h-3 w-16 animate-pulse rounded bg-line/60" />
        <div aria-hidden="true" className="mt-2 h-9 w-1/2 animate-pulse rounded bg-line/60" />
        <div aria-hidden="true" className="mt-2 h-4 w-1/3 animate-pulse rounded bg-line/60" />
      </Panel>
      <Panel className="mt-6 overflow-hidden">
        <ul aria-hidden="true" className="divide-y divide-line/70">
          {ROWS.map((index) => (
            <li key={index} className="flex min-h-[52px] items-center gap-2.5 px-4 py-2.5">
              <span className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-line/60" />
              <span className="h-4 min-w-0 flex-1 animate-pulse rounded bg-line/60" />
              <span className="h-4 w-12 shrink-0 animate-pulse rounded bg-line/60" />
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  )
}
