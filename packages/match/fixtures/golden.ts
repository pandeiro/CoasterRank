// Golden import-matching cases, calibrated against fixtures/catalog.json — a
// frozen export of the real production catalog (1,228 coasters, 2026-09).
//
// Each case asserts the exact tier outcome the engine must produce, so any
// future threshold/scoring change that degrades real-world matching fails CI
// here instead of silently in prod. The comments record WHY each expectation
// is correct (which catalog duplicates/aliases/renames are in play).
//
// When the catalog fixture is regenerated, re-run these cases and re-freeze
// any legitimately changed outcome — do not relax expectations to make the
// suite pass.

import type { MatchReason, MatchStatus } from '../src/match'

export type GoldenCase = {
  name: string
  park?: string
  status: MatchStatus
  reason?: MatchReason
  /** Required id of the auto match (status === 'auto'). */
  id?: string
  /** Ids that must appear among the candidates (any order). */
  candidateIds?: string[]
  /** Exact candidate count assertion (for tie cases). */
  candidateCount?: number
}

export const GOLDEN_CASES: GoldenCase[] = [
  // ── Exact tier ──────────────────────────────────────────────────────────
  { name: 'Fury 325', status: 'auto', reason: 'exact', id: '49e1505d-afac-404b-8866-d87cf17ade1a' },
  // Normalization: case, trailing punctuation, whitespace runs.
  { name: 'fury 325!', status: 'auto', reason: 'exact', id: '49e1505d-afac-404b-8866-d87cf17ade1a' },
  { name: 'Kingda Ka', status: 'auto', reason: 'exact', id: 'f7881b93-8462-4456-86f2-ac69fbf4dfb7' },
  { name: 'Twisted Colossus', status: 'auto', reason: 'exact', id: '03d70105-5c59-4dac-b130-a9509d318246' },
  { name: 'X2', status: 'auto', reason: 'exact', id: 'd427052e-1a66-43cd-a5c0-40e2140c14d1' },
  { name: 'Steel Vengeance', status: 'auto', reason: 'exact', id: '7d57149a-7fa2-46cf-a8e5-12e3b5e4078e' },
  { name: 'Iron Gwazi', status: 'auto', reason: 'exact', id: 'e978ddf0-0ca4-436f-9e5b-2b29f1415d42' },
  { name: 'Yankee Cannonball', status: 'auto', reason: 'exact', id: 'b946c50c-5fa3-4fbc-809d-e3650e37d394' },
  { name: 'Dragon Khan', status: 'auto', reason: 'exact', id: '93958353-f6a0-4dbc-8fa5-b20091aedb43' },
  { name: 'Boulder Dash', status: 'auto', reason: 'exact', id: '4d944736-2dfe-4b04-b735-fb88ad989b54' },
  { name: 'Lightning Rod', status: 'auto', reason: 'exact', id: 'e5623640-eba9-4321-bc5a-ed9def81d3ee' },
  { name: 'Mako', status: 'auto', reason: 'exact', id: 'b9cbc416-fb1f-4b58-a158-245dae7a7995' },
  { name: 'Wicked Cyclone', status: 'auto', reason: 'exact', id: 'aaa706b9-5e28-47be-8a78-6b1d11f8a2aa' },
  { name: 'Thunder Striker', status: 'auto', reason: 'exact', id: '725924cb-bd02-4d80-ac0c-8ce84e788318' },
  // Leading article + year disambiguator normalize away.
  { name: 'The Beast', status: 'candidate', candidateIds: ['d9390b00-c00d-4a98-a18e-de1e4e0920aa', 'b4fec923-dc9f-48c4-a1ab-7cc035228104'], candidateCount: 2 },
  { name: 'Voyage', status: 'auto', reason: 'exact', id: '8520fefb-4848-40bc-a47d-e06a701ed16d' },
  { name: 'Velocicoaster', status: 'auto', reason: 'exact', id: '6a5a7ba0-3d86-4b20-81a1-66bd8c2a9eab' },

  // ── Same-name clusters: park hint disambiguates, missing hint degrades ──
  // 8 catalog entries named "Batman: The Ride" / "Batman The Ride".
  { name: 'Batman: The Ride', park: 'Six Flags Great America', status: 'auto', reason: 'exact', id: '9df8dccd-3d1c-4923-a903-cff26b239723' },
  { name: 'Batman: The Ride', park: 'Six Flags Great Adventure', status: 'auto', reason: 'exact', id: '8ad5eb31-2255-416f-b100-3e4e35b5a344' },
  // Abbreviated park hints match by containment ("Great Adventure" ⊂ park).
  { name: 'Batman: The Ride', park: 'Great Adventure', status: 'auto', reason: 'exact', id: '8ad5eb31-2255-416f-b100-3e4e35b5a344' },
  { name: 'Batman The Ride', status: 'candidate', candidateIds: ['9df8dccd-3d1c-4923-a903-cff26b239723', '8ad5eb31-2255-416f-b100-3e4e35b5a344'] },
  // 4 catalog copies of Flight of the Hippogriff (Universal parks).
  { name: 'Flight of the Hippogriff', park: 'Universal Studios Japan', status: 'auto', reason: 'exact', id: 'c51de4f4-559a-47ce-bca1-b48535031b48' },
  { name: 'Flight of the Hippogriff', status: 'candidate', candidateCount: 4 },
  // Superman – Ride of Steel: Six Flags America + Darien Lake copies.
  { name: 'Superman: Ride of Steel', park: 'Six Flags America', status: 'auto', reason: 'exact', id: '0cb96832-bc27-49b9-a7bf-0f1db333130b' },
  { name: 'Superman: Ride of Steel', status: 'candidate', candidateIds: ['8aa9a4de-3e83-4ece-94bc-d7f092c62ef2', '0cb96832-bc27-49b9-a7bf-0f1db333130b'] },
  // El Toro ×2 (Six Flags Great Adventure + Freizeitpark Plohn); the broad
  // "Six Flags" hint strictly agrees with exactly one of them.
  { name: 'El Toro', status: 'candidate', candidateIds: ['0ad20d26-e46b-4dbb-a223-63352fa98898', 'cc5b93eb-d084-4f9b-a6fe-d0e85e0646c3'] },
  { name: 'El Toro', park: 'Six Flags', status: 'auto', reason: 'exact', id: 'cc5b93eb-d084-4f9b-a6fe-d0e85e0646c3' },
  // 6 Big Dippers (Camden, Battersea, Blackpool, Geauga Lake, and two at Luna
  // Park Sydney) — the 5-cap shows the alphabetically-first plain names;
  // without a park hint the Sydney pair is only reachable via manual search.
  { name: 'Big Dipper', status: 'candidate', candidateIds: ['e084cb12-48cd-448e-849a-4c7f20ba8293', 'a1ab82cb-205c-4fcd-801f-d99a2bc93a3d', '8b5b16f3-2dba-49c7-8842-6f384f71f262', '503948f1-18c1-4872-b7dc-026a45179c9e'], candidateCount: 5 },
  // With the Sydney park hint, both Sydney entries (plain + "(1935)") lead
  // the candidates — pinned to the park but genuinely a pair.
  { name: 'Big Dipper', park: 'Luna Park Sydney', status: 'candidate', candidateIds: ['e67c1e3f-bdc3-4cfa-8006-0a42ba10161e', '7b436495-24fa-40f5-878d-605109d62559'] },
  // A park name typed as a coaster row: nearest coasters are candidates, no auto.
  { name: 'Kentucky Kingdom', status: 'candidate', candidateIds: ['9cd32380-b1d0-46ed-9a7f-23dc5eb2ac29', '5a644f67-d180-4034-aa10-277f83efc765'] },

  // ── Alias tier (renamed/regional names) ─────────────────────────────────
  { name: 'Intimidator 305', status: 'auto', reason: 'alias', id: 'b9b62e2e-44cc-4fd4-a52c-027587775a33' },
  { name: 'I305', status: 'auto', reason: 'alias', id: 'b9b62e2e-44cc-4fd4-a52c-027587775a33' },
  { name: 'Top Thrill Dragster', status: 'auto', reason: 'alias', id: 'b5375b75-2bef-4346-9572-c3cf9a396772' },
  { name: "Montezooma's Revenge", status: 'auto', reason: 'alias', id: 'a2915e1b-4d22-4804-8c6f-b8af70a6a825' },
  { name: 'Space Mountain: Mission 2', status: 'auto', reason: 'alias', id: '09eb9084-820f-477a-8c28-3bd64596b3d4' },
  { name: 'Intimidator', status: 'auto', reason: 'alias', id: '725924cb-bd02-4d80-ac0c-8ce84e788318' },
  // "The Beastie" is an alias at Kings Island, but Alton Towers' "Beastie" and
  // Eastern Creek's "The Beastie" are real rows — without a park it's a tie.
  { name: 'The Beastie', status: 'candidate', candidateIds: ['7d07e0e0-76c3-4810-8d79-3959cbc01a96', '081795df-e77e-4422-adc0-0d6b9602b76a'] },

  // ── Fuzzy tier ──────────────────────────────────────────────────────────
  { name: 'Furry 325', status: 'auto', reason: 'fuzzy', id: '49e1505d-afac-404b-8866-d87cf17ade1a' },
  { name: 'Fury 352', status: 'auto', reason: 'fuzzy', id: '49e1505d-afac-404b-8866-d87cf17ade1a' },
  { name: 'Steel Vengance', status: 'auto', reason: 'fuzzy', id: '7d57149a-7fa2-46cf-a8e5-12e3b5e4078e' },
  { name: 'Batman: The Rid', status: 'candidate', candidateIds: ['9df8dccd-3d1c-4923-a903-cff26b239723', '8ad5eb31-2255-416f-b100-3e4e35b5a344'] },

  // Token-subset renames pure JW misses ("Gwazi" → Iron Gwazi after its 2022
  // refurb; the marketing prefix dropped). The reverse direction ("Jurassic
  // World VelociCoaster" ⊇ "VelociCoaster") is deliberately NOT matched: the
  // entry⊆query rule would auto-match sentence-like rows onto generic single-
  // token entries ("Not A Real Coaster 123" → "Coaster"), and pure JW scores
  // the pair ~0.59. Known miss, healed by a manual search pick or an admin
  // alias row — the intended import-telemetry iteration loop.
  { name: 'Gwazi', status: 'auto', reason: 'fuzzy', id: 'e978ddf0-0ca4-436f-9e5b-2b29f1415d42' },
  { name: 'Jurassic World VelociCoaster', status: 'none' },

  // ── Misses ──────────────────────────────────────────────────────────────
  { name: 'Not A Real Coaster 123', status: 'none' },
  { name: '', status: 'none' },
  { name: ' !!! ', status: 'none' },
]
