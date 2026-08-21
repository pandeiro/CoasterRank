# CoasterRank Data Strategy: Synthesis & Plan

**Status:** Draft for review · **Reconciles:** `INITIAL.md` (engineer's proposal), `COMMENTS.md`, `QUESTIONS_ANSWERED.md` against `CURRENT_SCHEMA.md`

## 0. The core reconciliation

The engineer's proposal (`INITIAL.md`) is a sound long-term architecture: canonical tables + provenance + candidate staging + human review + continuous refresh. Left as written, though, it front-loads infrastructure over an 30/60/90-day arc before the existing 1,087-record catalog gets meaningfully cleaner.

The feedback pulls the other way: get a comprehensive, duplicate-free, launch-ready catalog fast (comment #20: 24–48 hours to 80–90%), prefer ad-hoc manual work over scalable infra for the first pass (comment #21), and defer anything that doesn't move that needle (comments #5, #10, #13, #16, #19).

Both are right, for different problems. The resolution is **two tracks, not one sequence**:

- **Track A (MVP, days not weeks):** fix the data you already have. Minimal schema changes, mostly manual/ad-hoc work, ships before launch.
- **Track B (post-launch, incremental):** the engineer's full architecture, built once Track A proves out what actually needs automating. Fully spec'd below so it's ready to pick up, but explicitly *not* on the launch critical path.

Everything below is organized around that split, with each open question from the comments resolved one way or the other.

---

## 1. Decisions locked in (from Q&A)

| Question | Decision |
|---|---|
| Scope | Anything with a car on rails — includes water/powered/kiddie/wild mouse/alpine/suspended coasters at parks, FECs, fairgrounds, zoos, ski resorts. Announced-but-unbuilt excluded; announced-and-under-construction included. Never delete; demolished = terminal, no further updates needed. |
| Relocation/rename | One record, current status only — no dual-record lineage tracking needed for v1. Aliases are nice-to-have, not required. |
| Freshness | Shorter than 12-month cadence preferred, specifically to catch the under_construction→operating transition. Top-tier parks reviewed on the *same* cadence regardless of geography (no relaxed schedule for international parks). |
| Auto-update confidence | One official source is sufficient to auto-mark `operating`. One official source or one admin confirmation is enough for status changes generally — two-source corroboration is not a hard requirement. Merges/deletions still require human approval. |
| RCDB | No scraping, no bulk extraction, no copying structured data, no RCDB pages as extraction input. RCDB mirrors (e.g. `fabianrguez/rcdb-api`) are usable **only** as an existence lead — every lead still needs independent verification before it enters the database. RCDB links *to* the app are fine as user-facing metadata. |
| Evidence retention | Store URLs/snippets; raw HTML/PDF snapshot retention is cost-gated and undecided (see §5). |
| Review capacity | ~50/day, not 500/day. This caps how many candidates Track B's discovery campaigns should be allowed to queue up at once (see §3.4). |
| Success metric | Qualitative completeness ("no famous coasters missing or duplicated") and duplicate rate. Verification %, field-completeness %, and raw coaster count are explicitly *not* target metrics. |

---

## 2. Track A — MVP data-quality pass (launch-blocking)

**Goal:** the existing catalog is duplicate-free and has no obviously stale `under_construction`/`unknown` records, verified against the one metric that matters: nothing famous is missing or duplicated. No pipeline, no automation — this is a bounded, mostly-manual sprint against data you already have.

### A.1 — Minimal schema addition (ship first, small migration)

Only the columns needed to make review state honest and support a manual dedup pass — nothing from the full provenance layer yet:

```sql
alter table public.coasters
  add column if not exists last_verified_at timestamptz,
  add column if not exists confidence numeric check (confidence between 0 and 1),
  add column if not exists review_state text not null default 'active'
    check (review_state in ('active','needs_review','possibly_duplicate','possibly_outdated','archived')),
  add column if not exists needs_review_reason text,
  add column if not exists rcdb_url text;  -- convenience external link only, never scraped in bulk

create extension if not exists pg_trgm;
create index if not exists coasters_name_trgm_idx on public.coasters using gin (name gin_trgm_ops);
```

This is a strict subset of the engineer's §4G proposal — same column names, so nothing here needs to be re-migrated when Track B lands.

### A.2 — Mark the legacy import as what it is

```sql
update public.coasters
set confidence = 0.3,
    review_state = 'needs_review',
    needs_review_reason = 'Legacy 2022 import; not recently verified'
where last_verified_at is null;
```

This alone fixes the "pretending certainty we don't have" problem the engineer flagged in §10, at zero pipeline cost.

### A.3 — Duplicate pass (comment #11: prerequisite for accurate counts/rankings)

This is the highest-priority Track A item — duplicates directly corrupt the Bradley-Terry input (a duplicated coaster splits a user's pairwise wins across two IDs) and are the one hard quality metric the stakeholders named (QA #12).

1. Run `pg_trgm` similarity on `(name, park_id)` to surface candidate pairs above a threshold (start ~0.6, tune by inspecting false-positive rate).
2. Manual admin review of each pair — accept/reject merge.
3. On merge: keep the older/more-complete record, `on delete cascade` naturally cleans up `user_rides` on the deleted duplicate's FK, but **re-point** any `user_rides` rows on the duplicate to the canonical ID first so users don't silently lose ranked entries.
4. Log merges somewhere durable even in this lightweight pass — a simple table now saves a migration later:

```sql
create table public.coaster_merge_log (
  id uuid primary key default gen_random_uuid(),
  duplicate_coaster_id uuid not null,
  canonical_coaster_id uuid not null references public.coasters (id),
  merged_by text,
  reason text,
  created_at timestamptz not null default now()
);
```

(This is identical to the engineer's §8 table, brought forward because it's cheap and dedup is happening now regardless.)

### A.4 — Status triage for `under_construction` / `unknown`

Directly from the engineer's §10, Step 4 — this is the single highest-value freshness fix, since it's now 2026 and a meaningful fraction of these have almost certainly opened:

- For each `under_construction`/`unknown` coaster: targeted search (`[name] [park] opened 2023/2024/2025/2026`, `now open`, `opening date`).
- Evidence of opening → `status = operating`, fill `opening_date`, set `last_verified_at = now()`, `confidence = 0.7`, `review_state = active`.
- Evidence of cancellation/removal → `defunct`/`unknown` as appropriate, flagged `needs_review` for admin sign-off (per the locked-in decision that risky status changes stay human-reviewed).
- No evidence found → leave as `unknown`, `needs_review_reason = 'no recent evidence found'`. Does not block launch — this is exactly the kind of record Track B's continuous refresh exists to eventually close out.

### A.5 — Ad-hoc completeness pass

Per comment #21's explicit preference for non-scalable work now over infrastructure now: manually work the highest-yield discovery sources from the engineer's §11 without building the pipeline —

- Wikidata/Wikipedia lists for major countries and top parks (Campaign A) — spot-check against the catalog, add anything obviously missing directly as `admin`-sourced coaster rows.
- Skip: OSM (legal review pending, comment #13), government registries, manufacturer scraping, news monitoring — all Track B.

Stop condition is qualitative, not a count: spot-check against a "famous coasters" mental checklist (top parks in the US, major European operators, well-known Asian parks) rather than chasing a specific number.

### What Track A explicitly does *not* build

Full provenance tables, candidate staging, source registry, confidence-scoring model, automated extraction, scheduled refresh jobs. All real, all deferred to Track B — building them now would spend the 24–48 hour budget on infrastructure instead of the data problem it's meant to solve.

---

## 3. Track B — Long-term infrastructure (post-launch, build incrementally)

The engineer's five-layer architecture (canonical / provenance / candidate staging / human review / continuous refresh) is sound and largely adopted as-is. The changes below come from the comments questioning specific design choices.

### 3.1 Provenance layer — adopt as spec'd

`data_sources`, `coaster_observations`, `coaster_external_ids`, `coaster_status_history`, `coaster_aliases`, `coaster_lineage`, `park_external_ids` — no comment materially objected to this design, so build it per §4 and §14 of the original proposal when this track starts. `coaster_merge_log` will already exist from Track A (§A.3 above).

### 3.2 Candidates vs. submissions (comment #1)

The comment correctly spots that a new `coaster_candidates` table would duplicate the existing `coaster_submissions` table and its review UI. Recommendation: **don't merge the tables, unify the queue.**

They have different shapes for good reason — `coaster_submissions` is owned by an authenticated user with RLS tied to `auth.uid()`; `coaster_candidates` will hold anonymous, scraped, potentially-duplicate records with no owner. Forcing them into one schema means either giving scraped rows a fake owner or relaxing submissions' RLS model. Instead:

- Build `coaster_candidates` as spec'd in §4D, with `data_sources.kind = 'user_submission'` as one of its provenance kinds.
- Give the admin review screen a single **unified queue view** (a Postgres view unioning both tables' pending rows into a common shape) so reviewers work one queue regardless of provenance — this satisfies the "avoid duplicate admin UI" concern without a schema merge.
- Longer term, `coaster_submissions` could become a thin wrapper that inserts directly into `coaster_candidates` with `source_id` pointing at a `user_submission` source row — worth revisiting once the candidate table exists, but not a blocker to start.

### 3.3 Confidence scoring — adopt the coarse model, defer field-level (comment #10)

Adopt §9's source-reliability + freshness + corroboration model at the **record level**. Explicitly defer field-level confidence (name: high, height: low, etc.) — correct that it's real complexity, but it only pays off once the core existence/status pipeline is proven, and the locked-in success metric (§1) doesn't need it.

### 3.4 Extraction pipeline & LLM cost — flag as needs further analysis (comments #2, #7, #19)

This genuinely can't be resolved without data Track A will produce. Recommended framework once it's time to decide:

- Estimate `extraction_volume ≈ (candidates from Track B campaigns) × (unstructured pages per candidate)`. Track A's manual completeness pass (§A.5) gives a rough sense of how many gaps exist before any automation.
- Compare: commercial API cost (`extraction_volume × tokens/page × price`) vs. a monthly manually-kicked-off local batch job (Qwen 2.7B/7B on a MacBook) — the local option trades $ for turnaround time and operator attention, which may be fine given the ~50/day human review cap anyway (no point discovering faster than it can be reviewed).
- Brave Search API's rate limit, not LLM choice, is likely the actual bottleneck for discovery volume — size the pipeline against that first.
- Given the 50/day review cap, **throttle candidate generation to match review capacity** rather than generating a large backlog that rots in the queue — this also directly serves the semi-automated acceptance criteria in §3.6.

### 3.5 Duplicate detection & review-state definitions (comment #4)

Concrete answer, since this was flagged as underspecified:

- **Detection**: fuzzy name match (`pg_trgm`, same mechanism as Track A's manual pass) blocked by same-park or same-country-and-similar-name, corroborated by manufacturer + opening-year match where available — per §8's matching rules.
- **`needs_review`**: general data-quality issue — missing required fields, conflicting evidence, low confidence. Not staleness-specific.
- **`possibly_outdated`**: specifically means the *freshness clock* has expired (no verification within the target cadence), independent of whether the data itself looks internally consistent.
- **`possibly_duplicate`**: matched another record/candidate above the similarity threshold but not auto-merged.

These three can co-occur on one record; treat them as independent flags a review queue can filter on, not a single state machine.

### 3.6 LLM-assisted merging — pilot, don't automate (comment #14)

Use an LLM as a **recommender only**: given two candidate records, return a verdict + confidence for a human to confirm — never auto-merge. Pilot this against the Track A merge log (§A.3), which is a small, human-labeled ground-truth set, before trusting it on the larger backlog.

### 3.7 Type classification — agree, keep it simple (comment #15)

Keep `type text`, normalize opportunistically during the extraction pipeline's normalization stage. Skip the `coaster_types` controlled-vocabulary table for v1 — correct call, the classification is genuinely subjective and a controlled vocabulary adds maintenance for filtering value that's marginal at current scale.

### 3.8 Park type — needs a decision, lean toward a small enum (comment #5)

The comment is right that this is under-specified and possibly low-value, but the README already commits to park/country/manufacturer/material filters as a core feature, and a park-type filter is a natural extension. Recommendation: small enum, nullable, defaulted to `null`/unknown rather than forced —

```sql
create type park_type as enum (
  'theme_park','amusement_park','water_park',
  'family_entertainment_center','fairground','zoo','ski_resort','other'
);
```

Low maintenance if left nullable; revisit as free text if the enum proves too rigid during Track B's park-discovery campaigns.

### 3.9 External ID semantics (comment #6)

Resolved by construction, not a new table: `coaster_external_ids.source_id` already disambiguates the namespace — each row in `data_sources` *is* one system (Wikidata, a specific manufacturer, RCDB-for-linking-only, etc.), so `external_id` is simply "whatever key that source uses." Document expected source rows as comments in the seed migration rather than adding another mapping table.

### 3.10 OpenStreetMap — defer, legal-review-gated (comment #13)

Agreed with the comment: don't integrate OSM as a bulk source until ODbL implications are reviewed. Once cleared, use it only for discovery leads and geospatial hints (park coordinates), never as a source of record for canonical fields — matches the engineer's own caveat in §5 and §11.

### 3.11 Data quality dashboard — collect now, build UI later (comment #16)

Agreed that a dashboard without an audience isn't worth building yet, but the underlying metrics (§22 of the proposal) are cheap SQL views — build those as part of Track B's schema work so there's already historical data once a dashboard is prioritized. Don't build the admin UI for it until then.

### 3.12 Evidence retention — needs cost analysis (QA #8)

Store source URLs + text snippets indefinitely (cheap). Hold off on raw HTML/PDF snapshot storage until Supabase storage costs at expected volume are estimated — this is a genuine open item, not a design decision, and shouldn't block anything else in Track B.

### 3.13 Continuous refresh cadence

Per the locked-in decision that top-tier parks share one cadence and that catching the under_construction→operating cycle matters more than the engineer's original monthly suggestion, tighten official-park-page and under_construction-specific refresh to something like bi-weekly rather than monthly, reusing the existing `pg_cron` pattern already running the 15-minute rankings recompute.

---

## 4. Schema migration sequencing

**Migration 1 — ship with Track A, before launch:**
```sql
-- coasters: last_verified_at, confidence, review_state, needs_review_reason, rcdb_url
-- pg_trgm extension + trigram index on coasters.name
-- coaster_merge_log
```

**Migration 2 — ship when Track B work starts:**
```sql
-- data_sources, coaster_observations, coaster_external_ids,
-- coaster_status_history, coaster_aliases, coaster_lineage,
-- coaster_candidates, park_external_ids
-- parks: official_website, park_type, last_verified_at, review_state
-- unified pending-review view over coaster_submissions + coaster_candidates
```

Nothing in Migration 1 needs to be undone or reshaped for Migration 2 — the column names and types match the engineer's original proposal throughout, so Track A is genuinely a subset, not a detour.

---

## 5. What "done" looks like for each track

- **Track A / launch:** no duplicate coasters for any well-known ride; every `under_construction`/`unknown` record has either a current-evidence status or an honest `needs_review` flag; nothing is silently presented as more certain than it is.
- **Track B / ongoing:** the engineer's end state from §25 — every coaster has an evidence trail, status changes are historically tracked, new candidates arrive continuously at a rate the ~50/day review capacity can actually absorb, and the database gets more complete and trustworthy over time rather than stale again six months post-launch.
