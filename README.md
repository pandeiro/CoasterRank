# CoasterRank

A multi-user webapp where roller-coaster enthusiasts rank the coasters they've ridden, and every visitor sees a live global ranking derived from everyone's input.

## Vision

- **Users** sign up, mark the coasters they've ridden, and drag-sort them into a personal ranked list.
- **Everyone** (no login required) sees a live public board of the world's coasters ordered by a principled, community-driven score — not a popularity contest, not a simple average.
- The ranking is computed by a **Bradley-Terry** model fed from pairwise wins implied by each user's ordered list. Each user contributes roughly one unit of influence regardless of list length, so a casual fan's voice isn't drowned out by someone who's ridden 500 coasters.
- The reference catalog of coasters starts from an open, public-domain dataset and grows via an admin + community submission queue (RCDB data is intentionally avoided for licensing reasons).

## Status

Early development — see [`docs/PLAN.md`](docs/PLAN.md) for the full, current lifecycle plan (architecture, data model, algorithm, phasing).

## Tech stack

- **Frontend**: React + Vite + TypeScript SPA (Tailwind CSS)
- **Data / Auth**: Supabase (Postgres + PostgREST + Auth + Row-Level Security)
- **Ranking**: Bradley-Terry batch job as a Supabase Edge Function, scheduled via pg_cron
- **Tests**: Vitest

## Getting started

> Coming in Phase 0. For now, see the plan.

## Docs

- [`docs/PLAN.md`](docs/PLAN.md) — authoritative project plan and decision log

## License

TBD.