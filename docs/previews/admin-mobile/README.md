# Admin mobile polish previews

Captured 2026-09-11 against the PR build at localhost:5199.

## What's shown

| File                            | Shows                                                                                                                                   |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `admin-submissions-desktop.png` | Submission queue on desktop (pill tabs unchanged, note wraps)                                                                           |
| `admin-submissions-mobile.png` | Sticky section dropdown under the topnav; queue panel as an edge-to-edge band (no gutters/radius); single-column stat list with intact numbers; long-URL submitter note wrapping inside the card |
| `admin-users-desktop.png` | Users tab on desktop |
| `admin-users-mobile.png` | 3-column stat blocks; filter + list panels as full-bleed white bands; user rows with a very long email/name fully wrapped; actions wrapped below the user info |
| `admin-sharing-desktop.png`     | Sharing tab on desktop                                                                                                                  |
| `admin-sharing-mobile.png`      | Compact stat grid, funnel table with hints hidden, stacked traffic cards                                                                |

## How the state was faked

Tier 2 (fake admin session + `mockSupabase`): admin profile (`is_admin: true`),
empty board rankings, one park, no manufacturers, two `new` submissions (one
with a long-URL note). The `admin-users` and `admin-sharing-metrics` Edge
Functions are fulfilled by scenario routes with synthetic payloads (long-email
user, funnel + RUM fixtures). Prod contact: none (`capture clean` on all
shots). Scenario: `scripts/src/e2e/scenarios/previews-admin-mobile.ts`.

Note: the closed account sheet is hidden via a style tag for the shots — it
otherwise leaks into fullPage stitches (fixed `translate-y-full` element below
the fold). Not a UI bug.
