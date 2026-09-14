# Rider share compact-hero previews

Captured 2026-09-14 against the PR build at localhost:5199 (recaptured after
the Lucide-icon revision).

## What's shown

| File                     | Shows                                                                                                                                                                                                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rider-page-desktop.png` | Full share page, desktop: bare hero (no card, no eyebrow, 90px avatar) + four-line stats stack with Lucide glyphs in brand tokens (coral coaster, accent map/pin, coral heart — "B&M fan"), 12-row list, accent-tinted two-column CTA with the Rank My Rides button right |
| `rider-page-mobile.png`  | Same page, mobile 390px: stats stack below the identity under a hairline rule, CTA stacks with the button below the copy                                                                                                                                                  |

## How the state was faked

Tier 2 (no session + `mockSupabase`): only the `public_rider_page` RPC is
mocked with a 12-ride / 8-park fixture (top park Cedar Point ×4; top builder
Bolliger & Mabillard via the preference score-tiebreak over Intamin, shown
abbreviated as "B&M fan · 4 coasters").
Prod contact: none (`prodReads: []`). Capture is console-error clean. Stat
glyphs are Lucide SVGs, so the previews show the true brand colors (no
emoji-font dependency).
