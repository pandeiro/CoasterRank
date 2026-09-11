# Bleed board + park previews

Captured 2026-09-11 against the PR build at localhost:5199 (viewport shots).

## What's shown

| File                | Shows                                                               |
| ------------------- | ------------------------------------------------------------------- |
| `board-desktop.png` | Board table as a floating card (unchanged)                          |
| `board-mobile.png`  | Board table as an edge-to-edge band — no gutters, radius, or shadow |
| `park-desktop.png`  | Park header + table as floating cards (unchanged)                   |
| `park-mobile.png`   | Park header and table as full-bleed white bands separated by canvas |

## How the state was faked

Tier 2 (no session + `mockSupabase`): three ranking rows at Cedar Point,
park list, and the `public_board_meta` RPC. The park page's single-park query
shares the `/rest/v1/parks` path with the board-data park list, so a
predicate route serves the object fixture for the `slug=eq.` query. Prod
contact: none (`capture clean` on all shots). Scenario:
`scripts/src/e2e/scenarios/previews-bleed-board-park.ts`.
