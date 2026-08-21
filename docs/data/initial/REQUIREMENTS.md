# Requirements Document

## Introduction

Track A is a one-time, pre-launch data quality pipeline for the CoasterRank coaster catalog (~1,087 records). It runs entirely in the `scripts/` subproject against the production Supabase instance via the service-role key, and it produces no user-visible features — its purpose is to leave the catalog clean, deduplicated, and flagged before any real user data accumulates.

The pipeline runs in this order (Phase 8 can run in parallel with Phases 2–6):

- **Phase 0** — Schema migration: add review-metadata columns to `coasters`, create dedup staging tables for parks, manufacturers, and coasters, enable `pg_trgm`.
- **Phase 1** — Name normalization: batch LLM pass (Qwen3.8-27B) that cleans coaster names and writes results back.
- **Phase 2** — Parks dedup: `pg_trgm` candidate generation + human review CLI for `parks` table.
- **Phase 3** — Manufacturers dedup: same approach for `manufacturers` table (can run in parallel with Phase 2).
- **Phase 4** — Coaster duplicate candidate generation: SQL script populates `coaster_dupe_candidates` via `pg_trgm` — run only after Phases 2 and 3 are complete so park-blocking is reliable.
- **Phase 5** — LLM adjudication: batch pass fills verdict/confidence/reasoning on coaster candidate pairs.
- **Phase 6** — Human review + merge: CLI for reviewing flagged coaster pairs and applying confirmed merges.
- **Phase 7** — Status triage: manual/scripted pass for `under_construction`/`unknown` coasters (independent of Phases 1–6).
- **Phase 8** — Completeness QA: Golden Ticket Awards fixture + check script that reports MISSING/POSSIBLE/FOUND.

All scripts live in `scripts/` (Node.js/TypeScript, existing `package.json`). The LLM client targets LM Studio's OpenAI-compatible endpoint (`http://localhost:1234/v1`) using **Qwen3.8-27B** as the fixed model — no model selection phase.

---

## Glossary

- **Coaster_Pipeline**: The complete set of scripts, SQL, fixtures, and tooling produced by this spec.
- **Scripts_Package**: The existing `scripts/` directory with its own `package.json`, `tsconfig.json`, `tsx`, and direct-Postgres access via `SUPABASE_DB_URL`.
- **LM_Studio**: A local LLM inference server exposing an OpenAI-compatible API at `http://localhost:1234/v1`.
- **LLM_Client**: The `openai` SDK instance in `scripts/src/llm/client.ts` pointed at LM_Studio.
- **Normalization_Task**: An LLM task that classifies a coaster name as `park_name_embedded`, `truncated`, `abbreviation`, or `none`, and returns a cleaned name.
- **Adjudication_Task**: An LLM task that classifies a coaster pair as `duplicate`, `not_duplicate`, or `needs_human`.
- **Golden_Ticket_Fixture**: The static JSON file at `scripts/qa/fixtures/golden-ticket-2025.json` transcribed from the 2025 Amusement Today Golden Ticket Awards top lists.
- **Coverage_Script**: The read-only script `scripts/src/qa/check-golden-ticket-coverage.ts` that reports MISSING/POSSIBLE/FOUND for each Golden_Ticket_Fixture entry.
- **Coaster_Merge_Log**: The `public.coaster_merge_log` table that records every applied coaster merge as an audit trail.
- **Coaster_Dupe_Candidates**: The `public.coaster_dupe_candidates` table that holds candidate coaster pairs produced by `pg_trgm` and adjudicated by the LLM.
- **Park_Dupe_Candidates**: The `public.park_dupe_candidates` table that holds candidate park pairs produced by `pg_trgm` for human review.
- **Manufacturer_Dupe_Candidates**: The `public.manufacturer_dupe_candidates` table that holds candidate manufacturer pairs produced by `pg_trgm` for human review.
- **Review_CLI**: The interactive scripts in `scripts/src/review/` that present unresolved candidates to a human and apply confirmed merges.
- **Service_Role**: The Supabase `service_role` key; all Scripts_Package writes use this, bypassing RLS.
- **Migration**: A SQL file in `supabase/migrations/` applied via `supabase db push` through CI after a PR merge.

---

## Requirements

---

### Requirement 1: Schema Migration

**User Story:** As a developer, I want to add review-metadata columns to `coasters`, create dedup staging tables for parks, manufacturers, and coasters, and enable `pg_trgm`, so that all subsequent pipeline phases have the schema they depend on.

#### Acceptance Criteria

1. THE Migration SHALL add columns `last_verified_at timestamptz`, `confidence numeric check (confidence between 0 and 1)`, `review_state text not null default 'active'`, and `needs_review_reason text` to `public.coasters` using `add column if not exists`.
2. THE Migration SHALL constrain `review_state` to the values `'active'`, `'needs_review'`, `'possibly_duplicate'`, `'possibly_outdated'`, and `'archived'` via a `CHECK` constraint.
3. THE Migration SHALL create the `public.coaster_merge_log` table `IF NOT EXISTS` with columns: `id uuid primary key default gen_random_uuid()`, `duplicate_coaster_id uuid not null` (no FK — allows referencing deleted coasters for audit purposes), `canonical_coaster_id uuid not null references public.coasters(id)`, `merged_by text`, `reason text`, and `created_at timestamptz not null default now()`.
4. THE Migration SHALL create the `public.coaster_dupe_candidates` table `IF NOT EXISTS` with columns: `id uuid primary key default gen_random_uuid()`, `coaster_a_id uuid not null references public.coasters(id)`, `coaster_b_id uuid not null references public.coasters(id)`, `similarity numeric not null check (similarity between 0 and 1)`, `match_basis text not null`, `verdict text`, `verdict_confidence numeric check (verdict_confidence between 0 and 1)`, `verdict_reasoning text`, `resolved boolean not null default false`, `reviewed_by text`, `created_at timestamptz not null default now()`, and `constraint coaster_dupe_candidates_pair_unique unique (coaster_a_id, coaster_b_id)`.
5. THE Migration SHALL create the `public.park_dupe_candidates` table `IF NOT EXISTS` with columns: `id uuid primary key default gen_random_uuid()`, `park_a_id uuid not null references public.parks(id)`, `park_b_id uuid not null references public.parks(id)`, `similarity numeric not null check (similarity between 0 and 1)`, `verdict text`, `verdict_reasoning text`, `resolved boolean not null default false`, `reviewed_by text`, `created_at timestamptz not null default now()`, and `constraint park_dupe_candidates_pair_unique unique (park_a_id, park_b_id)`.
6. THE Migration SHALL create the `public.manufacturer_dupe_candidates` table `IF NOT EXISTS` with columns: `id uuid primary key default gen_random_uuid()`, `manufacturer_a_id uuid not null references public.manufacturers(id)`, `manufacturer_b_id uuid not null references public.manufacturers(id)`, `similarity numeric not null check (similarity between 0 and 1)`, `verdict text`, `verdict_reasoning text`, `resolved boolean not null default false`, `reviewed_by text`, `created_at timestamptz not null default now()`, and `constraint manufacturer_dupe_candidates_pair_unique unique (manufacturer_a_id, manufacturer_b_id)`.
7. THE Migration SHALL enable the `pg_trgm` extension via `create extension if not exists pg_trgm`.
8. THE Migration SHALL create GIN trigram indexes: on `public.coasters.name`, `public.parks.name`, and `public.manufacturers.name`.
9. THE Migration SHALL set `review_state = 'needs_review'` and `confidence = 0.3` on all existing `coasters` rows where `source = 'open-csv'`.
10. THE Migration SHALL apply RLS and grants to the three new candidate tables and the merge log: `anon` and `authenticated` roles SHALL have no access (no SELECT, INSERT, UPDATE, or DELETE); `service_role` bypasses RLS naturally; an admin-only SELECT policy SHALL be created for each table using `is_admin()`.
11. THE Migration SHALL create the `public.apply_coaster_merge` PL/pgSQL function with `security definer`, `set search_path = public`, `REVOKE` from `public, anon, authenticated`, and `GRANT EXECUTE` to `service_role`.
12. THE Migration SHALL be idempotent: re-running it on a database that already has the schema SHALL exit with no SQL errors and leave table and index counts unchanged from the first run.
13. THE Migration SHALL be created via `supabase migration new` and applied through the CI `supabase db push` path after a PR merge — never run manually against production.

---

### Requirement 2: LLM Client

**User Story:** As a developer, I want a shared LLM client module pre-configured for Qwen3.8-27B, so that all pipeline scripts talk to LM Studio through a single, consistently-configured entry point without needing to specify a model.

#### Acceptance Criteria

1. THE LLM_Client SHALL be implemented in `scripts/src/llm/client.ts` and export a named `lmStudio` instance of the `openai` SDK.
2. THE LLM_Client SHALL set `baseURL` to `http://localhost:1234/v1` and `apiKey` to the string literal `"lm-studio"` (LM Studio ignores the key value but the SDK requires a non-empty string).
3. THE LLM_Client SHALL export a constant `MODEL_ID = "qwen3.8-27b"` and use it as the model in all chat completion calls — no environment variable override is required or supported.
4. THE LLM_Client SHALL be the only place in the codebase that constructs an `OpenAI` instance targeting LM Studio; no other file SHALL `import OpenAI` with `baseURL` pointing to `localhost:1234`.

---

### Requirement 3: Zod Response Validation and Retry

**User Story:** As a developer, I want all LLM responses validated with Zod and retried once on parse failure, so that malformed outputs are caught immediately and never silently corrupt the database.

#### Acceptance Criteria

1. WHEN the LLM returns a response for a Normalization_Task or Adjudication_Task, THE Scripts_Package SHALL parse the response against the relevant Zod schema before using any field.
2. WHEN Zod validation fails on the first attempt, THE Scripts_Package SHALL retry the same request exactly once, keeping all other parameters identical and appending a user-turn message to the message history reminding the model to output only valid JSON matching the schema.
3. WHEN Zod validation fails on the retry for a Normalization_Task batch, THE Scripts_Package SHALL mark every record in the failed batch with `review_state = 'needs_review'` and `needs_review_reason = 'llm_parse_failure'` and continue processing the next batch without throwing.
4. WHEN Zod validation fails on the retry for an Adjudication_Task single pair, THE Scripts_Package SHALL set `verdict = 'needs_human'`, `verdict_confidence = null`, and `verdict_reasoning = 'llm_parse_failure'` on the candidate row and continue processing the next pair without throwing.
5. IF Zod validation fails on either the first attempt or the retry, THE Scripts_Package SHALL log the full Zod error detail and the raw LLM response string to stderr before attempting a retry or applying the fallback.
6. THE Scripts_Package SHALL never write a field value derived from an unvalidated LLM response to the database.

---

### Requirement 4: Name Normalization Pass

**User Story:** As a developer, I want a batch script that runs the LLM over all coaster names and writes cleaned names back to the database, so that downstream duplicate detection operates on consistent, park-free names.

#### Acceptance Criteria

1. THE Scripts_Package SHALL expose a `normalize-names` npm script in `scripts/package.json` that runs `scripts/src/normalize-names.ts`.
2. WHEN run without `--apply`, THE normalize-names script SHALL operate in dry-run mode: for each coaster record where the LLM returns `issue != 'none'`, print one line in the format `[DRY-RUN] <coaster_id> | "<original_name>" → "<cleaned_name>" | issue=<issue> confidence=<confidence>` but write nothing to the database.
3. WHEN run with `--apply`, THE normalize-names script SHALL write `name = cleaned_name`, `review_state = 'needs_review'`, and `needs_review_reason = 'name_normalized'` for every `review_state = 'active'` record where `issue != 'none'` and `confidence >= 0.7`.
4. WHEN run with `--apply`, THE normalize-names script SHALL set `review_state = 'needs_review'` and `needs_review_reason = 'low_confidence_normalization'` for every `review_state = 'active'` record where `issue != 'none'` and `confidence < 0.7`, without changing `name`.
5. THE normalize-names script SHALL batch records in groups whose size is configurable via a `--batch-size` flag (default: 10), and SHALL log per-batch progress to stdout including batch number, record count, and count of Zod validation failures.
6. WHEN interrupted, THE normalize-names script SHALL be safe to restart: it SHALL skip records that already have `review_state != 'active'` unless `--reprocess` is passed.
7. THE normalize-names script SHALL use the Normalization_Task Zod schema defined in Requirement 3, and all retry and fallback behavior from Requirement 3 applies.
8. WHEN the normalization pass completes, THE normalize-names script SHALL print a summary with six explicit non-overlapping counts: total records fetched, records with `issue = 'none'` (no change needed), records skipped (already processed, `review_state != 'active'`), records with name updated (high-confidence changes applied), records state-only flagged (low-confidence, flag only), and Zod parse failures.

---

### Requirement 5: Parks Dedup

**User Story:** As a developer, I want to find and merge duplicate park records before running coaster dedup, so that same-park blocking in the coaster candidate generation step is reliable.

#### Acceptance Criteria

1. THE Scripts_Package SHALL expose a `generate-park-candidates` npm script that runs `scripts/src/generate-park-candidates.ts`.
2. WHEN run with `--apply`, THE generate-park-candidates script SHALL insert pairs from `public.parks` where `word_similarity(a.name, b.name) > 0.6` and `a.country = b.country` (blocking by country to avoid false positives across regions), using `a.id < b.id` and `ON CONFLICT DO NOTHING`.
3. WHEN run without `--apply`, THE generate-park-candidates script SHALL print the count of pairs that would be inserted without writing anything.
4. THE Scripts_Package SHALL expose an `adjudicate-parks` npm script that runs `scripts/src/adjudicate-parks.ts` — an LLM adjudication pass over all unresolved `park_dupe_candidates` rows, following the same Zod validation and retry pattern as the coaster adjudication pass.
5. THE adjudicate-parks script SHALL pass each pair's `name`, `country`, `region`, and `city` fields for both parks to the adjudication prompt and write `verdict`, `verdict_reasoning`, and `resolved = false` to the candidate row.
6. THE adjudicate-parks script SHALL support `--apply`, `--dry-run`, and `--reprocess` flags with the same semantics as `adjudicate-dupes`.
7. THE Scripts_Package SHALL expose a `review-parks` npm script that runs `scripts/src/review/review-parks.ts` — an interactive CLI presenting each unresolved `park_dupe_candidates` row for human review, with the LLM verdict displayed alongside the raw data for triage.
8. THE review-parks CLI SHALL display for each pair: both park names, country, region, city, trigram similarity score, LLM verdict, and LLM reasoning.
9. WHEN a reviewer confirms a park merge, THE review-parks CLI SHALL atomically: update all `coasters.park_id` rows pointing to the duplicate park to point to the canonical park, delete the duplicate `parks` row, and set `resolved = true` on the candidate row — all in a single transaction. IF the transaction fails, it SHALL rollback fully and leave all rows unchanged.
10. WHEN a reviewer rejects a park merge, THE review-parks CLI SHALL set `verdict = 'not_duplicate'`, `resolved = true`, and `reviewed_by` on the candidate row without modifying any park.
11. THE review-parks CLI SHALL support `--dry-run` (show what would happen without writing) and `--filter <threshold>` (show only pairs above the given similarity threshold).
12. THE generate-park-candidates and review-parks scripts SHALL print completion summaries matching the pattern of other pipeline scripts.

---

### Requirement 6: Manufacturers Dedup

**User Story:** As a developer, I want to find and merge duplicate manufacturer records before running coaster dedup, so that manufacturer data is clean and `manufacturer_id` FKs on coasters are reliable.

#### Acceptance Criteria

1. THE Scripts_Package SHALL expose a `generate-manufacturer-candidates` npm script that runs `scripts/src/generate-manufacturer-candidates.ts`.
2. WHEN run with `--apply`, THE generate-manufacturer-candidates script SHALL insert pairs from `public.manufacturers` where `word_similarity(a.name, b.name) > 0.6`, using `a.id < b.id` and `ON CONFLICT DO NOTHING`. No country-blocking is needed — the manufacturer dataset is small enough to compare globally.
3. WHEN run without `--apply`, THE generate-manufacturer-candidates script SHALL print the count of pairs that would be inserted without writing anything.
4. THE Scripts_Package SHALL expose an `adjudicate-manufacturers` npm script that runs `scripts/src/adjudicate-manufacturers.ts` — an LLM adjudication pass over all unresolved `manufacturer_dupe_candidates` rows.
5. THE adjudicate-manufacturers script SHALL pass each pair's `name` and `country` fields for both manufacturers to the adjudication prompt and write `verdict`, `verdict_reasoning`, and `resolved = false` to the candidate row.
6. THE adjudicate-manufacturers script SHALL support `--apply`, `--dry-run`, and `--reprocess` flags.
7. THE Scripts_Package SHALL expose a `review-manufacturers` npm script that runs `scripts/src/review/review-manufacturers.ts` — an interactive CLI presenting each unresolved `manufacturer_dupe_candidates` row for human review, with the LLM verdict displayed.
8. THE review-manufacturers CLI SHALL display for each pair: both manufacturer names, country, trigram similarity score, LLM verdict, and LLM reasoning.
9. WHEN a reviewer confirms a manufacturer merge, THE review-manufacturers CLI SHALL atomically: update all `coasters.manufacturer_id` rows pointing to the duplicate manufacturer to point to the canonical manufacturer, delete the duplicate `manufacturers` row, and set `resolved = true` on the candidate row — all in a single transaction. IF the transaction fails, it SHALL rollback fully.
10. WHEN a reviewer rejects a manufacturer merge, THE review-manufacturers CLI SHALL set `verdict = 'not_duplicate'`, `resolved = true`, and `reviewed_by` on the candidate row without modifying any manufacturer.
11. THE review-manufacturers CLI SHALL support `--dry-run` and `--filter <threshold>` flags.
12. THE generate-manufacturer-candidates and review-manufacturers scripts SHALL print completion summaries.

---

### Requirement 7: `pg_trgm` Coaster Duplicate Candidate Generation

**User Story:** As a developer, I want a SQL script that populates `coaster_dupe_candidates` using `word_similarity` blocked by park, run only after parks have been deduplicated, so that the adjudication pass has a reliable, high-recall candidate set.

#### Acceptance Criteria

1. THE Scripts_Package SHALL expose a `generate-dupe-candidates` npm script that executes `scripts/src/generate-dupe-candidates.ts`.
2. WHEN run with `--apply`, THE generate-dupe-candidates script SHALL execute Pass 1 (high-confidence): insert pairs where `word_similarity(a.name, b.name) > 0.7` for coasters sharing the same `park_id` (using `a.id < b.id` to avoid symmetric duplicates), setting `similarity` to the computed `word_similarity` value and `match_basis = 'same_park'`.
3. WHEN run with `--apply`, THE generate-dupe-candidates script SHALL execute Pass 2 (wider recall): insert pairs where `word_similarity(a.name, b.name) between 0.45 and 0.7` for coasters sharing the same `park_id`, excluding pairs already inserted in Pass 1, setting `similarity` to the computed `word_similarity` value and `match_basis = 'same_park'`.
4. THE generate-dupe-candidates script SHALL use `word_similarity` (not `similarity`) to avoid penalizing length differences between partial and full names.
5. WHEN run without `--apply`, THE generate-dupe-candidates script SHALL print the count of pairs each pass would insert but write nothing to the database.
6. WHEN run with `--apply`, THE generate-dupe-candidates script SHALL enforce idempotency via `ON CONFLICT DO NOTHING` against the unique `(coaster_a_id, coaster_b_id)` constraint, so re-running SHALL NOT insert duplicate pairs.
7. WHEN run with `--apply` and any `coasters` row has `review_state = 'active'` (i.e., the normalization pass has not been applied), THE generate-dupe-candidates script SHALL print a warning to stderr and continue.
8. WHEN run with `--apply` and any `park_dupe_candidates` rows remain unresolved, THE generate-dupe-candidates script SHALL print a warning to stderr — "Warning: unresolved park duplicates detected; same-park blocking may be unreliable" — and continue.
9. WHEN complete (both modes), THE generate-dupe-candidates script SHALL print: count inserted/would-insert in Pass 1, count in Pass 2, and total candidate set size.

---

### Requirement 8: LLM Adjudication Pass

**User Story:** As a developer, I want a batch script that runs the LLM over all unresolved `coaster_dupe_candidates` pairs and fills in verdict, confidence, and reasoning, so that human reviewers only need to handle genuinely ambiguous cases.

#### Acceptance Criteria

1. THE Scripts_Package SHALL expose an `adjudicate-dupes` npm script that runs `scripts/src/adjudicate-dupes.ts`.
2. THE adjudicate-dupes script SHALL process pairs one at a time (not batched), passing both coasters' fields (`name`, `park`, `manufacturer`, `opening_date`, `height_m`) for coaster A and coaster B to the Adjudication_Task prompt. The prompt SHALL include an explicit rule that null fields on one side of a pair are not evidence of a different coaster — they mean less data, not a different record — and that the model SHALL prefer `needs_human` over `not_duplicate` when nulls reduce confidence but name and park match strongly.
3. WHEN the LLM returns `verdict = 'duplicate'` and `verdict_confidence >= 0.85`, THE adjudicate-dupes script SHALL set `verdict = 'duplicate'`, `verdict_confidence`, and `verdict_reasoning` on the candidate row and leave `resolved = false` (a human must still confirm before merge).
4. WHEN the LLM returns `verdict != 'duplicate'` OR `verdict_confidence < 0.85`, THE adjudicate-dupes script SHALL set all three verdict fields accordingly and leave `resolved = false` for manual review.
5. THE adjudicate-dupes script SHALL apply the retry and fallback behavior from Requirement 3; on final parse failure for a pair, it SHALL set `verdict = 'needs_human'`, `verdict_confidence = null`, and `verdict_reasoning = 'llm_parse_failure'`.
6. WHEN run without `--apply`, THE adjudicate-dupes script SHALL print one line per pair in the format `[DRY-RUN] <pair_id> | "<name_a>" vs "<name_b>" | verdict=<verdict> confidence=<confidence>` but write nothing to the database.
7. WHEN interrupted, THE adjudicate-dupes script SHALL be restartable: it SHALL skip candidate rows where `verdict` is already set AND `resolved = true` unless `--reprocess` is passed.
8. WHEN complete, THE adjudicate-dupes script SHALL print a summary: total pairs processed, count per verdict, and count of Zod parse failures.

---

### Requirement 9: Human Review and Merge CLI (Coasters)

**User Story:** As a developer, I want a CLI tool to step through unresolved `coaster_dupe_candidates`, confirm or reject each merge, and apply confirmed merges atomically, so that no duplicate removal ever happens without explicit human sign-off.

#### Acceptance Criteria

1. THE Scripts_Package SHALL expose a `review-dupes` npm script that runs `scripts/src/review/review-dupes.ts`.
2. THE Review_CLI SHALL present each unresolved candidate pair in priority order: `verdict = 'duplicate'` with `verdict_confidence >= 0.85` first (ordered by `verdict_confidence` descending, then `id` ascending as tiebreaker), then remaining unresolved pairs ordered by `similarity` descending, then `id` ascending as tiebreaker.
3. THE Review_CLI SHALL display for each pair: both coaster names, park names, manufacturer, opening date, height in metres, LLM verdict, confidence, and reasoning.
4. WHEN a reviewer confirms a merge, THE Review_CLI SHALL prompt for a free-text reason, then execute atomically in a single database transaction: delete the duplicate coaster row, insert a row into `coaster_merge_log`, and set `resolved = true` on the `coaster_dupe_candidates` row. IF the transaction fails, it SHALL rollback fully, print the error to stderr, and leave the candidate row unchanged.
5. WHEN a reviewer rejects a merge, THE Review_CLI SHALL set `verdict = 'not_duplicate'`, `resolved = true`, and `reviewed_by` on the candidate row without deleting any coaster.
6. THE Review_CLI SHALL support a `--filter <threshold>` flag to show only pairs with `verdict_confidence >= threshold`; WHEN no pairs match, it SHALL print "No pairs match the specified filter." and exit with code 0.
7. THE Review_CLI SHALL support a `--dry-run` flag that evaluates the `user_rides` guard and reports what each action would do without writing to the database.
8. IF the `user_rides` table contains any rows referencing the duplicate coaster at merge time, THE Review_CLI SHALL abort the merge, print a warning to stderr listing the affected `user_rides.user_id` values, and set `verdict = 'needs_human'` and `verdict_reasoning = 'user_rides_present'` on the candidate row.
9. THE Review_CLI SHALL never delete a canonical coaster row — only the identified duplicate.

---

### Requirement 10: Status Triage

**User Story:** As a developer, I want a script that identifies all `under_construction` and `unknown` coasters and provides a structured report for manual research, so that each record either gets a verified current status or an honest `needs_review` flag before launch.

#### Acceptance Criteria

1. THE Scripts_Package SHALL expose a `triage-status` npm script that runs `scripts/src/triage-status.ts`.
2. WHEN run in report mode (without `--apply`), THE triage-status script SHALL query all coasters where `status in ('under_construction', 'unknown')`, create `scripts/output/` if it does not exist, and write a report file to `scripts/output/status-triage-<YYYYMMDDTHHmmssZ>.json` listing each coaster with its `id`, `name`, park name, current `status`, `opening_date`, and `last_verified_at`.
3. WHEN run with `--apply` and `--input <path>`, THE triage-status script SHALL read the input JSON and for each entry that has a `resolution` field set, write `status`, `opening_date`, `last_verified_at`, `confidence`, and `review_state` to the matching coaster row; entries without a `resolution` field SHALL be silently skipped.
4. IF `--input <path>` points to a file that does not exist or is not valid JSON, THE triage-status script SHALL print an error to stderr and exit with a non-zero code before making any database calls.
5. IF an entry in the input JSON references a `coaster_id` that does not exist in the database, THE triage-status script SHALL print an error for that entry to stderr and skip it, then continue processing remaining entries.
6. IF the `status` field in an input JSON entry contains a value other than `operating`, `defunct`, `unknown`, `sbno`, `relocated`, or `under_construction`, THE triage-status script SHALL print an error for that entry to stderr and skip it without writing to the database.
7. WHEN a row's `status` is changed to `defunct` or `relocated`, THE triage-status script SHALL set `review_state = 'needs_review'` and `needs_review_reason = 'status_changed_needs_admin_confirm'`; WHEN changed to any other valid value, it SHALL set `review_state = 'active'`.
8. WHEN the apply pass completes, THE triage-status script SHALL print a summary: total input entries, entries skipped (no `resolution`), entries skipped (unknown coaster id), entries skipped (invalid status), and entries successfully applied.

---

### Requirement 11: Completeness QA — Golden Ticket Coverage

**User Story:** As a developer, I want a static Golden Ticket fixture and a check script that reports catalog coverage against the Top 50 Steel / Top 25–50 Wood lists, so that no famous coaster is silently missing or misnamed before launch.

#### Acceptance Criteria

1. THE Golden_Ticket_Fixture SHALL be a hand-transcribed JSON file at `scripts/qa/fixtures/golden-ticket-2025.json` containing exactly 50 steel entries and 50 wood entries from the 2025 Amusement Today Golden Ticket Awards top lists, with fields `rank` (integer), `category` (`"steel"` or `"wood"`), `name` (string), `park` (string), and `country` (string).
2. THE Coverage_Script SHALL be implemented at `scripts/src/qa/check-golden-ticket-coverage.ts` and SHALL be a read-only script — it SHALL never write to the database.
3. THE Coverage_Script SHALL classify each fixture entry as: `FOUND` — exact case-insensitive name match exists in `coasters` at a park whose name matches the fixture's `park` field (case-insensitive); `POSSIBLE` — no exact match but `word_similarity(coaster.name, fixture.name) >= 0.5` exists at the matching park; `MISSING` — no match meeting either threshold at the matching park.
4. THE Coverage_Script SHALL print one line per fixture entry in the format `[STATUS] #<rank> <category> — <name> @ <park>`.
5. THE Coverage_Script SHALL exit with code `1` when any entry is `MISSING`, and exit with code `0` when all entries are `FOUND` or `POSSIBLE`. Before exiting, it SHALL print a one-line summary: total entries, count FOUND, count POSSIBLE, count MISSING.
6. THE Scripts_Package SHALL expose a `check-coverage` npm script in `scripts/package.json` that runs the Coverage_Script.

---

### Requirement 12: Scripts Package Infrastructure

**User Story:** As a developer, I want the scripts package extended with the necessary dependencies, a Supabase admin client, and a unified TypeScript config, so that all pipeline scripts share a consistent, type-safe foundation.

#### Acceptance Criteria

1. THE Scripts_Package SHALL add `openai`, `zod`, and `@supabase/supabase-js` as dependencies in `scripts/package.json` with exact pinned versions (no `^` or `~` range prefixes).
2. THE Scripts_Package SHALL provide a shared Supabase admin client at `scripts/src/db/client.ts` that reads `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from environment variables and exports a named `supabaseAdmin` instance.
3. IF `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` is absent or set to an empty string at module load time, THE Scripts_Package SHALL print `"Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set"` to stderr and call `process.exit(1)` before constructing the Supabase client.
4. THE `scripts/tsconfig.json` `include` field SHALL contain `"./src/**/*.ts"` in addition to any root-level `.ts` files, so all pipeline source files are type-checked by `npm run typecheck`.
5. THE Scripts_Package SHALL use TypeScript strict mode (`"strict": true` in `tsconfig.json`).
6. WHEN `npm run typecheck` is run from `scripts/`, THE Scripts_Package SHALL produce zero TypeScript errors across all pipeline source files.

---

### Requirement 13: Prompts and Task Functions

**User Story:** As a developer, I want the LLM prompts and their corresponding typed task functions defined in dedicated modules, so that prompt text is version-controlled and not scattered across batch scripts.

#### Acceptance Criteria

1. THE Scripts_Package SHALL define the normalization system prompt as a named export `NORMALIZATION_SYSTEM_PROMPT` in `scripts/src/llm/prompts.ts`.
2. THE Scripts_Package SHALL define the adjudication system prompt as a named export `ADJUDICATION_SYSTEM_PROMPT` in `scripts/src/llm/prompts.ts`.
3. THE Scripts_Package SHALL export a `normalizeOne` function from `scripts/src/llm/tasks.ts` that accepts a single `{ coaster_id: string, name: string, park_name: string }` record, calls the LLM, validates the response with the normalization Zod schema, and returns a typed `NormalizationResult`; IF validation fails after retry, it SHALL throw an error rather than return a partial result.
4. THE Scripts_Package SHALL export a `normalizeBatch` function from `scripts/src/llm/tasks.ts` that accepts an array of records, sends them as a single batch call to the LLM, validates each item individually with the normalization Zod schema, and applies the retry logic from Requirement 3; IF any item fails validation after retry, the entire batch SHALL throw rather than return a partial result.
5. THE Scripts_Package SHALL export an `adjudicateOne` function from `scripts/src/llm/tasks.ts` that accepts a single pair record with both coasters' full fields, calls the LLM, validates the response with the adjudication Zod schema, and returns a typed `AdjudicationResult`; IF validation fails after retry, it SHALL throw.
6. THE normalization Zod schema SHALL enforce: `coaster_id: string`, `cleaned_name: string`, `issue: z.enum(["park_name_embedded", "truncated", "abbreviation", "none"])`, `confidence: z.number().min(0).max(1)`, `reasoning: z.string().max(200)`.
7. THE adjudication Zod schema SHALL enforce: `pair_id: string`, `verdict: z.enum(["duplicate", "not_duplicate", "needs_human"])`, `confidence: z.number().min(0).max(1)`, `reasoning: z.string().max(200)`.
