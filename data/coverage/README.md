# Data-Readiness Coverage

The working directory for the read-only data-quality sweep. **Nothing here mutates the
database** — the sweep (SELECT-only) produces analysis artifacts; a separate, not-yet-built
applier would consume your marked decisions.

## Tracked inputs (hand-edited)

| File | Purpose |
| --- | --- |
| `park-aliases.json` | Park-name aliases for the coverage matcher (e.g. list name → DB name) |
| `queue-overrides.json` | Overrides for the legacy (Aug 2026) triage queue |
| `enrichment.json` | Agent-researched, **cited** context merged into review-doc items |
| `notables.json` | 2025–26 notable-coaster candidates checked against the DB by the sweep |

## Tracked outputs (the review record)

| File | Purpose |
| --- | --- |
| `sweep-YYYY-MM-DD.md` | **The review doc**: baseline + punchlist (orphans / dups / park dups / missing / notables), each item with evidence, recommendation, confidence and a decision checkbox |
| `decisions.json` | Machine-readable decision mirror for the future applier — mark `decided: true` per item |
| `queue-notes.md` | Notes from the Aug 2026 coverage effort |

## Gitignored artifacts (regenerable)

`sweep.json` (full detail), plus legacy: `report.txt`, `queue.json`, `queue-summary.md`,
`master-triage.md`, `top_coasters.txt`.

## Commands (from `scripts/`)

```bash
npm run coverage:sweep        # read-only analysis → sweep.json + decisions.json
npm run coverage:doc          # render sweep-YYYY-MM-DD.md (merges enrichment.json)
npm run coverage:apply        # dry-run the applier against live data (read-only)
npm run coverage:apply -- --apply --yes   # EXECUTE decided items (single transaction)
npm run coverage:apply -- --decisions <path> [--apply --yes]  # alternate decisions file
npm run coverage:apply-test   # docker scratch-DB integration test (real write path, no prod contact)
npm test                      # classifier + plan-builder unit tests
```

## Applier

`buildPlan()` (pure, unit-tested) validates every `decided: true` item against the live
snapshot — stale rows, name drift, slug collisions and missing parks are caught before any
SQL exists — and emits ordered ops: park merges → park creates → re-homes → coaster merges
→ creations. Park references in SQL are slug-based subselects so plan-created parks resolve
at execute time. `executePlan()` runs everything in ONE transaction and asserts affected-row
counts per statement; any mismatch rolls back everything. Merge semantics: rides remap with
`ON CONFLICT DO NOTHING` (conflicts keep the existing ride), loser ratings deleted, loser
names become aliases. Gitignored `apply-log-<date>.md` records what ran.

## How duplicates are classified (summary)

- **Clone instances** (same model/name at different real parks) — legit, no action.
- **Orphans** (in the `Other (unknown location)` bucket) — the original CSV park name is
  often recoverable from the pre-normalization slug kept in `coasters.external_id`
  (e.g. `flashback-six-flags-magic-mountain@other`); the sweep re-homes those
  deterministically and flags the rest for review (CSV cross-ref, then cited context).
- **Same-ride duplicates** — same base slug + no model divergence + only 2 rows → merge.
  **3+ rows with one name is treated as suspected sister-park conflation and is never
  auto-merged** (the Journey-to-Atlantis trap).
- **Park duplicates** — normalized-name equality or ≥0.84 trigram similarity.

## Apply order (future applier, only after your sign-off)

1. Park merges → 2. orphan re-homes (incl. create-park) → 3. coaster merges (remap
`user_rides` — zero rows today) → 4. missing-coaster creations → 5. alias backfill →
6. recompute + fresh baseline.
