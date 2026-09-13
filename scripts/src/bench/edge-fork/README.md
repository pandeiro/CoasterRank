# Bench edge-function fork (staging-only)

A copy of `recompute-rankings` whose aggregation + Bradley-Terry fit run
inside Postgres (split across resumable RPCs), so no pair payload crosses the
gateway. This is the harness's `b-plpgsql` / `ab-combined` variant backend.

**Never deployed to prod.** The deploy workflow globs `supabase/functions/*/`
— which is why this fork lives HERE (outside the deploy path) instead of in
`supabase/functions/`. The prod function keeps its own name and shape; the
production promotion lands as a change to `recompute-rankings` itself (spec:
[`PROMOTION.md`](../../spikes/2026-09-pairwise-bench/PROMOTION.md)).

## Deploying to the disposable staging project

`supabase functions deploy` only reads from `supabase/functions/`, so copy in,
deploy against the STAGING ref, copy out:

```bash
cd /path/to/staging-worktree
cp -r scripts/src/bench/edge-fork supabase/functions/bench-recompute-plpgsql
set -a; source .env; set +a
supabase functions deploy bench-recompute-plpgsql --project-ref jsvgzvkrgodaxdutqcok
rm -rf supabase/functions/bench-recompute-plpgsql   # keep it out of the deploy glob
```

Always pass `--project-ref` explicitly and verify the ref in the banner — the
whole point is that this function has no prod presence.
