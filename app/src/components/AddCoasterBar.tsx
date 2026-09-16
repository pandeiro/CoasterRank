import { useEffect, useRef, useState, type ReactNode } from 'react'
import { MapPin, Upload } from 'lucide-react'
import CoasterSearchBar from './CoasterSearchBar'
import { Button } from './ui'
import type { RankingRow } from '../lib/coasters'

type Props = {
  existingCoasterIds: Set<string>
  onAdd: (row: RankingRow) => void
  /** Park bulk-add picker entry — omitted where it doesn't apply. */
  onAddFromPark?: () => void
  /** Spreadsheet/paste import entry — omitted where it doesn't apply. */
  onImport?: () => void
  /** Extra content inside the sticky container below the input row (e.g.
   *  /me's pending-add position banner). */
  children?: ReactNode
}

// The sticky search bar only gets its backdrop once it has actually stuck to
// the header — in normal flow it stays transparent so adjacent card shadows
// (header above, first ranked card below) aren't painted over.
const SEARCH_STUCK_ROOT_MARGIN = '-64px 0px 0px 0px'

/**
 * The shared coaster-add bar (search + park picker + import), identical on
 * /me and the /rank guest workbench: sentinel-tracked sticky row that gains
 * a backdrop only while stuck.
 */
export default function AddCoasterBar({
  existingCoasterIds,
  onAdd,
  onAddFromPark,
  onImport,
  children,
}: Props) {
  const searchSentinelRef = useRef<HTMLDivElement>(null)
  const [searchStuck, setSearchStuck] = useState(false)

  useEffect(() => {
    const sentinel = searchSentinelRef.current
    if (!sentinel) return
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (entry) setSearchStuck(!entry.isIntersecting)
      },
      { rootMargin: SEARCH_STUCK_ROOT_MARGIN },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [])

  return (
    <>
      <div ref={searchSentinelRef} aria-hidden="true" className="h-px" />
      <div
        className={`sticky top-16 z-20 pb-3 pt-3 transition-colors duration-200 ${
          searchStuck ? 'bg-canvas/95 backdrop-blur' : ''
        }`}
      >
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="min-w-0 flex-1">
            <CoasterSearchBar existingCoasterIds={existingCoasterIds} onAdd={onAdd} />
          </div>
          {onAddFromPark && (
            <Button
              variant="outline"
              size="md"
              aria-label="Add coasters from a park"
              className="shrink-0 self-stretch"
              onClick={onAddFromPark}
            >
              <MapPin className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Add from park</span>
            </Button>
          )}
          {onImport && (
            <Button
              variant="outline"
              size="md"
              aria-label="Import list"
              className="shrink-0 self-stretch"
              onClick={onImport}
            >
              <Upload className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Import list</span>
            </Button>
          )}
        </div>
        {children}
      </div>
    </>
  )
}
