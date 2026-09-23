# Audit: Global Slug Deduplication — 2026-09-04

## Context

`coasters.slug` was only unique per `(park_id, slug)` (`supabase/migrations/20260816183753_parks_coasters.sql:54`), allowing the same slug in different parks. The board/detail page assumes globally-unique slugs: `app/src/lib/coasters.ts:643` `useCoaster(slug)` → `.eq('slug', slug).maybeSingle()` and `app/src/App.tsx:55` `/coasters/:slug`. With 21 duplicate slugs (46 rows) the query returned >1 row and the page failed (e.g. `pteranodon-flyers` – https://coasterrank.app/coasters/pteranodon-flyers).

Detected 2026-09-04 via:
```sql
SELECT slug, count(*) FROM coasters GROUP BY slug HAVING count(*) > 1;
-- 21 rows, 46 total rows
```

## Fix executed (ad-hoc, pre-launch, URL-break acceptable)

**Rule:** For every row whose `slug` is duplicated, rename to `slug || '-' || COALESCE(NULLIF(park.slug,'other'), manufacturer.slug, 'x')`. If that still collides, append `-2`, `-3`… (no such collisions today). `other` is the synthetic `Other (unknown location)` park (`scripts/src/import-coasters.ts:217`).

Proposed slugs were pre-validated:
```sql
SELECT c.slug || '-' || p.slug FROM coasters c JOIN parks p ON p.id=c.park_id
WHERE slug IN (SELECT slug FROM coasters GROUP BY slug HAVING count(*)>1)
GROUP BY 1 HAVING count(*)>1; -- 0 rows
```

Execution (transaction, applied 2026-09-04 via `SUPABASE_DB_URL`):

```sql
BEGIN;
WITH dup AS (SELECT slug FROM coasters GROUP BY slug HAVING count(*)>1)
UPDATE coasters c SET slug = c.slug || '-' || COALESCE(NULLIF(p.slug,'other'), m.slug, 'x')
FROM parks p LEFT JOIN manufacturers m ON m.id=c.manufacturer_id
WHERE c.park_id=p.id AND c.slug IN (SELECT slug FROM dup);
-- verification: SELECT slug,count(*) FROM coasters GROUP BY slug HAVING count(*)>1; -- expect 0
COMMIT;
```

FK safety: `coaster_ratings`, `user_rides`, `user_number_ones`, `coaster_aliases` reference `coasters.id` (UUID), not `slug`; `v_coaster_rankings` is a view selecting `c.slug` directly.

## Mapping (46 rows, ordered by old_slug)

| id | old_slug | new_slug | park_name | park_slug | manu | source |
|---|---|---|---|---|---|---|
| ce8a032f-94e8-471a-934c-924f9cfd8b4c | air-grover | air-grover-busch-gardens-tampa-bay | Busch Gardens Tampa Bay | busch-gardens-tampa-bay | zierer | admin |
| a48c67d5-5e38-46a9-b9c0-1365d67ffbfb | air-grover | air-grover-tampa-florida-u-s | Tampa, Florida, U.S. | tampa-florida-u-s |  | open-csv |
| 8475fdb1-2806-4822-8518-8991d550cdb5 | backlot-stunt-coaster | backlot-stunt-coaster-kings-dominion | Kings Dominion | kings-dominion | premier-rides | admin |
| 6b963f30-86ee-45e3-9659-6085051b7a02 | backlot-stunt-coaster | backlot-stunt-coaster-kings-island | Kings Island | kings-island | premier-rides | open-csv |
| 1d1bd440-5bd1-4ce6-954c-d57f7f2b3de3 | draken | draken-energylandia | Energylandia | energylandia | preston-barbieri | admin |
| 6af1d03a-49c9-4d54-864c-b721dc4dc4f8 | draken | draken-gyeongju-world | Gyeongju World | gyeongju-world |  | admin |
| fb4ca918-3f49-4b4a-930f-cdfcb162fad1 | flight-of-fear | flight-of-fear-kings-dominion | Kings Dominion | kings-dominion | premier-rides | admin |
| fe84db5a-cd1a-4410-a666-fa9ec463b752 | flight-of-fear | flight-of-fear-kings-island | Kings Island | kings-island | premier-rides | admin |
| 3523a6e1-0bd3-40cd-bc12-0f740654a4a6 | flight-of-fear | flight-of-fear-premier-rides | Other (unknown location) | other | premier-rides | open-csv |
| be41101a-98bc-4030-ba60-ce92ca54c0cd | galacticoaster | galacticoaster-legoland-california | Legoland California | legoland-california | art-engineering | admin |
| ba1d7324-5287-4b41-b66f-c4b92a39eeb0 | galacticoaster | galacticoaster-legoland-florida | Legoland Florida | legoland-florida | art-engineering | admin |
| 160d2ad5-afe4-4411-8ba0-ae14ec8d738e | gotham-city-gauntlet-escape-from-arkham-asylum | gotham-city-gauntlet-escape-from-arkham-asylum-maurer-ag | Other (unknown location) | other | maurer-ag | open-csv |
| 8bb29196-c3d6-4b55-8af8-633c8c968afd | gotham-city-gauntlet-escape-from-arkham-asylum | gotham-city-gauntlet-escape-from-arkham-asylum-six-flags-new-england | Six Flags New England | six-flags-new-england | maurer-ag | admin |
| 573c8386-a64e-4f1b-bea4-ef1bb62843e2 | kozmo-s-kurves | kozmo-s-kurves-elysburg-pennsylvania-united-states | Elysburg, Pennsylvania, United States | elysburg-pennsylvania-united-states |  | open-csv |
| d840e26a-2c65-49f4-80a0-231a1d8fb4b8 | kozmo-s-kurves | kozmo-s-kurves-knoebels-amusement-resort | Knoebels Amusement Resort | knoebels-amusement-resort | e-f-miler-industries | admin |
| f9a8e17c-bf94-415c-8796-70b61a1d1214 | orkanen | orkanen-fa-rup-sommarland | Fårup Sommarland | fa-rup-sommarland | vekoma | open-csv |
| 5f676890-1128-472b-a4e6-a2f9dbf22fca | orkanen | orkanen-fa-rup-sommerland | Fårup Sommerland | fa-rup-sommerland | vekoma | admin |
| 5065c1fe-517d-42e9-b7b4-d6e37f63fef1 | pteranodon-flyers | pteranodon-flyers-universal-orlando-resort-orlando-florida-united-states | Universal Orlando Resort | universal-orlando-resort-orlando-florida-united-states |  | open-csv |
| 8e9e2ffe-8d67-4a7d-b07b-75d66d861fb4 | pteranodon-flyers | pteranodon-flyers-universal-s-islands-of-adventure | Universal's Islands of Adventure | universal-s-islands-of-adventure |  | admin |
| 9ec1b1fe-3681-413a-b29d-073ca9ec61c1 | rc-racer | rc-racer-hong-kong-disneyland | Hong Kong Disneyland | hong-kong-disneyland | intamin | admin |
| dd7a8520-0c81-461b-b35c-ab14642e7668 | rc-racer | rc-racer-intamin | Other (unknown location) | other | intamin | open-csv |
| 802e7d55-057f-4241-b201-30e74bedd532 | rc-racer | rc-racer-walt-disney-studios-park | Walt Disney Studios Park | walt-disney-studios-park | intamin | admin |
| a187d849-9e09-402d-8618-c1ce55e63dae | revenge-of-the-mummy | revenge-of-the-mummy-universal-studios-florida | Universal Studios Florida | universal-studios-florida | premier-rides | admin |
| dd3edcd6-7b2f-4da5-819e-705201720ffe | revenge-of-the-mummy | revenge-of-the-mummy-universal-studios-hollywood | Universal Studios Hollywood | universal-studios-hollywood | premier-rides | admin |
| a572e690-0092-43fc-88d5-77441d292acf | revenge-of-the-mummy | revenge-of-the-mummy-universal-studios-singapore | Universal Studios Singapore | universal-studios-singapore | premier-rides | admin |
| 01dca1d3-ad01-4f0a-8bba-b2d1b2c63059 | runaway-mountain | runaway-mountain-arlington-texas-u-s | Arlington, Texas, U.S. | arlington-texas-u-s |  | open-csv |
| 46969dad-5194-4ac4-bfab-5138efcbd5c3 | runaway-mountain | runaway-mountain-six-flags-over-texas | Six Flags Over Texas | six-flags-over-texas | premier-rides | admin |
| f34b11c1-d6a3-46d7-b18d-7427218dee28 | schweizer-bobbahn | schweizer-bobbahn-europa-park | Europa-Park | europa-park | mack-rides | admin |
| d209da09-db06-4731-9528-fe9b530e4c0e | schweizer-bobbahn | schweizer-bobbahn-heide-park | Heide Park | heide-park | mack-rides | open-csv |
| 938f76ac-c087-4e3a-814a-4fb4e04a7510 | seven-dwarfs-mine-train | seven-dwarfs-mine-train-shanghai-disneyland | Shanghai Disneyland | shanghai-disneyland | vekoma | admin |
| 15969f25-e8ae-4a7d-b202-c73e58b80857 | seven-dwarfs-mine-train | seven-dwarfs-mine-train-walt-disney-world-magic-kingdom | Magic Kingdom | walt-disney-world-magic-kingdom | vekoma | admin |
| 9916ece2-c101-46d5-8986-0b7817ef7877 | snoopy-s-racing-railway | snoopy-s-racing-railway-canada-s-wonderland | Canada's Wonderland | canada-s-wonderland | art-engineering | wikipedia |
| 56d09423-c4df-4ffa-872e-91a4f4429cd2 | snoopy-s-racing-railway | snoopy-s-racing-railway-carowinds | Carowinds | carowinds | art-engineering | admin |
| 701b6276-d997-488c-81d5-3ef067c72e15 | storm-coaster | storm-coaster-dubai-hills-mall | Dubai Hills Mall | dubai-hills-mall | intamin | admin |
| 84bfabeb-9792-48ee-8117-0cd9f7125d6a | storm-coaster | storm-coaster-sea-world-australia | Sea World (Australia) | sea-world-australia | mack-rides | open-csv |
| 43b3a5f1-1e7a-4079-a0cb-796e2618046b | superman-ultimate-flight | superman-ultimate-flight-bolliger-mabillard | Other (unknown location) | other | bolliger-mabillard | open-csv |
| 993ed94e-f242-4a95-99aa-77d065ce1e12 | superman-ultimate-flight | superman-ultimate-flight-six-flags-great-adventure | Six Flags Great Adventure | six-flags-great-adventure | bolliger-mabillard | admin |
| 97d0bb8f-f2f8-4113-8fb5-fc4343af2261 | superman-ultimate-flight | superman-ultimate-flight-six-flags-great-america | Six Flags Great America | six-flags-great-america | bolliger-mabillard | admin |
| e39c5560-6ef9-4ccd-9a6a-133f7bde4d7e | the-dark-knight-coaster | the-dark-knight-coaster-mack-rides | Other (unknown location) | other | mack-rides | open-csv |
| 0875233c-298f-4833-bcdf-59ba2aef522e | the-dark-knight-coaster | the-dark-knight-coaster-six-flags-great-america | Six Flags Great America | six-flags-great-america | mack-rides | admin |
| c15874ce-6951-4175-8a96-0ba52bc3c1cd | the-great-pumpkin-coaster | the-great-pumpkin-coaster-kings-island | Kings Island | kings-island | e-f-miler-industries | admin |
| 38006c5d-38eb-4bdd-8a71-a1b31e8c1664 | the-great-pumpkin-coaster | the-great-pumpkin-coaster-mason-ohio-united-states | Mason, Ohio, United States | mason-ohio-united-states |  | open-csv |
| 9a1a8803-d23a-402f-8388-6e5fb73e374b | wild-mouse | wild-mouse-cedar-point | Cedar Point | cedar-point | zamperla | admin |
| 76941370-d74e-4a0a-b242-28e7105eb985 | wild-mouse | wild-mouse-nagashima-spa-land | Nagashima Spa Land | nagashima-spa-land | mack-rides | admin |
| 646e3c13-bd39-4b0a-8e7e-f1afa48ec3e3 | wile-e-coyote-s-grand-canyon-blaster | wile-e-coyote-s-grand-canyon-blaster-arlington-texas-u-s | Arlington, Texas, U.S. | arlington-texas-u-s |  | open-csv |
| ef280055-a801-4a2c-911d-68196eb8f3e9 | wile-e-coyote-s-grand-canyon-blaster | wile-e-coyote-s-grand-canyon-blaster-six-flags-over-texas | Six Flags Over Texas | six-flags-over-texas | chance-rides | admin |

## Hardening (this PR)

* Migration `supabase/migrations/*_make_coaster_slugs_globally_unique.sql` adds `UNIQUE(slug)` (`coasters_slug_key`).
* Code updates: `app/src/lib/coasters.ts` – `slugify` + global-collision helper used in `approveSubmission`, `createCoaster`, `updateCoaster`; `scripts/src/import-coasters.ts` – global slug check before `COALESCE` insert.
* Post-deploy invariant: `SELECT slug,count(*) FROM coasters GROUP BY slug HAVING count(*)>1` must be 0; any `23505` on `coasters_slug_key` should be retried with park/manufacturer suffix.
