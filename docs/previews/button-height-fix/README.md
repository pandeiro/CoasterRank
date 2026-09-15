# Button height alignment previews
Captured 2026-09-15 against the PR build at localhost:5201 (worktree app).

## What's shown
| File | Shows |
| --- | --- |
| `filterbar-desktop.png` | Board toolbar: search + Track/Status segmenteds + Filters button share one row height |
| `filterbar-mobile.png` | Same toolbar on mobile: icon-only Filters button edge-aligned with the search input |
| `my-coasters-desktop.png` | `/me` sticky row: search + Import list button at equal height |
| `my-coasters-mobile.png` | Same row on mobile: icon-only Import button edge-aligned with the search input |

## How the state was faked
Tier 2 (fake session + `mockSupabase`): board ranking rows, park list, and the
`public_board_meta` RPC are local fixtures (zero prod contact); `/me` uses a
fake confirmed session with `profiles` + empty `user_rides` fixtures and the
`share_nudge_eligibility` RPC mocked ineligible. The `/me` captures pass
through anon reads of the public catalog (`v_coaster_rankings`, `parks`,
`public_board_meta`) for the layout. No console/page errors during capture.
Alignment additionally verified by measured bounding boxes: input vs. button
`deltaTop`/`deltaHeight` = 0 on all four viewport/page combinations.
