# Ad-hoc insert — Revenge of the Mummy ×3 — 2026-08-31

Direct `psql` inserts (no `decisions.json` / `coverage:apply`), following the
`park-audit-2026-08-30.md` audit-trail convention: cited sources, one row per
physical track, throwaway fetch discarded (this file is the retained record).

## Why

The DB had a single ambiguous `Other (unknown location)` row:

```
Revenge of the Mummy | revenge-of-the-mummy@other | unknown | steel | 2004-01-01 | 13.53 m / 64.37 km/h / 0 inversions | Premier Rides | open-csv
```

`Location="Other"` in `data/ext/coaster_db.csv` conflates three distinct
installations (Florida, Hollywood, Singapore). `coaster_db.csv` truncates dates
to year, `length_m` was NULL, so the row is not attributable to any one park.
Status `unknown` is stale (CSV is a 2023 snapshot).

`coverage:sweep` correctly proposed three separate `create_coaster` items
(`MISS-220 Florida`, `MISS-397 Hollywood`, `MISS-311 Singapore`) — the sweep
after the park-audit (`2026-08-31T00:35Z`) still lists all three as open with
`park_create=False, park_exists=t`. Inserting them here closes that queue
without the `decisions.json` ceremony.

The orphan `other/revenge-of-the-mummy` is left in place for now — it will be
cleaned up by the general Other-bucket sweep (decisions workflow or a later
ad-hoc delete) once the three canonical rows are verified on the board. It is
`unknown` and invisible on the operating-default board, so no user impact.

## Sources (all CC BY-SA or public, cross-checked)

- Coasterpedia — `Revenge of the Mummy (Universal Studios Florida)` — https://coasterpedia.net/wiki/Revenge_of_the_Mummy_(Universal_Studios_Florida) — 44.4 ft / 40 mph / 2,200 ft (670 m) / 0 inversions / Steel Launched Enclosed / Premier Rides / 3 LIM launches / Opened May 21 2004 / Status Operating / Section New York / Replaced Kongfrontation / Photo 2026-03-02 (running). Last edited 2026-08-20.
- Coasterpedia — `Revenge of the Mummy (Universal Studios Hollywood)` — https://coasterpedia.net/wiki/Revenge_of_the_Mummy_(Universal_Studios_Hollywood) — 44.4 ft / 40 mph / 1,906 ft (581 m) / 0 inversions / Steel Launched Enclosed / Premier Rides / 2 LIM launches / Opened June 25 2004 / Status Operating / Section Lower Lot / Replaced E.T. Adventure / Photos 2025-11-03, 2025-05-11. Last edited 2025-05-22.
- Wikipedia — `Revenge of the Mummy` — https://en.wikipedia.org/wiki/Revenge_of_the_Mummy — infobox table: Florida May 21 2004 / Hollywood June 25 2004 / Singapore March 18 2010; lengths 670 m / 581 m / 670 m; speeds 64 km/h; manufacturers Premier Rides; all Status Operating. Singapore details also on RWS official page https://www.rwsentosa.com/en/play/universal-studios-singapore/rides/revenge-of-the-mummy .
- RCDB — Florida `2232.htm`, Hollywood `2464.htm` (linked from Coasterpedia) — confirms Operating.

Cross-checked height/speed: `44.4 ft = 13.53 m`, `40 mph = 64.37 km/h` (rounded as stored in DB; matches existing `Other` row). Type stored as `Steel - Launched - Enclosed` (existing row uses `Steel – Launched – Enclosed` with en-dash; canonicalized to hyphen for consistency with audit inserts).

## Inserts (transaction 2026-08-31, `source=admin`, `external_id=NULL`)

| # | Park (slug) | Coaster | Slug | Opening | Status | Material | Manufacturer | H | S | L | Inv | Type |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Universal Studios Florida (`universal-studios-florida`, `b9b146ce-…`) | Revenge of the Mummy | `revenge-of-the-mummy` | 2004-05-21 | operating | steel | Premier Rides (`ca1e3fd2-…`) | 13.53 | 64.37 | 670 | 0 | Steel - Launched - Enclosed |
| 2 | Universal Studios Hollywood (`universal-studios-hollywood`, `b0e09e31-…`) | Revenge of the Mummy | `revenge-of-the-mummy` | 2004-06-25 | operating | steel | Premier Rides | 13.53 | 64.37 | 581 | 0 | Steel - Launched - Enclosed |
| 3 | Universal Studios Singapore (`universal-studios-singapore`, `a4fffd7a-…`) | Revenge of the Mummy | `revenge-of-the-mummy` | 2010-03-18 | operating | steel | Premier Rides | 13.53 | 64.37 | 670 | 0 | Steel - Launched - Enclosed |

SQL (reproducible):

```sql
insert into public.coasters (id, park_id, name, slug, manufacturer_id, opening_date, status, material, height_m, speed_kmh, length_m, inversions, type, source)
values
  (gen_random_uuid(), (select id from parks where slug='universal-studios-florida'),   'Revenge of the Mummy', 'revenge-of-the-mummy', (select id from manufacturers where slug='premier-rides'), '2004-05-21', 'operating', 'steel', 13.53, 64.37, 670, 0, 'Steel - Launched - Enclosed', 'admin'),
  (gen_random_uuid(), (select id from parks where slug='universal-studios-hollywood'), 'Revenge of the Mummy', 'revenge-of-the-mummy', (select id from manufacturers where slug='premier-rides'), '2004-06-25', 'operating', 'steel', 13.53, 64.37, 581, 0, 'Steel - Launched - Enclosed', 'admin'),
  (gen_random_uuid(), (select id from parks where slug='universal-studios-singapore'), 'Revenge of the Mummy', 'revenge-of-the-mummy', (select id from manufacturers where slug='premier-rides'), '2010-03-18', 'operating', 'steel', 13.53, 64.37, 670, 0, 'Steel - Launched - Enclosed', 'admin');
```

Result: `1234 → 1237` coasters (`psql` count post-commit); `Other` bucket stays `82` (orphan retained). New rows are `operating` and appear on the default board; orphan is `unknown` and hidden.

## Residue

- `other/revenge-of-the-mummy` (`ed309509-…`, `unknown`, `revenge-of-the-mummy@other`) — superseded by the three above; delete or merge as alias in a later pass (no immediate user impact).
- `decisions.json` / `sweep.json` still list `MISS-220/311/397` as open — next `coverage:sweep` will drop them (no longer generated) and preserve the `99` decided items; no manual edit needed.
