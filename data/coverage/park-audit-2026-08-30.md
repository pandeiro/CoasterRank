# Top-40 Park Audit — 2026-08-30

Audit of the 40 highest-profile enthusiast parks (list curated by park owner) for **coaster
coverage completeness** and **status accuracy**, using Coasterpedia park pages (CC BY-SA) as
the primary source, cross-checked with Wikipedia/official sites/press where statuses were
suspect. Ran via throwaway tooling (fetch → parse → normkey-diff vs DB → verdict); raw page
cache and scripts were ephemeral per the throwaway-tooling policy. This document is the
retained audit trail.

## Result: 38 / 40 LGTM

The 2 remaining NEEDS_WORK verdicts are **intentional divergences** — our data is fresher
than Coasterpedia's (both news-verified):

| Park | Divergence | Our status | Coasterpedia | Evidence |
| --- | --- | --- | --- | --- |
| Six Flags Great Adventure | El Toro | `sbno` (operated through the 2025 season — Golden Ticket 2025 rank #3 — but no longer listed on the park website as of Aug 2026; no removal announcement found, fate unknown) | `operating` (stale) | Wikipedia/GTA 2025 + park-website omission (owner-observed) |
| Europa-Park | Euro-Mir | `defunct` (closing announced 2025, demolition underway) | `operating` (stale) | Blooloop attraction-closures-2025 roundup |

Note: El Toro's status history is genuinely tangled (2021 derailment closure → 2022
"structurally compromised" closure → reopened June 2023 → operated through 2025 → absent
from the park website in 2026). `sbno` is deliberately chosen over `defunct` because no
removal has been announced.

## What the audit found and fixed (this session)

- **110 missing coasters inserted** across 31 parks, with researched manufacturer, opening
  date, and stats (height/speed/length/inversions) from per-coaster Coasterpedia pages
  (103 rows stats-backfilled from cached pages; 6 had no enrichable fields; 1 inserted from
  press sources — Peter Rabbit Coaster, Nagashima Spa Land)
- **5 parks created**: Universal Studios Beijing, Legoland California, Legoland Florida,
  Legoland Malaysia, Six Flags Great Escape
- **16 status mismatches fixed** (Coasterpedia `operating` vs our `unknown`/`sbno`/`defunct`)
  — including 2 that were our own errors, re-corrected from news: Euro-Mir (defunct), El
  Toro (sbno)
- **Freshness fixes from the same-day news sweep** (Blooloop 2025 closures roundup + brave):
  Superman: Escape from Krypton (closed Mar 2025), Hollywood Rip Ride Rockit (closed 2025),
  Nighthawk (removed 2025), Euro-Mir, Dragon Mountain (Marineland closed), **all 7 Six Flags
  America coasters → defunct (entire park permanently closed Nov 2, 2025)**
- **Known gaps closed earlier the same day**: Epic Universe park + 4 coasters; Disney parks
  (5 missing coasters, Paris Space Mountain 3→1, statuses); 6 operating orphans re-homed
  (Ferrari World, La Ronde, PortAventura, Phantasialand, Happy Valley Wuhan, standalone SMAC);
  Hagrid's verified present (earlier "missing" claim was wrong)
- **Modeling convention documented** (PLAN.md §2): one row per physical track; two rows for
  structural RMC-style transformations (historic row → `defunct`); statuses require
  freshness checks against news, not just DB consistency

## Per-park verdicts

LGTM (38): Cedar Point, Six Flags Magic Mountain, Kings Island, Carowinds, Kings Dominion,
Six Flags Great America, Hersheypark, Six Flags Over Texas, Six Flags New England,
Energylandia, Europa-Park*, Universal's Islands of Adventure, Phantasialand, Busch Gardens
Tampa Bay, Alton Towers, Fuji-Q Highland, Ferrari World Abu Dhabi, Nagashima Spa Land,
Holiday World, Dollywood, Knoebels, Silver Dollar City, Six Flags Fiesta Texas, PortAventura
Park, Canada's Wonderland, Busch Gardens Williamsburg, Parque Warner Madrid, Parc Astérix,
Hansa-Park, Walibi Holland, Liseberg, Kolmården, Linnanmäki, Fårup Sommerland, Plopsaland De
Panne, Fun Spot America Atlanta, Holiday Park, Thorpe Park, Everland.

NEEDS_WORK (2): Six Flags Great Adventure + Europa-Park — accepted divergences, table above.

*Europa-Park is also the one park where a coaster was closed (Euro-Mir) mid-audit — its
`defunct` row is the fresh data.

## Remaining known residue (deliberate, launch-safe)

- Other-bucket long tail: 64 `unknown` + 18 `defunct` rows (invisible on the operating board)
- The Bat generational pair at Kings Island (intentional two-row modeling) and 2 unattributed
  RC Racer CSV rows in Other
- ~150 `unknown`-status rows at small parks outside the top-40
- 79 list-mismatch verdicts (VoteCoasters/Golden Ticket vs DB naming disputes) from the
  original coverage sweep

## Method note

Coasterpedia park pages parse into Operating/Defunct/Upcoming coaster lists (heading-taxonomy
handled: Operating/Present/Defunct/Past/Removed/Upcoming/Roller coasters × Present/Past,
"Standing but not operating", h2-Coasters variants). Status accuracy beyond Coasterpedia
required news sweeps — the CSV's statuses are a 2023 snapshot and decay silently (the
Superman: Escape from Krypton lesson).
