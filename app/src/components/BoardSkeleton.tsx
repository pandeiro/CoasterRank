import { Panel } from './ui'

const BARS = Array.from({ length: 8 }, (_, index) => index)

// Loading skeleton for the board slot (§8.3): 8 bars in BOTH layouts —
// CSS-gated exactly like CoasterTable — mirroring the row anatomy, including
// the §5.2 tight gutter and §7.2 vertical centering, so the cross-fade to the
// table happens inside a reserved min-h slot with no layout jump.
export default function BoardSkeleton() {
  return (
    <Panel className="overflow-hidden">
      <ul className="divide-y divide-line/70 sm:hidden">
        {BARS.map((index) => (
          <li key={index} className="flex min-h-[52px] items-center gap-2.5 px-4 py-2.5">
            <span
              aria-hidden="true"
              className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-line/60"
            />
            <span
              aria-hidden="true"
              className="h-4 min-w-0 flex-1 animate-pulse rounded bg-line/60"
            />
            <span
              aria-hidden="true"
              className="h-4 w-12 shrink-0 animate-pulse rounded bg-line/60"
            />
          </li>
        ))}
      </ul>
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full table-fixed text-sm">
          <thead>
            <tr className="border-b border-line">
              <th className="w-[4.5rem] px-3 py-2.5 text-right">
                <span className="sr-only">Rank</span>
              </th>
              <th className="py-2.5 pl-3 pr-4" />
              <th className="w-[30%] px-4 py-2.5" />
              <th className="hidden w-56 px-4 py-2.5 lg:table-cell" />
              <th className="w-20 px-4 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line/70">
            {BARS.map((index) => (
              <tr key={index}>
                <td className="px-3 py-2.5">
                  <div className="flex justify-end">
                    <span
                      aria-hidden="true"
                      className="h-10 w-10 animate-pulse rounded-full bg-line/60"
                    />
                  </div>
                </td>
                <td className="py-2.5 pl-3 pr-4">
                  <span
                    aria-hidden="true"
                    className="block h-4 w-full animate-pulse rounded bg-line/60"
                  />
                </td>
                <td className="px-4 py-2.5">
                  <span
                    aria-hidden="true"
                    className="block h-4 w-3/4 animate-pulse rounded bg-line/60"
                  />
                </td>
                <td className="hidden px-4 py-2.5 lg:table-cell">
                  <span
                    aria-hidden="true"
                    className="block h-4 w-16 animate-pulse rounded bg-line/60"
                  />
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex justify-end">
                    <span
                      aria-hidden="true"
                      className="h-4 w-12 animate-pulse rounded bg-line/60"
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}
