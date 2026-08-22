# Implementation Plan: Track A Data Quality Pipeline

## Overview

Implement the Track A data quality pipeline in the existing `scripts/` subproject (TypeScript/Node.js, `tsx` runner). Work proceeds phase by phase: infrastructure first, then dedup in dependency order (parks and manufacturers before coasters), then LLM passes, then QA.

**Key sequencing constraint:** Coaster dedup (Phases 4–6) must come after parks dedup (Phase 2) and manufacturers dedup (Phase 3) are complete. Park-blocking in the coaster candidate generation step is only reliable once duplicate parks have been collapsed and `coasters.park_id` re-pointed. Phases 2 and 3 can run in parallel with each other.

The fixed LLM model is **Qwen3.8-27B** — no model selection step.

---

## Tasks

- [x] 0. Create the human operator runbook
  - Create `docs/data/TRACK_A_RUNBOOK.md` documenting every step a human must take to execute the pipeline end-to-end: PR review/merge gates, dry-run before apply pattern for each phase, interactive CLI instructions for each review step, status triage research workflow, Golden Ticket fixture transcription, definition-of-done checklist, and troubleshooting notes
  - This document is the answer to "I'm the human — what do I do, in what order, and where are my decision points?"
  - _No code requirement — this is documentation that must exist before implementation begins_

- [x] 1. Extend scripts package infrastructure and shared clients
  - [x] 1.1 Pin new dependencies and extend `scripts/package.json`
    - Add `openai`, `zod`, and `@supabase/supabase-js` as exact-pinned production dependencies (no `^` or `~`) in `scripts/package.json`
    - Add `fast-check`, `vitest`, and `@vitest/coverage-v8` as exact-pinned dev dependencies
    - Add all new npm scripts to the `"scripts"` section: `normalize-names`, `generate-park-candidates`, `adjudicate-parks`, `review-parks`, `generate-manufacturer-candidates`, `adjudicate-manufacturers`, `review-manufacturers`, `generate-dupe-candidates`, `adjudicate-dupes`, `review-dupes`, `triage-status`, `check-coverage`, `test`, `test:watch`
    - _Requirements: 12.1, 4.1, 5.1, 5.4, 5.7, 6.1, 6.4, 6.7, 7.1, 8.1, 9.1, 10.1, 11.6_

  - [x] 1.2 Update `scripts/tsconfig.json` for strict mode and full source coverage
    - Ensure `"strict": true` is set
    - Ensure `include` contains `"./src/**/*.ts"` plus any root-level `.ts` files
    - Add `scripts/vitest.config.ts` with `{ test: { globals: true, environment: "node" } }`
    - _Requirements: 12.4, 12.5_

  - [x] 1.3 Implement `scripts/src/db/client.ts` — Supabase admin client
    - Load `.env` via `dotenv` relative to the scripts package root (path: `../../.env`)
    - Read `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from environment
    - If either is absent or empty, write `"Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set"` to stderr and call `process.exit(1)` before constructing the client
    - Export named `supabaseAdmin` using `createClient` with `auth: { persistSession: false }`
    - _Requirements: 12.2, 12.3_

- [x] 2. Phase 0 — Schema migration
  - [x] 2.1 Create and land the schema migration via a PR
    - Run `supabase migration new coaster_review_metadata_and_dedup_staging` from the repo root to generate the migration file
    - Populate with all required SQL (see design §Data Models for the full verbatim text):
      - Add columns to `public.coasters` using `add column if not exists`: `last_verified_at timestamptz`, `confidence numeric check (confidence between 0 and 1)`, `review_state text not null default 'active'` with CHECK constraint for the five valid values, `needs_review_reason text`
      - Enable `pg_trgm` extension and create GIN trigram indexes on `coasters.name`, `parks.name`, and `manufacturers.name`
      - Create `public.coaster_merge_log` table `IF NOT EXISTS` (no FK on `duplicate_coaster_id` — intentional for audit purposes)
      - Create `public.coaster_dupe_candidates` table `IF NOT EXISTS` with unique constraint on `(coaster_a_id, coaster_b_id)`
      - Create `public.park_dupe_candidates` table `IF NOT EXISTS` with unique constraint on `(park_a_id, park_b_id)`
      - Create `public.manufacturer_dupe_candidates` table `IF NOT EXISTS` with unique constraint on `(manufacturer_a_id, manufacturer_b_id)`
      - Apply RLS to all four new tables: no access for `anon` or `authenticated`; admin-only SELECT policy using `is_admin()`; `service_role` bypasses RLS naturally
      - Add `UPDATE` to set `review_state = 'needs_review'` and `confidence = 0.3` for all `source = 'open-csv'` coaster rows
      - Create the `public.apply_coaster_merge` PL/pgSQL function with `security definer`, `set search_path = public`, `REVOKE` from `public, anon, authenticated`, and `GRANT EXECUTE` to `service_role`
    - Commit to a feature branch and open a PR; CI runs `supabase db push` automatically on merge to `main` — **never run `supabase db push` locally**
    - Do not proceed to tasks 3+ until the PR has merged and the migration is live
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 1.11, 1.12, 1.13_

- [x] 3. LLM client, prompts, Zod schemas, and task functions
  - [x] 3.1 Implement `scripts/src/llm/client.ts`
    - Export named `lmStudio` with `baseURL: "http://localhost:1234/v1"` and `apiKey: "lm-studio"`
    - Export constant `MODEL_ID = "qwen3.8-27b"` — no environment variable, no runtime guard needed
    - This is the only file that constructs an `OpenAI` instance targeting LM Studio
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [x] 3.2 Implement `scripts/src/llm/prompts.ts`
    - Export `NORMALIZATION_SYSTEM_PROMPT`: classifies each name as `park_name_embedded`, `truncated`, `abbreviation`, or `none`; returns `cleaned_name`; outputs a JSON array; includes three worked examples; instructs to classify as `none` when uncertain
    - Export `ADJUDICATION_SYSTEM_PROMPT`: decides whether two records are the same physical coaster; same-name coasters at different parks default to not-duplicate; output `needs_human` when uncertain; includes three worked examples
    - _Requirements: 13.1, 13.2_

  - [x] 3.3 Implement Zod schemas and `callWithRetry` helper in `scripts/src/llm/tasks.ts`
    - Define and export `NormalizationResult` Zod schema and its TypeScript type
    - Define and export `AdjudicationResult` Zod schema and its TypeScript type
    - Export `NormalizationBatch = z.array(NormalizationResult)`
    - Implement private `callWithRetry<T>`: on Zod failure log full error + raw response to stderr, append schema-reminder user turn, retry once; on second failure log again and throw
    - _Requirements: 3.1, 3.5, 3.6, 13.6, 13.7_

  - [x] 3.4 Implement `normalizeOne`, `normalizeBatch`, and `adjudicateOne` in `scripts/src/llm/tasks.ts`
    - `normalizeOne(input: NormalizeInput): Promise<NormalizationResult>` — throws on double failure
    - `normalizeBatch(records: NormalizeInput[]): Promise<NormalizationBatch>` — batch as one call, throws on double failure
    - `adjudicateOne(input: AdjudicateInput): Promise<AdjudicationResult>` — throws on double failure
    - Export `NormalizeInput` and `AdjudicateInput` type aliases
    - _Requirements: 13.3, 13.4, 13.5_

  - [x] 3.5 Write property tests for Zod schemas and retry logic (*) (`src/__tests__/zod-schemas.test.ts`, `src/__tests__/retry-logic.test.ts`)
    - **Property: NormalizationResult schema accepts valid objects and rejects constraint violations**
    - **Property: AdjudicationResult schema accepts valid objects and rejects constraint violations**
    - **Property: Zod validation is the only gate between LLM output and DB writes**
    - **Property: Retry-then-throw calls LLM exactly twice before throwing**
    - **Property: normalizeBatch throw marks all N batch records as needs_review**
    - **Property: adjudicateOne throw sets verdict=needs_human, verdict_confidence=null, verdict_reasoning=llm_parse_failure**

- [x] 4. Checkpoint — verify infrastructure compiles
  - Run `cd scripts && npm run typecheck`; ensure zero errors across `src/llm/`, `src/db/`, and config files. Stop and ask the user if any type errors arise.

- [ ] 5. Phase 1 — Name normalization script
  - [ ] 5.1 Implement `scripts/src/normalize-names.ts`
    - Parse CLI flags: `--apply`, `--batch-size <n>` (default 10), `--reprocess`
    - Fetch `review_state = 'active'` rows from `coasters` (skip already-processed unless `--reprocess`)
    - Chunk into batches of `--batch-size`; call `normalizeBatch` for each chunk
    - Catch `normalizeBatch` throws: mark all N records in the failed batch with `review_state = 'needs_review'` and `needs_review_reason = 'llm_parse_failure'`; continue to next batch
    - In `--apply` mode: `issue != 'none'` + `confidence >= 0.7` → write `name = cleaned_name`, `review_state = 'needs_review'`, `needs_review_reason = 'name_normalized'`; `issue != 'none'` + `confidence < 0.7` → write `review_state = 'needs_review'`, `needs_review_reason = 'low_confidence_normalization'` (name unchanged)
    - In dry-run mode: print `[DRY-RUN] <coaster_id> | "<original_name>" → "<cleaned_name>" | issue=<issue> confidence=<confidence>` for each `issue != 'none'` record; no DB writes
    - Log per-batch progress to stdout (batch number, record count, Zod failure count)
    - Print final summary: total fetched, `issue=none`, skipped (already processed), name updated, state-only flagged, parse failures
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8_

  - [ ] 5.2 Write property tests for normalization logic (*) (`src/__tests__/normalize-logic.test.ts`)
    - **Property: Normalization correctly partitions high/low confidence records (disjoint, collectively exhaustive)**
    - **Property: Normalization is idempotent for already-processed records**
    - **Property: Normalization summary counts are mutually exclusive and sum to N**

- [ ] 6. Phase 2 — Parks dedup (run before coaster candidate generation)
  - [ ] 6.1 Implement `scripts/src/generate-park-candidates.ts`
    - Parse CLI flag: `--apply`
    - In `--apply` mode: insert pairs from `parks` where `word_similarity(a.name, b.name) > 0.6` and `a.country = b.country`, using `a.id < b.id` and `ON CONFLICT DO NOTHING`
    - In dry-run mode: print count that would be inserted
    - Print completion summary: pairs inserted/would-insert, total candidate set size
    - _Requirements: 5.1, 5.2, 5.3_

  - [ ] 6.2 Implement `scripts/src/adjudicate-parks.ts` — LLM adjudication for park candidates
    - Parse CLI flags: `--apply`, `--dry-run`, `--reprocess`
    - Fetch unresolved `park_dupe_candidates`; skip rows where verdict is already set unless `--reprocess`
    - Process each pair individually via `adjudicateOne`, passing `name`, `country`, `region`, `city` for both parks; the adjudication prompt's null-field rule applies (null fields ≠ different entity)
    - In `--apply` mode: write `verdict` and `verdict_reasoning` to the candidate row; leave `resolved = false`
    - In dry-run mode: print verdict per pair without writing
    - Print summary: total processed, count per verdict, parse failures
    - _Requirements: 5.4, 5.5, 5.6_

  - [ ] 6.3 Implement `scripts/src/review/review-parks.ts` — interactive park review CLI
    - Parse CLI flags: `--dry-run`, `--filter <threshold>`
    - Fetch unresolved `park_dupe_candidates` ordered by similarity descending; apply `--filter` if provided
    - Display for each pair: both park names, country, region, city, similarity score, LLM verdict, and LLM reasoning
    - Keystroke interaction: `y` = confirm merge (prompt for reason), `n` = reject, `s` = skip
    - On confirm: atomically re-point all `coasters.park_id` from duplicate to canonical, delete duplicate park, set `resolved = true` — single transaction, rollback on failure
    - On reject: set `verdict = 'not_duplicate'`, `resolved = true`, `reviewed_by`
    - `--dry-run`: show what each action would do without writing
    - Print completion summary
    - _Requirements: 5.7, 5.8, 5.9, 5.10, 5.11, 5.12_

  - [ ]* 6.4 Write property tests for park review logic (`src/__tests__/park-review.test.ts`)
    - **Property: Park merge atomically re-points all affected coasters and deletes duplicate park — or rolls back entirely**
    - **Property: Park merge count summary is consistent (canonical row survives, duplicate gone)**

- [ ] 7. Phase 3 — Manufacturers dedup (can run in parallel with Phase 2)
  - [ ] 7.1 Implement `scripts/src/generate-manufacturer-candidates.ts`
    - Parse CLI flag: `--apply`
    - In `--apply` mode: insert pairs from `manufacturers` where `word_similarity(a.name, b.name) > 0.6`, using `a.id < b.id` and `ON CONFLICT DO NOTHING` (no country-blocking — 101 rows, small enough to compare globally)
    - In dry-run mode: print count that would be inserted
    - Print completion summary
    - _Requirements: 6.1, 6.2, 6.3_

  - [ ] 7.2 Implement `scripts/src/adjudicate-manufacturers.ts` — LLM adjudication for manufacturer candidates
    - Parse CLI flags: `--apply`, `--dry-run`, `--reprocess`
    - Fetch unresolved `manufacturer_dupe_candidates`; skip rows where verdict is already set unless `--reprocess`
    - Process each pair individually via `adjudicateOne`, passing `name` and `country` for both manufacturers
    - In `--apply` mode: write `verdict` and `verdict_reasoning`; leave `resolved = false`
    - In dry-run mode: print verdict per pair without writing
    - Print summary
    - _Requirements: 6.4, 6.5, 6.6_

  - [ ] 7.3 Implement `scripts/src/review/review-manufacturers.ts` — interactive manufacturer review CLI
    - Parse CLI flags: `--dry-run`, `--filter <threshold>`
    - Fetch unresolved `manufacturer_dupe_candidates` ordered by similarity descending
    - Display for each pair: both manufacturer names, country, similarity, LLM verdict, LLM reasoning
    - Keystroke interaction: `y` = confirm merge (prompt for reason), `n` = reject, `s` = skip
    - On confirm: atomically re-point all `coasters.manufacturer_id` from duplicate to canonical, delete duplicate manufacturer, set `resolved = true` — single transaction, rollback on failure
    - On reject: set `verdict = 'not_duplicate'`, `resolved = true`, `reviewed_by`
    - Print completion summary
    - _Requirements: 6.7, 6.8, 6.9, 6.10, 6.11, 6.12_

  - [ ] 7.4 Write property tests for manufacturer review logic (*) (`src/__tests__/manufacturer-review.test.ts`)
    - **Property: Manufacturer merge atomically re-points all affected coasters and deletes duplicate — or rolls back entirely**

- [ ] 8. Checkpoint — run `cd scripts && npm run typecheck` across all scripts so far; ensure zero errors. Stop and ask the user if issues arise.

- [ ] 9. Phase 4 — Coaster duplicate candidate generation
  - [ ] 9.1 Implement `scripts/src/generate-dupe-candidates.ts`
    - Parse CLI flag: `--apply`
    - Check for unresolved `park_dupe_candidates` rows; if any found, print warning to stderr: "Warning: unresolved park duplicates detected; same-park blocking may be unreliable"
    - Check for `review_state = 'active'` coaster rows; if found, print warning to stderr: "Warning: normalization pass may not have been applied; matching on uncleaned names"
    - In `--apply` mode: execute Pass 1 SQL (`word_similarity > 0.7`, `match_basis = 'same_park'`, `ON CONFLICT DO NOTHING`) then Pass 2 SQL (`word_similarity between 0.45 and 0.7`, same park, `ON CONFLICT DO NOTHING`)
    - In dry-run mode: run equivalent SELECT COUNT queries without inserting
    - Print summary: Pass 1 count, Pass 2 count, total candidate set size
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9_

  - [ ]* 9.2 Write property tests for candidate generation logic (`src/__tests__/candidate-generation.test.ts`)
    - **Property: Pass 1 and Pass 2 are disjoint (no pair appears in both)**
    - **Property: Candidate generation is idempotent (second run produces same count as first)**

- [ ] 10. Phase 5 — LLM adjudication pass
  - [ ] 10.1 Implement `scripts/src/adjudicate-dupes.ts`
    - Parse CLI flags: `--apply`, `--reprocess`
    - Fetch unresolved `coaster_dupe_candidates` with join to `coasters` for both sides; skip rows where `verdict IS NOT NULL AND resolved = true` unless `--reprocess`
    - Process each pair individually via `adjudicateOne`; catch throws: `verdict = 'needs_human'`, `verdict_confidence = null`, `verdict_reasoning = 'llm_parse_failure'`
    - In `--apply` mode: write `verdict`, `verdict_confidence`, `verdict_reasoning` to the candidate row
    - In dry-run mode: print `[DRY-RUN] <pair_id> | "<name_a>" vs "<name_b>" | verdict=<verdict> confidence=<confidence>` per pair; no DB writes
    - Print final summary: total processed, count per verdict, Zod parse failures
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8_

  - [ ]* 10.2 Write property tests for adjudication logic (`src/__tests__/adjudicate-logic.test.ts`)
    - **Property: Adjudication dry-run writes nothing and outputs exactly one line per unresolved pair**
    - **Property: Adjudication summary counts sum to N**

- [ ] 11. Phase 6 — Human review and merge CLI (coasters)
  - [ ] 11.1 Implement `scripts/src/review/review-dupes.ts` — candidate display and priority ordering
    - Parse CLI flags: `--filter <threshold>`, `--dry-run`
    - Fetch all unresolved `coaster_dupe_candidates` with joined coaster + park data
    - Sort in-memory: `verdict = 'duplicate'` with `verdict_confidence >= 0.85` first (by `verdict_confidence` desc, then `id` asc); remaining by `similarity` desc, then `id` asc
    - Apply `--filter`; if no pairs match, print "No pairs match the specified filter." and exit 0
    - Display each candidate: both coaster names, park names, manufacturer, opening date, height (m), LLM verdict, confidence, reasoning
    - _Requirements: 9.1, 9.2, 9.3, 9.6_

  - [ ] 11.2 Implement keypress interaction loop and merge/reject actions
    - Keystroke: `y` = confirm merge, `n` = reject, `s` = skip
    - On `y`: prompt for free-text reason; call `applyMerge` (or print dry-run description)
    - On `n`: set `verdict = 'not_duplicate'`, `resolved = true`, `reviewed_by` from `REVIEWER_NAME` env or `'unknown'`
    - `applyMerge`: check `user_rides` for duplicate coaster; if count > 0, abort, print warning with affected user IDs to stderr, set `verdict = 'needs_human'` + `verdict_reasoning = 'user_rides_present'`
    - If no conflict: call `supabaseAdmin.rpc("apply_coaster_merge", ...)` atomically; on RPC error print to stderr and leave candidate unchanged
    - Guard: if ambiguity would require deleting the canonical side, abort and mark pair `needs_human`
    - `--dry-run`: evaluate `user_rides` guard and report actions without writing
    - _Requirements: 9.4, 9.5, 9.7, 9.8, 9.9_

  - [ ] 11.3 Write property tests for review-dupes logic (*) (`src/__tests__/review-dupes.test.ts`)
    - **Property: `sortCandidates` — high-confidence duplicates always precede all others with correct sub-ordering**
    - **Property: Merge atomicity — delete + log + resolved=true commit together or not at all**
    - **Property: Canonical coaster row always exists after any confirmed merge**
    - **Property: `user_rides` guard blocks merge for any count >= 1**

- [ ] 12. Phase 7 — Status triage script
  - [ ] 12.1 Implement `scripts/src/triage-status.ts` — report mode
    - Parse CLI flags: `--apply`, `--input <path>`
    - In report mode: query coasters where `status in ('under_construction', 'unknown')`; create `scripts/output/` if absent; write `scripts/output/status-triage-<YYYYMMDDTHHmmssZ>.json`
    - _Requirements: 10.1, 10.2_

  - [ ] 12.2 Implement `--apply` mode and validation
    - Validate `--input <path>` exists and is valid JSON; exit on failure before any DB calls
    - For each entry with `resolution` field: validate status is one of the six allowed values; if `coaster_id` not in DB, log and skip; write `status`, `opening_date`, `last_verified_at`, `confidence`, `review_state`
    - `defunct`/`relocated` → `review_state = 'needs_review'`, `needs_review_reason = 'status_changed_needs_admin_confirm'`; all others → `review_state = 'active'`
    - Entries without `resolution` silently skipped
    - Print summary: total entries, skipped (no resolution), skipped (unknown id), skipped (invalid status), applied
    - _Requirements: 10.3, 10.4, 10.5, 10.6, 10.7, 10.8_

  - [ ] 12.3 Write property tests for triage-status logic (*) (`src/__tests__/triage-status.test.ts`)
    - **Property: Apply only updates entries with `resolution` field**
    - **Property: `review_state` is `'needs_review'` iff new status is `defunct` or `relocated`**
    - **Property: Triage summary counts sum to total input entries**

- [ ] 13. Phase 8 — Golden Ticket coverage QA
  - [ ] 13.1 Create `scripts/qa/fixtures/golden-ticket-2025.json`
    - Hand-transcribe exactly 50 steel and 50 wood entries from the 2025 Amusement Today Golden Ticket Awards
    - Each entry: `rank` (integer), `category` (`"steel"` or `"wood"`), `name`, `park`, `country`
    - _Requirements: 11.1_

  - [ ] 13.2 Implement `scripts/src/qa/check-golden-ticket-coverage.ts`
    - Read fixture; for each entry query `coasters` joined to parks for case-insensitive matching
    - Classify: `FOUND` (exact case-insensitive name at matching park), `POSSIBLE` (`word_similarity >= 0.5` at matching park), `MISSING`
    - Print one line per entry: `[STATUS] #<rank> <category> — <name> @ <park>`
    - Print summary before exit; exit 1 if any `MISSING`, exit 0 otherwise
    - Read-only — no DB writes
    - _Requirements: 11.2, 11.3, 11.4, 11.5, 11.6_

  - [ ]* 13.3 Write property tests for coverage logic (`src/__tests__/coverage.test.ts`)
    - **Property: Coverage classification is total and mutually exclusive (exactly one of FOUND/POSSIBLE/MISSING)**
    - **Property: Exit code is 1 iff at least one entry is MISSING**

- [ ] 14. Unit tests for environment guards and fixture integrity
  - [ ] 14.1 Write unit tests for `db/client.ts` env guard (*)
    - Test that `scripts/src/db/client.ts` exits with correct error message when env vars are absent
    - _Requirements: 12.3_

  - [ ] 14.2 Write unit tests for fixture file integrity (*)
    - Assert `golden-ticket-2025.json` has exactly 50 steel + 50 wood entries with all required fields
    - _Requirements: 11.1_

  - [ ] 14.3 Write unit test for `generate-dupe-candidates.ts` warnings (*)
    - Test stderr warning when unresolved park duplicates exist
    - Test stderr warning when `review_state = 'active'` coaster rows exist
    - _Requirements: 7.7, 7.8_

- [ ] 15. Final checkpoint — full quality gate
  - Run `cd scripts && npm run typecheck` and `npm run test`; verify zero TypeScript errors and all tests pass. Stop and ask the user if any issues arise.

---

## Notes

- Tasks marked with `*` are optional property/unit tests — skip for a faster MVP pass; run before treating the pipeline as production-ready
- Phases 2 and 3 (parks/manufacturers dedup) **must complete before** Phase 4 (coaster candidate generation) — same-park blocking is unreliable until park duplicates are resolved
- The `apply_coaster_merge` Postgres function handles the atomic coaster merge; Node.js calls it via `supabaseAdmin.rpc`
- Parks and manufacturer merges are implemented directly in the review CLI scripts (no separate DB function needed — the FK cascade logic is simpler)
- All pipeline scripts default to dry-run without `--apply`; safe to run repeatedly
- The fixed model `qwen3.8-27b` is hardcoded in `client.ts` — no env var needed
- LLM adjudication is used for parks, manufacturers, AND coasters — the same `adjudicateOne` function and prompt handles all three, with the field set adapted per entity type
- The null-field rule in the adjudication prompt ("null fields are not evidence of a different entity") is particularly important for the low-data records common in the CC0 import

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["0"] },
    { "id": 1, "tasks": ["1.1", "1.2"] },
    { "id": 2, "tasks": ["1.3", "2.1", "3.1", "3.2"] },
    { "id": 3, "tasks": ["3.3"] },
    { "id": 4, "tasks": ["3.4"] },
    { "id": 5, "tasks": ["3.5", "5.1", "6.1", "7.1"] },
    { "id": 6, "tasks": ["5.2", "6.2", "7.2"] },
    { "id": 7, "tasks": ["6.3", "7.3"] },
    { "id": 8, "tasks": ["6.4", "7.4", "9.1"] },
    { "id": 9, "tasks": ["9.2", "10.1"] },
    { "id": 10, "tasks": ["10.2", "11.1"] },
    { "id": 11, "tasks": ["11.2", "12.1", "13.1"] },
    { "id": 12, "tasks": ["11.3", "12.2", "13.2"] },
    { "id": 13, "tasks": ["12.3", "13.3", "14.1", "14.2", "14.3"] }
  ]
}
```
