# Share nudge preview

Screenshots for the idle-settled share nudge (PLAN §2 "Share nudge v2"), captured
2026-09-08 against the PR build at `localhost:5173`.

## What's shown

| File | Shows |
| --- | --- |
| `share-nudge-states-desktop.png` | The banner's states, desktop: furled (three columns — "Want to share your board?" / condensed share-page skeleton / YES + NOT RIGHT NOW), then YES unfurled three ways — the rider link (copy + preview), enable-sharing instructions, claim-username instructions. One light accent-blue card; the three columns sit in a centered max-w-5xl cluster with even ~150px gutters (question / outlined skeleton sub-card / buttons), top-3 rows carrying Racing Sans One ranks (#1 coral). |
| `share-nudge-states-mobile.png` | Same states at 390px — columns stack (question, skeleton, button row, unfurl) full-width. |
| `share-nudge-placement-desktop.png` | The furled banner in context on `/me`, below the header row (Import list stays top-right). |
| `share-nudge-placement-mobile.png` | Same placement at 390px — the banner sits above the full-width Import list button, keeping Import adjacent to the search bar and ranking table. |

## How they were captured

The banner states come from a temporary preview harness (same pattern as the
signup-welcome-flow previews): stub identity props rendered through the real
component, harness removed after capture. The placement shots drive the real
`/me` page in Playwright with a synthetic localStorage session and every Supabase
read intercepted locally (rides, profile, `share_nudge_eligibility` RPC) — no
production data was read or written. The RPC route is mocked because the
migration only exists on this branch; CI applies it on merge.
