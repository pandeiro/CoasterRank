# Rider table-bleed previews

Captured 2026-09-14 against the PR build at localhost:5199.

## What's shown

| File                     | Shows                                                                            |
| ------------------------ | -------------------------------------------------------------------------------- |
| `rider-page-desktop.png` | Full share page, desktop: ranked list as a floating card (bleed restores at sm+) |
| `rider-page-mobile.png`  | Same page, mobile 390px: ranked list bleeds edge-to-edge like the homepage board |

## How the state was faked

Tier 2 (no session + `mockSupabase`): captured with the committed
`previews-rider-share-compact` scenario (only the `public_rider_page` RPC
mocked, 12-ride / 8-park fixture, logged-out share-audience view); the PNGs
are filed under this slug so the tiny PR doesn't touch the existing preview
set. Prod contact: none (`prodReads: []`). Capture is console-error clean.
