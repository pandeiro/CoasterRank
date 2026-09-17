# Live popunder z-order previews

Captured 2026-09-17 against the PR build at localhost:5199 (worktree dev server).

## What's shown

| File                                | Shows                                                                          |
| ----------------------------------- | ------------------------------------------------------------------------------ |
| `01-live-popunder-open-mobile.png`  | Live popunder pinned open: renders fully above the bleed sticky filter bar     |
| `01-live-popunder-open-desktop.png` | Same on desktop: popunder open over the static toolbar — unchanged             |

## The regression

PR #231 made the homepage filter bar a full-bleed band (`Panel bleed`) inside a
mobile sticky wrapper at `z-20` — tying the hero's `LiveStatusPopunder` (also
`z-20`, earlier in the DOM). Later in the DOM wins ties, so the filter bar
painted over the popup and the live stats hid behind it on mobile (desktop was
unaffected: the wrapper is `sm:static sm:z-auto`). The fix drops the wrapper to
`z-10` — still above the scrolling table, below the popunder and the `z-30`
site header.

## How the state was faked

Tier 2 (no session + `mockSupabase`): board catalog fully mocked (3 fixture
rows), `public_board_meta` RPC mocked; prod contact: none (`prodReads()` empty
on every shot). Popunder pinned via the `Live` button. Each shot additionally
asserts paint order in-page (`elementFromPoint` at the popup's top/middle/
bottom thirds resolves inside the popunder) and fails the run otherwise.
Scenario: `scripts/src/e2e/scenarios/previews-live-popunder-z.ts`.
