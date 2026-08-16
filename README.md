# CoasterRank

A multi-user webapp where roller-coaster enthusiasts rank the coasters they've ridden, and every visitor sees a live global ranking derived from everyone's input.

## Vision

- **Users** sign up, mark the coasters they've ridden, and drag-sort them into a personal ranked list.
- **Everyone** (no login required) sees a live public board of the world's coasters ordered by a principled, community-driven score — not a popularity contest, not a simple average.
- The ranking is computed by a **Bradley-Terry** model fed from pairwise wins implied by each user's ordered list. Each user contributes roughly one unit of influence regardless of list length, so a casual fan's voice isn't drowned out by someone who's ridden 500 coasters.
- The reference catalog of coasters starts from an open, public-domain dataset and grows via an admin + community submission queue (RCDB data is intentionally avoided for licensing reasons).

## Status

Phase 0 (scaffold) in progress. See [`docs/PLAN.md`](docs/PLAN.md) for the full lifecycle plan (architecture, data model, algorithm, environment, deployment, phasing).

## Tech stack

- **Frontend**: React + Vite + TypeScript SPA (Tailwind CSS)
- **Lint/format**: oxlint + Prettier
- **Data / Auth**: Supabase (Postgres + PostgREST + Auth + Row-Level Security) — dedicated instance, develop against prod
- **Ranking**: Bradley-Terry batch job as a Supabase Edge Function, scheduled via pg_cron
- **Hosting**: Netlify (SPA, auto-deploy on push to `main`)
- **CI/CD**: GitHub Actions (quality gates on PRs; Supabase migrations + function deploy on merge to `main`)
- **Tests**: Vitest

## Getting started

Prereqs: Node 22+, npm, the Supabase CLI (`npm i -g supabase`).

```bash
# 1. Copy env and fill in values from the Supabase dashboard (just-in-time before Phase 1)
cp .env.example .env

# 2. Install SPA deps and run the dev server (talks to prod Supabase under RLS)
cd app
npm install
npm run dev          # http://localhost:5173

# 3. Quality gates (run before every commit; CI runs the same)
npm run typecheck && npm run lint && npm run test:run && npm run format:check
```

See [`AGENTS.md`](AGENTS.md) for the full command reference, environment rules, multi-account Supabase CLI auth, and operational runbooks.

## Docs

- [`docs/PLAN.md`](docs/PLAN.md) — authoritative project plan and decision log

## License

TBD.