# Sticky filter bar previews

Captured 2026-09-17 against the PR build at localhost:5202 (worktree dev server).

## What's shown

| File                                | Shows                                                                             |
| ----------------------------------- | --------------------------------------------------------------------------------- |
| `01-board-scrolled-mobile.png`      | Board scrolled 800px: filter bar pinned directly under the site header            |
| `01-board-scrolled-desktop.png`     | Same scroll on desktop: toolbar stays static (scrolled out of view) — unchanged   |
| `02-mark-mode-scrolled-mobile.png`  | Guest Mark Mode scrolled: banner scrolled away, filter bar stuck, checkboxes live |
| `02-mark-mode-scrolled-desktop.png` | Same on desktop: static toolbar, dock pill bottom-center — unchanged              |

## How the state was faked

Tier 2 (no session + `mockSupabase`): board catalog fully mocked (40 fixture rows so
the page scrolls), `public_board_meta` RPC mocked; prod contact: none
(`prodReads()` empty on every shot). Mark Mode entered via the header CTA with two
checkboxes marked. Shots are scrolled viewport captures (the harness `settle()`
scrolls back to top, which would un-stick the bar).

The bottom dock pill is cropped out of the mobile viewport shots by the emulator
(mobile `innerHeight` ~900px runs taller than the 844px capture), not by the change:
asserted in-page that the pill is mounted, opaque, untransformed, bottom-anchored,
and labeled `Rank My Rides (2)` after scrolling — plus it renders visibly in the
desktop shot. Scenario: `scripts/src/e2e/scenarios/previews-sticky-filter.ts`.
