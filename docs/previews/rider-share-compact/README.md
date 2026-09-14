# Rider share compact-hero previews

Captured 2026-09-14 against the PR build at localhost:5199.

## What's shown

| File                     | Shows                                                                                                                                                                 |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rider-page-desktop.png` | Full share page, desktop: hero with identity left + three-line stats stack right (12 rides at 8 parks, Top park, ♥ Likes builder), 12-row list, logged-out signup CTA |
| `rider-page-mobile.png`  | Same page, mobile 390px: stats stack below the identity under a hairline rule                                                                                         |

## How the state was faked

Tier 2 (no session + `mockSupabase`): only the `public_rider_page` RPC is
mocked with a 12-ride / 8-park fixture (top park Cedar Point ×4; top builder
Bolliger & Mabillard via the preference score-tiebreak over Intamin).
Prod contact: none (`prodReads: []`). Capture is console-error clean.
