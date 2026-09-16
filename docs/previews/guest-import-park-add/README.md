# Guest import + park bulk-add previews

Captured 2026-09-16 against the PR build at localhost:5199.

## What's shown

| File                                            | Shows                                                                                                                                                                                                                                                              |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `01-rank-empty-import-{desktop,mobile}.png`     | `/rank` empty state: explainer plus `Rank My Rides` and a first-class `Import a spreadsheet` CTA — "CSV or paste it in — no account needed" (import is no longer a signup incentive).                                                                              |
| `02-rank-workbench-search-{desktop,mobile}.png` | The `/rank` workbench with a seeded 3-coaster guest list: the new `CoasterSearchBar` above the cards, the banner's import line, and the footer's `Import list` button beside `+ Add More Coasters`.                                                                |
| `03-guest-import-review-{desktop,mobile}.png`   | Guest import review (empty list): 2 matched + 1 not found, the append-only review — no Merge fieldset — with `Import 2 coasters`.                                                                                                                                  |
| `04-import-cap-note-{desktop,mobile}.png`       | Over-cap review: 149 seeded rides + a 2-row paste relabels the button to `Import first 1 of 2 coasters` with the anti-spam note ("Guest lists hold up to 150 coasters (an anti-spam limit)… Sign up free to import all 2 — imported lists can hold up to 2,000."). |
| `05-park-picker-board-{desktop,mobile}.png`     | Park bulk-add picker in board Mark Mode (`Add from a park` in the banner): park search, Cedar Point expanded to its per-coaster checklist (operating rows default-checked, board ranks shown), `Add 3 coasters`.                                                   |
| `06-me-park-button-{desktop,mobile}.png`        | `/me` sticky bar: the new `Add from park` button beside `Import list` (icon-only on mobile).                                                                                                                                                                       |

## How the state was faked

State tier 2: guest shots run logged-out with the guest store seeded via
`cr.guest-rides.v1` in localStorage (init script); the `/me` shot uses a fake
session with mocked `profiles`/`user_rides` (full coaster embeds) and the
share-nudge RPC stubbed. The board catalog comes from mocked
`v_coaster_rankings`/`parks` fixtures (5 rows across Cedar Point + Carowinds).
No real session, no writes; prod contact: none (all reads mocked).
Scenario: `scripts/src/e2e/scenarios/previews-guest-import-park-add.ts`.
