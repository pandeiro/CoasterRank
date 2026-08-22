# CoasterRank — Track A: MVP Data Quality Plan

**Scope:** this document specs Track A only — the pre-launch cleanup of the existing ~1,087-record catalog. Track B's long-term provenance/candidate-staging architecture is documented separately (`DATA_STRATEGY_PLAN.md`) and is referenced here only where it shapes a Track A design choice.

---

## 1. Operating constraints (carried over, kept short)

- **`user_rides` is empty.** No live user data can be orphaned by a merge, ID change, or slug change. This is the single biggest lever on how aggressive Track A can be, and it disappears at launch — spend it deliberately.
- **RCDB**: leads only, never a source of record. Same rule applies to any RCDB-mirror lookups used during this pass.
- Auto-apply is fine for status changes backed by one official/current source; **merges, deletions, and park re-assignments stay human-reviewed** regardless of confidence.
- Success is qualitative ("no famous coasters missing or duplicated"), not a coverage percentage.

---

## 2. Schema migration

```sql
-- Coasters: review metadata
alter table public.coasters
  add column if not exists last_verified_at timestamptz,
  add column if not exists confidence numeric check (confidence between 0 and 1),
  add column if not exists review_state text not null default 'active'
    check (review_state in ('active','needs_review','possibly_duplicate','possibly_outdated','archived')),
  add column if not exists needs_review_reason text,
  add column if not exists rcdb_url text;  -- convenience external link only, never bulk-scraped

-- Fuzzy matching
create extension if not exists pg_trgm;
create index if not exists coasters_name_trgm_idx on public.coasters using gin (name gin_trgm_ops);

-- Merge audit trail (also doubles as ground-truth data for Track B's merge-assist pilot)
create table public.coaster_merge_log (
  id uuid primary key default gen_random_uuid(),
  duplicate_coaster_id uuid not null,
  canonical_coaster_id uuid not null references public.coasters (id),
  merged_by text,
  reason text,
  created_at timestamptz not null default now()
);

-- Duplicate candidate staging (populated by pg_trgm, resolved by LLM adjudication + human review)
create table public.coaster_dupe_candidates (
  id uuid primary key default gen_random_uuid(),
  coaster_a_id uuid not null references public.coasters (id),
  coaster_b_id uuid not null references public.coasters (id),
  similarity numeric not null,
  match_basis text not null,              -- 'same_park' | 'same_country'
  verdict text,                           -- 'duplicate' | 'not_duplicate' | 'needs_human'
  verdict_confidence numeric,
  verdict_reasoning text,
  resolved boolean not null default false,
  reviewed_by text,
  created_at timestamptz not null default now()
);
```

Same column names as the full Track B schema — nothing here needs re-migrating later.

---

## 3. Task sequencing

| Phase | Task | Depends on | Tooling | Output |
|---|---|---|---|---|
| 0 | Ship migration; mark legacy import `needs_review`, `confidence = 0.3` | — | Supabase migration | Updated `coasters` |
| 1 | Build model-eval harness + fixture set; run the 3-model shortlist; pick a model | Phase 0 (fixtures are drawn from real records) | LM Studio + `scripts/` TS harness | Chosen model, documented rationale |
| 2 | Name normalization pass over all coasters | Phase 1 | LM Studio + TS batch script | Cleaned `name`, `needs_review` on low-confidence cases |
| 3 | `pg_trgm` candidate-pair generation (two-tier threshold) on normalized names | Phase 2 | SQL script | `coaster_dupe_candidates` rows |
| 4 | LLM adjudication pass over candidate pairs | Phase 3 | LM Studio + TS script | `verdict`/`confidence`/`reasoning` filled in |
| 5 | Human review of `needs_human`/low-confidence verdicts; apply accepted merges | Phase 4 | Manual (admin), or a small review script | Duplicates removed, `coaster_merge_log` populated |
| 6 | Status triage for `under_construction`/`unknown` | Independent — can run in parallel with 1–5 | Manual/web search | `status`, `opening_date`, `last_verified_at` updated |
| 7 | Completeness QA against Golden Ticket Awards + Wikidata recent openings | Best run after 2–6, so the catalog being checked is already clean | `scripts/qa` TS script + fixtures | Coverage report; missing coasters added |

Phase 6 has no dependency on the LLM tooling at all — if there are two people working this, it's the natural thing to split off and run concurrently with 1–5.

---

## 4. Tooling: LM Studio + the `scripts/` subproject

LM Studio's local server exposes an OpenAI-compatible endpoint (default `http://localhost:1234/v1`) once enabled in its Developer tab. Since `scripts/` is already a standalone Node project, the client is just the standard `openai` SDK pointed at that URL:

```typescript
// scripts/src/llm/client.ts
import OpenAI from "openai";

export const lmStudio = new OpenAI({
  baseURL: "http://localhost:1234/v1",
  apiKey: "lm-studio", // unused by LM Studio, but the SDK requires a non-empty string
});
```

A few practical notes worth building in from the start rather than discovering mid-run:

- **LM Studio runs one loaded model at a time** in the common case. For the harness (Phase 1), the practical pattern is: load model A in the LM Studio GUI, run the harness against it, swap to model B, re-run, compare result files afterward — not a single script juggling three models simultaneously.
- **Structured output.** Prefer LM Studio's `response_format: { type: "json_schema", ... }` when the loaded model supports it; not all local models honor JSON-schema constraints reliably. Regardless of what the server enforces, **validate with Zod on the client side and retry once on failure** before falling back to `needs_review` — this failure mode should be rare but not silent.
- **Quantization matters here more than usual.** This pass drives merge/rename decisions, so don't drop below `Q4_K_M` for any of the shortlisted models even if a smaller quant would run faster — structured-output reliability degrades noticeably below that.
- **Batch size is an open question, test it in the harness.** Batching 10–20 records per call is faster but risks index cross-talk in smaller local models (record 7's answer bleeding into record 8's slot); one-record-per-call is slower but more reliable. Phase 1's harness should test both and let the accuracy numbers decide, rather than assuming.
- **No deadline pressure on runtime.** Since the site isn't live, there's no reason to over-optimize for speed over accuracy — if the reliable configuration takes an overnight run across ~1,087 records, that's a fine trade.
- Reads/writes go through `@supabase/supabase-js` using the **service-role key** (this is an internal script, not a client the RLS-gated `anon`/`authenticated` roles need to touch).

---

## 5. Model selection: shortlist and harness

### 5.1 Shortlist (as of Aug 2026 — this list has a short shelf life, re-check before relying on it)

| Model | Type | Notes |
|---|---|---|
| Qwen3.8-27B | Dense, Apache 2.0 | Newest open Qwen (Aug 5 2026 release); your original pick, and it's current |
| Qwen3.6-27B | Dense, Apache 2.0 | Predecessor; holds the more thoroughly-published benchmark record at this size |
| Qwen3-30B-A3B | MoE (30B total / 3B active), Apache 2.0 | Potential speed win on Apple Silicon unified memory; untested reliability on LM Studio specifically |

A Gemma 4 variant is worth a 4th slot if you want a non-Qwen comparison point, but note its license is the Gemma Terms, not Apache 2.0 — almost certainly fine for a purely internal tool with no redistribution, but worth a one-line gut-check given this project is already careful about licensing elsewhere (OSM/ODbL).

### 5.2 Why a harness, concretely

None of the published benchmarks for these models measure the actual task — pulling a clean name out of a messy scraped string, or judging whether two records describe the same physical ride. The models are close enough on general capability that the only way to know which wins *this* task is to run all three against the same real data and score them.

### 5.3 Fixture set

Build `scripts/qa/fixtures/model-eval-set.json`: 25–40 hand-labeled examples pulled from **real records in the current catalog**, not invented synthetic ones — the point is to reflect actual failure modes, not textbook cases. Split roughly:

**Normalization cases** (~15):
- Park name embedded in coaster name
- Truncated name
- Stray abbreviation
- A handful of already-clean names (negative examples — these measure the false-positive "fixing" rate, which is just as important as catching real issues)

**Adjudication cases** (~15–20):
- True duplicates from the same coaster via two different legacy sources
- Same name, *different* parks — must **not** be flagged (the schema explicitly allows this; it's the easiest wrong-merge to make)
- Genuinely similar-but-distinct coasters at the same park (e.g. two family coasters with similar generic names)
- At least 2–3 deliberately ambiguous cases that should resolve to `needs_human`

```typescript
// scripts/src/qa/run-model-eval.ts
import { readFileSync, writeFileSync } from "node:fs";
import { lmStudio } from "../llm/client";
import { normalizeOne, adjudicateOne } from "../llm/tasks";

type Fixture = { id: string; task: "normalize" | "adjudicate"; input: unknown; expected: unknown };

const MODEL_ID = process.env.LM_STUDIO_MODEL_ID ?? "unknown-model"; // whatever's currently loaded
const fixtures: Fixture[] = JSON.parse(
  readFileSync("scripts/qa/fixtures/model-eval-set.json", "utf8")
);

const results = [];
for (const fx of fixtures) {
  const start = performance.now();
  const output = fx.task === "normalize" ? await normalizeOne(fx.input) : await adjudicateOne(fx.input);
  results.push({ id: fx.id, task: fx.task, output, expected: fx.expected, ms: performance.now() - start });
}

writeFileSync(`scripts/qa/results/${MODEL_ID}.json`, JSON.stringify(results, null, 2));
```

Run this once per model (swap the loaded model in LM Studio between runs, set `LM_STUDIO_MODEL_ID` to match), then a small separate scorer compares the three `results/*.json` files.

### 5.4 Decision rule

Score each model on:
1. **Duplicate-verdict precision** — weight this heaviest. A false-positive merge silently loses data; a false negative just sits as `possibly_duplicate` for a human, which is the safe failure direction.
2. Exact/near-match rate on `cleaned_name` and `issue` classification.
3. Wall-clock time per record, measured during the harness, not assumed.

**Pick the smallest/fastest model that clears an acceptable precision bar** (a reasonable starting bar: ≥95% precision on duplicate verdicts) rather than defaulting to whichever scores highest overall — at ~1,087 records, throughput matters, and "best on paper" and "best for this task, at acceptable speed" aren't guaranteed to be the same model.

---

## 6. `pg_trgm` blocking and candidate generation

Never compare every coaster to every other coaster — block by park first, since a real duplicate pair overwhelmingly shares a park:

```sql
-- Pass 1: high-confidence same-park candidates
insert into public.coaster_dupe_candidates (coaster_a_id, coaster_b_id, similarity, match_basis)
select a.id, b.id, word_similarity(a.name, b.name), 'same_park'
from public.coasters a
join public.coasters b
  on a.park_id = b.park_id and a.id < b.id
where word_similarity(a.name, b.name) > 0.7;

-- Pass 2: wider recall sweep, same blocking, lower threshold
insert into public.coaster_dupe_candidates (coaster_a_id, coaster_b_id, similarity, match_basis)
select a.id, b.id, word_similarity(a.name, b.name), 'same_park'
from public.coasters a
join public.coasters b
  on a.park_id = b.park_id and a.id < b.id
where word_similarity(a.name, b.name) between 0.45 and 0.7
  and not exists (
    select 1 from public.coaster_dupe_candidates c
    where c.coaster_a_id = a.id and c.coaster_b_id = b.id
  );
```

Two notes on the specifics:

- **`word_similarity`, not `similarity`.** Standard `pg_trgm` `similarity()` penalizes length differences harshly, which directly punishes the truncated-name case ("Fury" vs. "Fury 325") that's one of the things this pass is meant to catch. `word_similarity()` is more forgiving for partial matches and is the better fit here.
- **Two-tier threshold.** A high-confidence first pass (>0.7) keeps the initial adjudication batch small and manageable; a second, lower-threshold pass (0.45–0.7) — still blocked by park, so it stays cheap — widens recall for the messier cases without flooding the candidate set from the start.

Run pass 1/2 **after** the normalization pass (Phase 2), not before — matching on cleaned names is the whole point.

---

## 7. LLM prompts

### 7.1 Normalization prompt (Phase 2)

```
SYSTEM:
You are a data-cleaning assistant for a roller coaster database. You will be given
a batch of records, each with a raw coaster name and the name of the park it
belongs to. For each record, determine whether the name has a formatting issue:

- park_name_embedded: the park's name (or an abbreviation of it) appears inside
  the coaster name, e.g. "Fury 325 - Carowinds" when the park is already "Carowinds"
- truncated: the name appears to be cut off (a scraper artifact), e.g. a name
  ending mid-word or dropping a known numeric/model suffix
- abbreviation: the name uses a non-standard abbreviation that should be expanded
  if the expansion is unambiguous from context
- none: the name has no issue

Rules:
- Only fix FORMATTING. Never change what coaster the record refers to.
- If you are not confident the name has an issue, classify it as "none" and use
  a low confidence score rather than guessing a change.
- Do not invent facts. Base cleaned_name only on the input given.
- Output ONLY a JSON array matching the schema below. No prose, no markdown fences.

Schema per record:
{
  "coaster_id": string,
  "cleaned_name": string,
  "issue": "park_name_embedded" | "truncated" | "abbreviation" | "none",
  "confidence": number (0-1),
  "reasoning": string (one short sentence)
}

Examples:

Input: {"coaster_id": "ex1", "name": "Fury 325 - Carowinds", "park_name": "Carowinds"}
Output: {"coaster_id": "ex1", "cleaned_name": "Fury 325", "issue": "park_name_embedded", "confidence": 0.95, "reasoning": "Park name appended after a separator, redundant with park_name field."}

Input: {"coaster_id": "ex2", "name": "Millennium Forc", "park_name": "Cedar Point"}
Output: {"coaster_id": "ex2", "cleaned_name": "Millennium Force", "issue": "truncated", "confidence": 0.85, "reasoning": "Name appears cut off mid-word; well-known coaster at this park."}

Input: {"coaster_id": "ex3", "name": "Steel Vengeance", "park_name": "Cedar Point"}
Output: {"coaster_id": "ex3", "cleaned_name": "Steel Vengeance", "issue": "none", "confidence": 0.98, "reasoning": "Name is already clean."}

USER:
[{"coaster_id": "...", "name": "...", "park_name": "..."}, ...]
```

```typescript
// scripts/src/llm/tasks.ts
import { z } from "zod";
import { lmStudio } from "./client";
import { NORMALIZATION_SYSTEM_PROMPT } from "./prompts";

const NormalizationResult = z.object({
  coaster_id: z.string(),
  cleaned_name: z.string(),
  issue: z.enum(["park_name_embedded", "truncated", "abbreviation", "none"]),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().max(200),
});
const NormalizationBatch = z.array(NormalizationResult);

export async function normalizeBatch(
  records: { coaster_id: string; name: string; park_name: string }[]
) {
  const completion = await lmStudio.chat.completions.create({
    model: process.env.LM_STUDIO_MODEL_ID!,
    temperature: 0,
    messages: [
      { role: "system", content: NORMALIZATION_SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify(records) },
    ],
    response_format: { type: "json_object" },
  });

  const raw = completion.choices[0].message.content ?? "[]";
  const parsed = NormalizationBatch.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    // one retry with a stricter reminder appended; on second failure,
    // mark every record in the batch needs_review and move on — never guess.
  }
  return parsed;
}
```

### 7.2 Adjudication prompt (Phase 4)

```
SYSTEM:
You are a duplicate-detection reviewer for a roller coaster database. You will be
given a pair of candidate coaster records. Decide whether they represent the same
physical roller coaster.

Rules:
- Base your verdict ONLY on the fields provided. Do not use outside knowledge
  about a coaster you think you recognize — go strictly off the given data.
- Two records with the SAME NAME at DIFFERENT PARKS are usually NOT duplicates.
  Coaster names are commonly reused across parks (e.g. many parks have a coaster
  simply named "Twister" or "Cyclone").
- If the records disagree on a field that can't both be true for one physical
  coaster (e.g. materially different height, different manufacturer, or opening
  dates decades apart), lean toward not_duplicate unless the name/park match is
  very strong.
- If you are genuinely unsure, output "needs_human" — do not guess.
- Output ONLY a JSON object matching the schema below. No prose, no markdown fences.

Schema:
{
  "pair_id": string,
  "verdict": "duplicate" | "not_duplicate" | "needs_human",
  "confidence": number (0-1),
  "reasoning": string (one short sentence)
}

Examples:

Input: {"pair_id": "ex1",
  "a": {"name": "Millennium Force", "park": "Cedar Point", "manufacturer": "Intamin", "opening_date": "2000-05-13", "height_m": 94},
  "b": {"name": "Millennium Force", "park": "Cedar Point", "manufacturer": null, "opening_date": "2000", "height_m": null},
  "similarity": 1.0}
Output: {"pair_id": "ex1", "verdict": "duplicate", "confidence": 0.95, "reasoning": "Identical name and park, no conflicting fields, second record simply has less data."}

Input: {"pair_id": "ex2",
  "a": {"name": "Twister", "park": "Knoebels", "manufacturer": "Herbert Schmeck", "opening_date": "1999-01-01", "height_m": 25},
  "b": {"name": "Twister", "park": "Elitch Gardens", "manufacturer": null, "opening_date": null, "height_m": null},
  "similarity": 1.0}
Output: {"pair_id": "ex2", "verdict": "not_duplicate", "confidence": 0.9, "reasoning": "Same name but different parks; common name reuse, not the same physical ride."}

Input: {"pair_id": "ex3",
  "a": {"name": "Wild Mouse", "park": "Example Park", "manufacturer": null, "opening_date": null, "height_m": null},
  "b": {"name": "Wild Mouse Jr", "park": "Example Park", "manufacturer": null, "opening_date": null, "height_m": null},
  "similarity": 0.72}
Output: {"pair_id": "ex3", "verdict": "needs_human", "confidence": 0.4, "reasoning": "Could be two distinct family coasters at the same park, or a naming variant of one; insufficient data to decide."}

USER:
{"pair_id": "...", "a": {...}, "b": {...}, "similarity": 0.0}
```

Apply logic after the pass:

- `verdict = duplicate` **and** `confidence ≥ 0.85` → auto-stage for merge, but still surface in the review queue for a quick human confirm before actually deleting (per the locked-in rule: merges stay human-approved regardless of confidence — the LLM verdict speeds up triage, it doesn't replace sign-off).
- Everything else (`not_duplicate` with low confidence, `needs_human`, or `duplicate` below the confidence bar) → sits in `coaster_dupe_candidates` with `resolved = false` for manual review.
- On confirmed merge: delete the duplicate row (`user_rides` is empty, so no FK re-pointing needed), insert into `coaster_merge_log`, set `resolved = true`.

---

## 8. Status triage (`under_construction` / `unknown`)

Unchanged in substance from the original plan — worth restating here since this doc is now the sole Track A reference:

- For each `under_construction`/`unknown` coaster: targeted search (`[name] [park] opened 2023/2024/2025/2026`, `now open`, `opening date`).
- Evidence of opening → `status = operating`, fill `opening_date`, `last_verified_at = now()`, `confidence = 0.7`, `review_state = active`.
- Evidence of cancellation/removal → `defunct`/`unknown` as appropriate, `needs_review` for admin sign-off (status changes of this kind stay human-reviewed).
- No evidence found → `unknown`, `needs_review_reason = 'no recent evidence found'`. Not launch-blocking — this is what Track B's continuous refresh eventually closes out.

This phase doesn't depend on the LLM tooling and can run in parallel with Phases 1–5.

---

## 9. Completeness QA: Golden Ticket Awards + Wikidata recent openings

### 9.1 Deriving the list

Amusement Today's Golden Ticket Awards publish an annual Top 50 Steel / Top 25–50 Wooden Coaster ranking (most recent full cycle: September 2025; next update September 2026). Because this is a small (~75-entry), stable, once-a-year list, and because bare facts — name, park, rank, year — aren't copyrightable expression, **hand-transcribe it into a static fixture** rather than building a scraper for a page that changes annually. Lower engineering cost, and it sidesteps any scraping/ToS question entirely.

```json
// scripts/qa/fixtures/golden-ticket-2025.json
[
  { "rank": 1, "category": "steel", "name": "Fury 325", "park": "Carowinds", "country": "US" },
  { "rank": 2, "category": "steel", "name": "Jurassic World VelociCoaster", "park": "Universal's Islands of Adventure", "country": "US" }
  // ...
]
```

Because the Golden Ticket voter base skews American, we recognize this geographic bias. However, rather than curating a separate manual international counterpart list, we address this skew by implementing the Wikidata/Wikipedia recent openings check (covering major international coasters opened 2021–2026). The Golden Ticket Awards list is disregarded as a representative international standard and is treated purely as a smoke test to ensure major/famous historical coaster names are covered in the catalog. Completeness for international and modern coasters is achieved via the automated Wikidata/Wikipedia new openings coverage check instead.

### 9.2 Check script

```typescript
// scripts/src/qa/check-golden-ticket-coverage.ts
import { readFileSync } from "node:fs";
import { supabaseAdmin } from "../db/client";

type GTEntry = { rank: number; category: "steel" | "wood"; name: string; park: string; country: string };

const entries: GTEntry[] = JSON.parse(
  readFileSync("scripts/qa/fixtures/golden-ticket-2025.json", "utf8")
);

for (const entry of entries) {
  const { data: matches } = await supabaseAdmin
    .from("coasters")
    .select("id, name, parks(name)")
    .textSearch("name", entry.name) // or a pg_trgm-backed RPC for fuzzy matching
    .limit(5);

  const status = !matches?.length
    ? "MISSING"
    : matches.some(m => m.name.toLowerCase() === entry.name.toLowerCase())
      ? "FOUND"
      : "POSSIBLE";

  console.log(`[${status}] #${entry.rank} ${entry.category} — ${entry.name} @ ${entry.park}`);
}
```

This is a **report generator, never a mutator** — it doesn't write to the database. `MISSING` entries get investigated and added by hand; `POSSIBLE` entries get eyeballed for a name-mismatch (a good chance to catch a normalization miss from Phase 2). Worth noting for later: this script has a natural home as a light annual job even in Track B's world, since the source list itself only updates once a year — not something to build out now, just a reason this isn't throwaway effort.

---

## 10. Design rationale notes (Track B context, kept brief)

A few Track A choices are deliberately shaped by the long-term architecture, even though Track B itself isn't being built yet:

- **LLM-as-recommender, human-as-approver** is the same posture the eventual continuous-refresh pipeline will need for automated merges — the fixture set and harness results from Phase 1 become reusable ground-truth data for that later pilot, not throwaway effort.
- **`coaster_merge_log` and `coaster_dupe_candidates`** are schema-compatible with the full provenance layer's shape, so nothing here needs to be rebuilt when Track B starts.
- **The two-tier `pg_trgm` blocking strategy** (park-first, threshold-tiered) is the same matching approach Track B's ongoing duplicate detection will reuse against newly-discovered candidates — this pass is effectively dry-running that logic against a known, bounded dataset before it has to run continuously against an unbounded one.

---

## 11. Definition of done

- Every coaster name has been through the normalization pass; no known park-embedded/truncated/abbreviated names remain unflagged.
- No duplicate pair above the high-confidence threshold remains unresolved in `coaster_dupe_candidates`.
- No `under_construction`/`unknown` record lacks either a current-evidence status or an honest `needs_review` flag.
- Golden Ticket Top Steel/Wood + the Wikidata recent openings list both come back clean (`FOUND` or accepted `POSSIBLE`) against the catalog.
- Nothing is silently presented as more certain than it is — every touched record has `last_verified_at`, `confidence`, and `review_state` reflecting what was actually established.
