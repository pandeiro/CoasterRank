// Shared board payload types — imported by BOTH the React app (lib/coasters.ts)
// and the Cloudflare worker (src/worker.ts), so the `/api/ranking` contract
// cannot drift between the two. Keep this module dependency-free: types only,
// no runtime imports — safe for the worker bundle (type imports are erased).

export type CoasterStatus =
  'operating' | 'defunct' | 'sbno' | 'under_construction' | 'relocated' | 'unknown'

export type CoasterMaterial = 'steel' | 'wood' | 'hybrid' | 'other'

// A row of v_coaster_rankings: the coaster plus BT metrics and its live rank.
// Park/manufacturer display fields and aliases are denormalized onto the row
// by the view so the board can filter and search without reference lookups.
export type RankingRow = {
  id: string
  park_id: string
  name: string
  slug: string
  manufacturer_id: string | null
  model: string | null
  opening_date: string | null
  status: CoasterStatus
  material: CoasterMaterial
  height_m: number | null
  speed_kmh: number | null
  length_m: number | null
  inversions: number | null
  type: string | null
  park_name: string | null
  park_slug: string | null
  park_country: string | null
  park_city: string | null
  manufacturer_name: string | null
  aliases: string[] | null
  score: number | null
  comparisons: number | null
  participants: number | null
  first_place_votes: number | null
  rank: number | null
  // The coaster's final rank in the PREVIOUS ISO week (UTC), from
  // rank_weekly_snapshots (joined in the view). NULL when the coaster wasn't
  // ranked at the end of last week — new to the board, or the feature's
  // first week. Feeds the persistent "↑2 this week" badge.
  rank_last_week: number | null
}

export type Park = {
  id: string
  name: string
  slug: string
  country: string | null
  region: string | null
  city: string | null
}

// The `/api/ranking` response: the full board dataset in one payload —
// rankings for the board/detail pages plus the parks list that powers the
// search bar and the submit flow, so those pages skip Supabase entirely.
// generated_at is the edge-cache fill time; last_recomputed_at the pg_cron
// success time. ranked_user_count is the cached first-place gate count.
export type RankingBoardPayload = {
  rankings: RankingRow[]
  parks: Park[]
  generated_at: string
  // When the ranking was last recomputed by the pg_cron job (latest successful
  // cron_execution_logs entry) — the honest "Last ranked" timestamp. Null when
  // the board_meta RPC is unavailable (deploy-order skew); the UI falls back
  // to generated_at, which is the edge-cache fill time.
  last_recomputed_at: string | null
  // Real (non-admin, non-synthetic) user count for the status line. Null when
  // the board_meta RPC is unavailable.
  real_user_count: number | null
  // Real ranked users (distinct users with at least one ranked ride), same
  // admin/synthetic exclusions as real_user_count. Drives the first-place
  // visibility gate (>30). Served via the same edge-cached /api/ranking
  // payload so the board needs no extra RPC. Null when the RPC is unavailable.
  ranked_user_count: number | null
}
