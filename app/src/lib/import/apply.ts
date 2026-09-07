import { supabase } from '../supabase'
import type { RankingRow } from '../coasters'
import type { CatalogEntry } from 'coaster-match'
import type { UserRide } from '../rides'

// Bridge between the board dataset and the pure matcher, plus the
// apply/telemetry calls. Keeping the adapter here (not in the component)
// means the review flow stays a thin render over lib functions.

export type ImportSource = 'csv' | 'xls' | 'xlsx' | 'paste' | 'sheets'

export type ImportStats = {
  auto_matched?: number
  candidate_picked?: number
  not_found?: number
  overrides?: number
  duration_ms?: number
  file_bytes?: number
  unmatched_names?: string[]
}

export function catalogFromBoard(rows: RankingRow[]): CatalogEntry[] {
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    park: row.park_name,
    aliases: row.aliases ?? [],
  }))
}

// The review screen resolves each candidate/missing row via `selectedId`.

export type ApplyImportArgs = {
  /** Final ordered ranked list: existing ranked rows (in order) + accepted imports. */
  orderedIds: string[]
  replace: boolean
  source: ImportSource
  stats: ImportStats
  /** Coaster ids to force back into the unranked holding pen (undo of promoted rows). */
  unrankIds?: string[]
}

/**
 * Commits the import via the security-definer RPC (atomic gapless renumber +
 * profiles stamp + 'applied' telemetry event). Returns the row count now
 * ranked.
 */
export async function applyImport(args: ApplyImportArgs): Promise<number> {
  const { data, error } = await supabase.rpc('apply_imported_rides', {
    p_rides: args.orderedIds,
    p_replace: args.replace,
    p_source: args.source,
    p_stats: {
      ...args.stats,
      unmatched_names: args.stats.unmatched_names?.slice(0, 50) ?? [],
    },
    p_unrank_ids: args.unrankIds ?? [],
  })
  if (error) throw error
  return typeof data === 'number' ? data : Number(data ?? 0)
}

/**
 * Holding-pen rows the import promoted to ranked (they appear in the applied
 * payload but were unranked before). An undo must push exactly these back to
 * the pen — a replace-mode undo that only re-inserts prior ranked ids would
 * delete them outright, since the (user_id, coaster_id) row IS the pen row.
 */
export function computePromotedIds(priorRides: UserRide[], appliedIds: string[]): string[] {
  const applied = new Set(appliedIds)
  return priorRides
    .filter((r) => r.rank === null && applied.has(r.coaster_id))
    .map((r) => r.coaster_id)
}

// Client-side lifecycle events ('parsed' | 'undo' | 'failed'). The 'applied'
// event is written by the RPC itself. Best-effort: telemetry must never
// break the user flow, so failures only warn.
export async function logImportEvent(
  kind: 'parsed' | 'undo' | 'failed',
  source: ImportSource,
  extra: {
    rowsTotal?: number
    stats?: ImportStats
  } = {},
): Promise<void> {
  try {
    const { error } = await supabase.from('import_events').insert({
      kind,
      source,
      rows_total: extra.rowsTotal ?? 0,
      auto_matched: extra.stats?.auto_matched ?? null,
      candidate_picked: extra.stats?.candidate_picked ?? null,
      not_found: extra.stats?.not_found ?? null,
      overrides: extra.stats?.overrides ?? null,
      duration_ms: extra.stats?.duration_ms ?? null,
      file_bytes: extra.stats?.file_bytes ?? null,
      unmatched_names: extra.stats?.unmatched_names?.slice(0, 50) ?? [],
    })
    if (error) console.warn('[import] telemetry insert failed:', error.message)
  } catch (e) {
    console.warn('[import] telemetry insert failed:', e)
  }
}
