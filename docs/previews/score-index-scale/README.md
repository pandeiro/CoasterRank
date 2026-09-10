# previews: score-index-scale

PR: "Score display: site-wide index scale" — the coaster detail page hero now
renders the same ×100 index score as the board (raw BT strength 1.029 →
`102.9`; previously the detail page showed the raw `1.03`).

## What's shown

| File                      | What                                                                                                                                                             |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `detail-hero-desktop.png` | `/coasters/steel-vengeance` Community Ranking panel (clipped to `main`), desktop 1280px — hero score `102.9` next to rank `#3`, movement chip, supporting stats. |
| `detail-hero-mobile.png`  | Same page, mobile 390px.                                                                                                                                         |

## How the state was faked

State tier 2 — fake session + `mockSupabase()`, zero prod reads (verified by
the harness's "capture clean" output):

- `v_coaster_rankings` → single Steel Vengeance fixture row with `score: 1.029`
  (the only score display in the shot; no live DB involved).
- `coaster_aliases`, `user_rides` → empty.
- `profiles` → fake non-admin `preview_rider`.
- `public_board_meta` RPC → recompute timestamp 6 minutes before capture, so
  the freshness marker reads "Updated 6 minutes ago".

Scenario: `scripts/src/e2e/scenarios/previews-score-index.ts` (dev server on
:5199, required in the run comment).
