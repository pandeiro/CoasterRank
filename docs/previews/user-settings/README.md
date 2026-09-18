# User settings previews

Captured 2026-09-17 against the PR build (worktree dev server).

## What's shown

| File                                                             | Shows                                                                                                       |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `settings-desktop.png` / `settings-mobile.png`                   | `/settings` defaults: Metric + System (light on the capture OS), live stat preview in metric                |
| `settings-dark-desktop.png` / `settings-dark-mobile.png`         | Same page with dark mode forced — ink-navy surfaces, selected-card tint                                     |
| `settings-imperial-desktop.png` / `settings-imperial-mobile.png` | Imperial units selected — preview line converts (200 ft · 74 mph)                                           |
| `coaster-imperial-desktop.png` / `coaster-imperial-mobile.png`   | `/coasters/steel-vengeance` with imperial units: 200 ft · 74 mph · 3,760 ft; footer gains the Settings link |

## How the state was faked

Tier 1 for `/settings` (no session, no Supabase — static page; theme/units seeded via a `cr.settings.v1` localStorage init script). Tier 2 logged-out for the coaster page: the `v_coaster_rankings` row (Steel Vengeance fixture) and the `public_board_meta` RPC are Playwright fixtures; `prodReads()` was empty on both viewports. No design.html shot — the Dark mode section is taller than the viewport and the harness clips viewport-relative; review it at `/design.html` locally.
