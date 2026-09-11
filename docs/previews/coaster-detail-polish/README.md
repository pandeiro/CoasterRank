# Coaster Detail polish previews
Captured 2026-09-11 against the PR build at localhost:5199.

## What's shown
| File | Shows |
| --- | --- |
| `01-detail-desktop.png` / `01-detail-mobile.png` | Loaded coaster detail: 8-cell spec grid (Height/Speed/Length/Inversions + Track/Material/Opened/Status), fixed explainer button row |
| `02-explainer-desktop.png` / `02-explainer-mobile.png` | "How is this calculated?" popover open; mobile shows the right-anchored popover fitting the viewport |
| `03-loading-desktop.png` / `03-loading-mobile.png` | Coaster detail loading skeleton (identity + ranking panel + spec grid bars) |
| `04-park-loading-desktop.png` / `04-park-loading-mobile.png` | Park detail loading skeleton (hero panel + table rows) |

## How the state was faked
Tier 2 (fake session + `mockSupabase`): `v_coaster_rankings` single-row (object) + list (array) fixtures, `parks` single + list, `profiles`, `user_rides: []`, and the `public_board_meta` RPC; loading shots delay the single-row response 10s and screenshot inside the window. Prod contact: none (all captures reported clean, no console/page errors).
