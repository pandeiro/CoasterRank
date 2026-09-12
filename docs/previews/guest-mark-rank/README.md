# Guest mark & rank previews

Captured 2026-09-11 against the PR build at localhost:5199.

## What's shown

| File | Shows |
| --- | --- |
| `01-mark-mode-desktop.png` | Board in Mark Mode (logged out): "Step 1 of 2" guidance banner above the filters, two rows marked (checkbox + checkmark + accent tint), floating dock with the live counter `Rank My Rides (2)` and Clear. Header CTA is now "Rank My Rides". |
| `01-mark-mode-mobile.png` | Same state on mobile: 54px touch targets, dock above the safe area. |
| `02-rank-workbench-desktop.png` | `/rank` with a seeded 3-coaster guest list: "Unsaved Guest Ranking" banner, the same sortable cards as `/me`, sticky "+ Add More Coasters" / "Save Ranking & Join Board" footer. |
| `02-rank-workbench-mobile.png` | Same on mobile with the "Hold and drag a row to reorder" hint. |
| `03-merge-modal-desktop.png` | Login interception (§4.4): a returning user with a local guest list signing into an account that already has 1 ranked ride gets the merge modal — "Add 2 to the bottom of my account" (complete merged ladder) or "Discard". No replace option exists. |
| `03-merge-modal-mobile.png` | Same modal on mobile. |

## How the state was faked

State tier 2 (no real session + `mockSupabase()`), zero prod writes:

- **01/02**: logged out; board data (`v_coaster_rankings`, `parks`,
  `manufacturers`) and `public_board_meta` are fixtures; mark mode entered by
  clicking the header CTA and two checkboxes (real UI flow, no storage
  seeding). `02` seeds `cr.guest-rides.v1` in localStorage with three fixture
  coasters before navigating to `/rank`.
- **03**: fake session (`preview@coasterrank.dev`, mock JWT in localStorage)
  with `user_rides` mocked to one ranked row and `profiles`/`coasters`
  fixtureed; guest store seeded with two coasters → the LoginPage gate triages
  to the conflict modal.
- Prod contact: none — `prodReads()` printed `[]` for every capture.
