# Rider heading-clip previews

Captured 2026-09-14 against the PR build at localhost:5199.

## What's shown

| File                  | Shows                                                                                           |
| --------------------- | ----------------------------------------------------------------------------------------------- |
| `heading-desktop.png` | Display name with a lowercase leading "p", clipped to the `h1` — the glyph clears the left edge |
| `heading-mobile.png`  | Same, mobile 390px                                                                              |

## How the state was faked

Tier 2 (no session + `mockSupabase`): only the `public_rider_page` RPC is
mocked, with a two-ride fixture and a lowercase-leading display name
(`preview rider`) to exercise the glyph edge.
Prod contact: none (`prodReads: []`). Capture is console-error clean.
