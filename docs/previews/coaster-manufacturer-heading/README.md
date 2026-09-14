# Coaster manufacturer heading previews
Captured 2026-09-14 against the PR build at localhost:5199.

## What's shown
| File | Shows |
| --- | --- |
| `01-detail-desktop.png` | Coaster detail (desktop): eyebrow is park + place only; `ROCKY MOUNTAIN CONSTRUCTION` heads the specs grid |
| `01-detail-mobile.png` | Same state at the mobile viewport |

## How the state was faked
Tier 2 (fake session + `mockSupabase`): `profiles` + `user_rides` fulfilled
locally, `public_board_meta` RPC stubbed, and the `v_coaster_rankings`
single-row + list queries served a Steel Vengeance fixture inline in
`scripts/src/e2e/scenarios/previews-coaster-manufacturer.ts`. Prod contact: none.
