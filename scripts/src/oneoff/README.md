# One-off scripts

Data-quality and maintenance scripts that were written for a specific past task and are kept
for reference / re-runs. They are **not** wired into `package.json` — run them directly:

```bash
cd scripts
npx tsx src/oneoff/<name>.ts
```

| Script                                   | Purpose (original task)                                                           |
| ---------------------------------------- | --------------------------------------------------------------------------------- |
| `normalize-names.ts`                     | LLM-assisted coaster-name normalization against the DB (Aug 2026 catalog cleanup) |
| `check-coverage.ts`                      | Data-completeness report → `data/coverage/report.txt` + `top_coasters.txt`        |
| `build-coverage-queue.ts`                | Triage queue from the coverage report → `data/coverage/queue*.json/md`            |
| `backfill-park-locations.ts`             | One-time park lat/lng/city backfill                                               |
| `fix-missing-regions-and-non-english.ts` | One-time park region / non-English name fixes                                     |
| `render-og-previews.ts`                  | Render mock rider OG cards → `docs/social-preview/rider-og-previews/` (Phase 9.4) |
| `llm/`                                   | LM Studio / OpenAI client + prompts + task functions used by the above            |
| `db/`                                    | Shared Supabase admin client used by the above                                    |

Hand-edited inputs and generated outputs of the coverage effort live in `data/coverage/`
(generated artifacts are gitignored — see `data/coverage/README.md`).

If a script here becomes useful again, promote it back into `package.json` scripts.
