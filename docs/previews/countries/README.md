# Countries previews
Captured 2026-09-14 against the PR build at localhost:5199.

> STALE: these PNGs predate ghost padding — they show unpadded averages
> (Germany #1 at 4.0) and short-bench badges, both gone now. Re-run
> `scripts/src/e2e/scenarios/previews-countries.ts` to refresh (current
> math: US #1 at 4.6, Japan #2 at 9.8, Germany #3 at 10.0, France #4 at 13.8).

## What's shown
| File | Shows |
| --- | --- |
| `board-status-desktop.png` | Board hero clip: the status line with the linked "4 countries" entry point |
| `board-status-mobile.png` | Same hero clip at the mobile viewport (centered lockup, wrapped status line) |
| `countries-desktop.png` | Full /countries page: Germany #1 (avg 4.0, short bench), US #2 (avg 4.6, full six-ride bench capped at five, B&M top builder), Japan #3 (avg 8.8), France #4 (single ranked ride) |
| `countries-mobile.png` | Same page stacked single-column at the mobile viewport |

## How the state was faked
Tier 2 (fake sessionless + `mockSupabase`, zero prod contact): 13 ranking rows
across 4 countries plus the park list and `public_board_meta` RPC are fixtures
in `scripts/src/e2e/scenarios/previews-countries.ts`. The dev-server
`/api/ranking` fetch misses, so the app falls back to the mocked Supabase path.
Capture was clean (no console/page errors).
