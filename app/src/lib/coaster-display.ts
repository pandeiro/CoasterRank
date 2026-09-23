// Pure board display helpers (no React). Lives outside CoasterTable so that
// file only exports components — otherwise the oxlint
// react(only-export-components) rule fires and Fast Refresh degrades to a
// full reload when the table is edited.
import type { CoasterStatus } from './board-types'

// Non-operating rows carry a status pill: SBNO verbatim (accent),
// under-construction rides as "Pre-launch" (neutral — not historic), every
// other non-operating status collapsed to "Historic" (neutral). Shared by the
// board table and the park bulk-add picker's checklist rows (same labels,
// same semantics).
export function statusPill(
  status: CoasterStatus,
): { label: string; tone: 'accent' | 'neutral' } | null {
  if (status === 'operating') return null
  if (status === 'sbno') return { label: 'SBNO', tone: 'accent' }
  if (status === 'under_construction') return { label: 'Pre-launch', tone: 'neutral' }
  return { label: 'Historic', tone: 'neutral' }
}

// §5.2: one font tier down at ≥100, another at ≥1000, so 3–4 digit ranks
// stay inside the fixed column (and the 40px circle) without clipping.
export function rankFontClass(position: number): string {
  if (position >= 1000) return 'text-xs'
  if (position >= 100) return 'text-sm'
  return 'text-base'
}
