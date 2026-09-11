// Loading skeleton for the coaster detail page: mirrors the loaded anatomy
// (identity eyebrow + display title, ranking panel box, 8-cell spec grid) so
// the fill-in happens inside reserved space with no layout jump. Same
// animate-pulse bar language as BoardSkeleton.
const SPEC_CELLS = Array.from({ length: 8 }, (_, index) => index)

export default function CoasterDetailSkeleton() {
  return (
    <div role="status" aria-label="Loading coaster details">
      {/* Identity block: eyebrow line + display title */}
      <div aria-hidden="true" className="h-4 w-1/2 animate-pulse rounded bg-line/60" />
      <div
        aria-hidden="true"
        className="mt-2 h-10 w-2/3 animate-pulse rounded bg-line/60 sm:h-12"
      />

      {/* Ranking panel box */}
      <div aria-hidden="true" className="mt-6 rounded-xl border border-line bg-surface p-5 sm:p-6">
        <div className="h-3 w-32 animate-pulse rounded bg-line/60" />
        <div className="mt-3 flex items-center gap-4">
          <div className="h-12 w-24 animate-pulse rounded bg-line/60" />
          <div className="h-10 w-28 animate-pulse rounded bg-line/60" />
        </div>
        <div className="mt-4 grid grid-cols-3 gap-3 border-t border-line pt-4">
          {SPEC_CELLS.slice(0, 3).map((index) => (
            <div key={index} className="h-9 animate-pulse rounded bg-line/60" />
          ))}
        </div>
      </div>

      {/* Coaster details spec grid */}
      <div aria-hidden="true" className="mt-8">
        <div className="h-3 w-28 animate-pulse rounded bg-line/60" />
        <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
          {SPEC_CELLS.map((index) => (
            <div key={index}>
              <div className="h-3 w-16 animate-pulse rounded bg-line/60" />
              <div className="mt-2 h-6 w-24 animate-pulse rounded bg-line/60" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
