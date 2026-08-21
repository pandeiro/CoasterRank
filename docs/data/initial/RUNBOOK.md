# CoasterRank — Track A: Human Operator Runbook

This document is the step-by-step guide for a human executing the Track A data quality pipeline. Agents write and submit the code; this runbook tells you what to do, in what order, and what decisions only a human can make.

**Before you start:** ensure your `.env` is populated with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, and that LM Studio is running with **Qwen3.8-27B** loaded and the Developer server enabled (default port 1234).

---

## Human gates at a glance

| Step | What the human does |
|---|---|
| After each agent PR | Review and merge the PR — schema changes and code land only via merged PRs |
| Phase 1 | Spot-check LLM normalization output before applying |
| Phase 2 | Run `review-parks` interactively; decide each merge or rejection |
| Phase 3 | Run `review-manufacturers` interactively; decide each merge or rejection |
| Phase 5 | Run `review-dupes` interactively; decide each coaster merge or rejection |
| Phase 7 | Fill in the status triage JSON with research findings; apply it |
| Phase 8 | Hand-transcribe the Golden Ticket fixture; investigate any `MISSING` entries |
| Done | Verify definition-of-done checklist (end of this document) |

---

## Phase 0 — Schema migration

**Who does this:** the agent creates the migration file and opens a PR.

**Your job:**
1. Review the PR diff — confirm it matches the migration SQL in the design doc.
2. Check that `supabase db push` is **not** in the PR's local run instructions; it should only run via CI after merge.
3. Merge the PR. CI applies the migration automatically.
4. Verify the migration landed: open the Supabase dashboard → Table Editor and confirm the new columns on `coasters` and the three new candidate tables exist.

---

## Phase 1 — Name normalization

**Who does this:** the agent writes `normalize-names.ts` and opens a PR.

**Your job:**
1. Review and merge the PR.
2. Run a dry-run first to see what the LLM would change:
   ```bash
   cd scripts
   npm run normalize-names
   ```
3. Scan the `[DRY-RUN]` output. Check for obviously wrong suggestions — the model should only clean formatting, not rename coasters. Pay attention to `abbreviation` verdicts in particular.
4. If the output looks reasonable, apply:
   ```bash
   npm run normalize-names -- --apply
   ```
5. Check the summary counts. A large number of `name updated` entries relative to total is expected (park-name-embedded is common in the CC0 data). A large number of `parse failures` is not — investigate if >5% fail.

---

## Phase 2 — Parks dedup

**Who does this:** the agent writes `generate-park-candidates.ts`, `adjudicate-parks.ts`, and `review-parks.ts`, and opens a PR.

**Your job:**
1. Review and merge the PR.
2. Generate candidates (dry-run first):
   ```bash
   cd scripts
   npm run generate-park-candidates
   # review the count, then:
   npm run generate-park-candidates -- --apply
   ```
3. Run the LLM adjudication pass:
   ```bash
   npm run adjudicate-parks -- --apply
   ```
   This labels each candidate pair as `duplicate`, `not_duplicate`, or `needs_human`. It doesn't merge anything — that's your job.
4. Run the interactive review:
   ```bash
   npm run review-parks
   ```
   For each pair:
   - The LLM verdict and reasoning are shown alongside the raw data — use them as a triage aid, not a final answer.
   - Press **`y`** to confirm a merge (you'll be prompted for a reason), **`n`** to reject, **`s`** to skip for later.
   - A confirmed merge re-points all `coasters.park_id` rows from the duplicate to the canonical park and deletes the duplicate.
   - When in doubt, press `n` — a false negative is a skipped merge; a false positive silently loses a park record.
5. Re-run with `--filter 0.85` first to clear the high-confidence cases quickly, then drop the threshold to review the remainder.

**Stop condition:** all `park_dupe_candidates` rows have `resolved = true` before moving to Phase 4.

---

## Phase 3 — Manufacturers dedup

**Who does this:** the agent writes `generate-manufacturer-candidates.ts`, `adjudicate-manufacturers.ts`, and `review-manufacturers.ts`, and opens a PR.

**Your job:** same pattern as Phase 2.
```bash
npm run generate-manufacturer-candidates
npm run generate-manufacturer-candidates -- --apply
npm run adjudicate-manufacturers -- --apply
npm run review-manufacturers
```

Manufacturer dedup is usually faster — 101 rows, typically few near-duplicates. Common cases: "Vekoma" vs "Vekoma Rides Manufacturing", "S&S" vs "S&S Worldwide". The canonical record is whichever has richer data.

**Phases 2 and 3 can run in parallel** if two people are available.

**Stop condition:** all `manufacturer_dupe_candidates` rows have `resolved = true` before moving to Phase 4.

---

## Phase 4 — Coaster duplicate candidate generation

**Who does this:** the agent writes `generate-dupe-candidates.ts`, and the PR is already open from earlier tasks.

**Your job:**
1. Confirm Phases 2 and 3 are fully resolved (check `review-parks --filter 0` shows "No pairs match" and same for manufacturers).
2. Run:
   ```bash
   npm run generate-dupe-candidates
   # review counts, then:
   npm run generate-dupe-candidates -- --apply
   ```
3. Check the summary. Pass 1 (high-confidence, >0.7) should be a small number; Pass 2 (0.45–0.7) will be larger. A combined total in the dozens to low hundreds is expected for ~1,087 coasters at 279 parks.

---

## Phase 5 — LLM adjudication (coasters)

**Who does this:** the agent; `adjudicate-dupes.ts` is already merged.

**Your job:**
```bash
npm run adjudicate-dupes -- --apply
```
Check the summary. `needs_human` count should be a minority. A large `parse failure` count means LM Studio may not be responding — check the server is still running and the model is loaded.

This step is fully automated. No human decisions required until Phase 6.

---

## Phase 6 — Coaster merge review

**Who does this:** you.

```bash
npm run review-dupes
```

Same keystroke interface as the park/manufacturer review CLIs. Priority order: high-confidence LLM duplicates (`>= 0.85`) first, then by similarity score.

**Decision guidance:**
- Same name, same park, one record has null fields where the other has data → almost certainly a duplicate from two import sources. Merge; keep the richer record as canonical.
- Same name, different parks → **not** a duplicate. Reject.
- Similar names (e.g. "Twister" vs "Twister II") at the same park → verify carefully. Usually not a duplicate.
- The `user_rides` guard will block any merge where a coaster has user data. This shouldn't happen pre-launch, but if it does, the CLI will explain and mark it `needs_human`.

Run `npm run review-dupes --dry-run` first to get a count of what's waiting.

---

## Phase 7 — Status triage (parallel, can run any time after Phase 0)

**Who does this:** you, with web research.

1. Generate the report:
   ```bash
   npm run triage-status
   ```
   This writes `scripts/output/status-triage-<timestamp>.json` — one entry per coaster with `status = 'under_construction'` or `'unknown'`.

2. Open the JSON. For each entry, search for `[name] [park] opened` or `[name] [park] status` to find current evidence.

3. Fill in the `resolution` field for each entry you can resolve:
   ```json
   {
     "id": "uuid",
     "resolution": {
       "status": "operating",
       "opening_date": "2024-06-15",
       "confidence": 0.8
     }
   }
   ```
   Leave entries without a `resolution` field if you can't find reliable evidence.

4. Apply your research:
   ```bash
   npm run triage-status -- --apply --input scripts/output/status-triage-<timestamp>.json
   ```

5. Entries changed to `defunct` or `relocated` will be flagged `needs_review` automatically — verify these in the admin dashboard before launch.

---

## Phase 8 — Completeness QA

**Who does this:** you (fixture creation); the agent (script implementation).

1. **Hand-transcribe the Golden Ticket fixture.** The agent creates the file stub; you fill in the data:
   - Go to the 2025 Amusement Today Golden Ticket Awards results (September 2025 issue).
   - Transcribe the Top 50 Steel Coasters and Top 50 Wood Coasters into `scripts/qa/fixtures/golden-ticket-2025.json`.
   - Each entry: `rank`, `category` ("steel" or "wood"), `name`, `park`, `country`.

2. Run the coverage check:
   ```bash
   npm run check-coverage
   ```

3. Review the output:
   - `[FOUND]` — coaster is in the catalog, name matched exactly. ✓
   - `[POSSIBLE]` — fuzzy match found. Eyeball the suggested match — it's likely a normalization miss from Phase 1. If the coaster is present but misnamed, fix the name directly in the admin dashboard and re-run.
   - `[MISSING]` — coaster is not in the catalog. Add it manually via the admin dashboard (Submit → Approve workflow), then re-run until the check passes clean.

4. The script exits with code 1 if any entry is `MISSING` — aim for a clean exit 0 before launch.

---

## Definition of Done

Work through this checklist before declaring Track A complete:

- [ ] Migration PR merged; new columns and tables visible in Supabase dashboard
- [ ] All `park_dupe_candidates` rows have `resolved = true`
- [ ] All `manufacturer_dupe_candidates` rows have `resolved = true`
- [ ] All `coaster_dupe_candidates` rows have `resolved = true`
- [ ] No `coasters` row has `review_state = 'active'` and `source = 'open-csv'` (all have been through the normalization pass)
- [ ] No `coasters` row has `status in ('under_construction', 'unknown')` without either a resolved status or `review_state = 'needs_review'`
- [ ] `npm run check-coverage` exits 0 (no `MISSING` entries)
- [ ] `scripts/output/` contains a completed triage report for sign-off reference

---

## Troubleshooting

**LM Studio not responding:**
- Check the Developer server is enabled (LM Studio → Developer tab → toggle on).
- Confirm Qwen3.8-27B is loaded (not just downloaded).
- Try `curl http://localhost:1234/v1/models` — should return model info.

**Large number of LLM parse failures:**
- Usually means the model is still loading or swapped out. Wait 30s and retry with `--reprocess`.
- If persistent, reduce `--batch-size` to 1 for normalization to isolate which records cause issues.

**`supabase db push` ran locally by mistake:**
- It's idempotent for `IF NOT EXISTS` and `add column if not exists` DDL, so a double-apply is usually harmless.
- Verify no rows were unexpectedly updated (the `update coasters set review_state` statement uses `where source = 'open-csv'` and is also idempotent).
- Flag in your PR description that the migration was pre-applied locally.

**Merge CLI transaction failure:**
- The CLI prints the error and leaves the candidate row unchanged. Safe to retry after investigating the error.
- Most common cause: the canonical coaster ID was itself deleted in an earlier merge. Find the correct canonical via the `coaster_merge_log` and update the candidate row manually.
