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
export type RankingBoardPayload = {
  rankings: RankingRow[]
  parks: Park[]
  generated_at: string
}
