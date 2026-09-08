# Share nudge preview

Screenshots for the idle-settled share nudge (PLAN §2 "Share nudge v2"), captured
2026-09-08 against the PR build at `localhost:5173`.

## What's shown

| File | Shows |
| --- | --- |
| `share-nudge-states-desktop.png` | The banner's three states, desktop: live (copy + preview), claimed-but-not-sharing (turn-on CTA), no username (claim CTA). |
| `share-nudge-states-mobile.png` | Same three states at 390px — the preview block wraps vertically. |
| `share-nudge-placement-desktop.png` | The live banner in context on `/me`, between the page header and the sticky search bar. |
| `share-nudge-placement-mobile.png` | Same placement at 390px (viewport crop). |

## How they were captured

The banner states come from a temporary preview harness (same pattern as the
signup-welcome-flow previews): stub identity props rendered through the real
component, harness removed after capture. The placement shots drive the real
`/me` page in Playwright with a synthetic localStorage session and every Supabase
read intercepted locally (rides, profile, `share_nudge_eligibility` RPC) — no
production data was read or written. The RPC route is mocked because the
migration only exists on this branch; CI applies it on merge.
