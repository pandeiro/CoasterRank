# Country card bleed previews

Captured 2026-09-16 against the PR build at localhost:5201.

## What's shown

| File                    | Shows                                                                                                    |
| ----------------------- | -------------------------------------------------------------------------------------------------------- |
| `countries-desktop.png` | /countries at desktop: floating two-column cards (bleed restores at sm+, unchanged)                      |
| `countries-mobile.png`  | /countries at mobile 390px: each country card bleeds edge-to-edge like the homepage board, no x-overflow |

## How the state was faked

Tier 2 (no session + `mockSupabase`): 13-ride / 4-country fixture (US six-ride
bench with the top-five cap in effect, Japan, ghost-padded Germany, single-ride
France) plus the `public_board_meta` RPC; long coaster/park/maker names are
deliberate — they are what blew the implicit grid track ~40px past the mobile
viewport before the fix. Prod contact: none (`prodReads: []`). The mobile
capture asserts `assertNoHorizontalOverflow`. Capture is console-error clean.
