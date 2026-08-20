Yes. I’d treat this as a **canonical roller-coaster knowledge graph with provenance**, not as a one-off import. The goal is to move from “an initial 2022 list” to a **continuously refreshed, auditable, high-confidence database** where every important fact can be traced back to an acceptable source.

Below is how I’d think about it, starting with clarifying questions, then a concrete strategy.

---

## 1. Clarifying questions I’d ask first

Before building the pipeline, I’d want to align on scope and governance.

### A. Scope: what counts as a roller coaster?

1. **What entities should be included?**
   - Permanent amusement/theme park coasters only?
   - Family entertainment centers, fairgrounds, zoos, ski resorts, shopping malls?
   - Water coasters, powered coasters, kiddie coasters, wild mice, alpine coasters, bobsleds, suspended coasters?
   - Seasonal or traveling coasters?
   - Announced but never built coasters?
   - Coasters that are relocated or stored?

2. **What statuses matter?**
   - Do we include `sbno` as a distinct status indefinitely?
   - If a coaster is closed but not demolished, is it `defunct` or `sbno`?
   - Do we track announced/under-construction coasters even if opening is years away?
   - Do we track removed coasters historically, or only current/recent coasters?

3. **What level of historical tracking is required?**
   - If a coaster relocates, is that one coaster with a location history, or two coaster records linked together?
   - If a coaster is renamed, do we preserve old names as aliases?
   - If a park rebrands or changes ownership, do we preserve park history?

### B. Data quality and freshness

4. **How fresh does the data need to be?**
   - Is “verified within the last 12 months” acceptable?
   - Do we need near-real-time status updates for new openings?
   - Is it acceptable for some international parks to be reviewed only every 24 months?

5. **What confidence threshold is acceptable for automated updates?**
   - Can the system automatically mark a coaster as `operating` if one official park page says so?
   - Do status changes require two independent sources?
   - Should humans approve all merges and deletions?

### C. Legal, ethical, and licensing constraints

6. **Which open sources are legally acceptable?**
   - Wikipedia/Wikidata: usually fine with attribution, but need to confirm license compatibility.
   - OpenStreetMap: ODbL may require careful handling.
   - Government ride-inspection data: usually public, but terms vary by jurisdiction.
   - Official park and manufacturer websites: generally okay to read and extract factual data, but scraping terms need review.

7. **What is the policy around RCDB?**
   - I would assume: no scraping, no bulk extraction, no copying of structured records, no use of their IDs, and no use of RCDB pages as extraction input.
   - It may be acceptable only as a general awareness that the world has more than 1,000 coasters, but not as a data source.

8. **Can we store raw evidence?**
   - We should store source URLs, fetch timestamps, snippets, and possibly cached HTML/PDFs for auditability.
   - Need to confirm retention policy and whether raw page snapshots are acceptable.

### D. Product and operational constraints

9. **How will admins interact with the data?**
   - Does the existing app support bulk imports?
   - Can we add review screens for candidates, duplicates, and stale records?
   - Can admins attach evidence URLs to each record?

10. **What is the expected human review capacity?**
   - If we generate 10,000 candidates, can staff review 50 per day? 500 per day?
   - Should we build a community contribution workflow later?

11. **What is the actual budget?**
   - A meager budget can still cover search APIs, news APIs, geocoding, and modest LLM extraction costs.
   - If the budget is near zero, we should prioritize official sources, Wikidata, Wikipedia, OpenStreetMap, and manual review.

12. **What are the success metrics?**
   - Total coaster count?
   - Percentage of records verified in the last 12 months?
   - Percentage of coasters with opening date, manufacturer, status, and coordinates?
   - Duplicate rate?
   - False positive rate from automated imports?

---

## 2. Core strategy

My high-level approach would be:

> **Build a source-aware canonical database, discover coasters through many independent public sources, normalize and match them carefully, then maintain the database with continuous evidence-based updates.**

The system should be designed around five layers:

1. **Canonical data layer**  
   The clean, app-facing `parks`, `manufacturers`, and `coasters` tables.

2. **Provenance layer**  
   Every coaster and key field should be linked to one or more sources, with evidence URLs, fetch dates, and confidence scores.

3. **Candidate/staging layer**  
   Newly discovered coasters should not go directly into the canonical tables unless confidence is very high.

4. **Human-in-the-loop review layer**  
   Ambiguous candidates, duplicates, status changes, and merges should be reviewed by admins.

5. **Continuous refresh layer**  
   Scheduled checks for stale records, official park pages, news, manufacturer announcements, and government ride lists.

---

## 3. Key principle: do not copy RCDB

Given RCDB’s policy, I would treat it as an excluded source.

Operational safeguards:

- Add RCDB domains to a crawler blocklist.
- Do not use RCDB pages as LLM extraction input.
- Do not store RCDB IDs.
- Do not use RCDB as a training or validation dataset.
- If a human manually knows about a coaster, they may add it, but the record should be supported by an acceptable public source, not by a copied RCDB entry.

This keeps the project ethically clean while still allowing us to build a comprehensive database from fragmented public information.

---

## 4. Extend the schema for provenance and candidates

The current schema is a good start, but the single `source` and `external_id` column on `coasters` is probably too limited for a long-term, multi-source database.

I would keep `coasters` as the canonical table, but add supporting tables.

### A. Source registry

```sql
create table public.data_sources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null check (kind in (
    'official_park',
    'manufacturer',
    'government',
    'open_data',
    'news',
    'social',
    'fan_site',
    'user_submission',
    'search_result',
    'other'
  )),
  base_url text,
  license text,
  reliability integer not null default 3 check (reliability between 1 and 5),
  active boolean not null default true,
  notes text
);
```

### B. Link canonical coasters to external identifiers

The current `external_id` field can remain for backward compatibility, but we should support multiple external IDs.

```sql
create table public.coaster_external_ids (
  id uuid primary key default gen_random_uuid(),
  coaster_id uuid not null references public.coasters (id) on delete cascade,
  source_id uuid not null references public.data_sources (id),
  external_id text,
  url text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (source_id, external_id)
);
```

### C. Store observations/evidence

This is critical for a “breathing” database.

```sql
create table public.coaster_observations (
  id uuid primary key default gen_random_uuid(),
  coaster_id uuid references public.coasters (id) on delete set null,
  candidate_id uuid, -- if not yet canonical
  source_id uuid not null references public.data_sources (id),
  observed_at timestamptz not null default now(),
  url text,
  raw jsonb,
  observed_status coaster_status,
  observed_opening_date date,
  observed_name text,
  observed_park_name text,
  observed_manufacturer text,
  confidence numeric check (confidence between 0 and 1),
  notes text
);
```

### D. Candidate coasters

Candidates should live outside the canonical `coasters` table until approved or auto-accepted.

```sql
create table public.coaster_candidates (
  id uuid primary key default gen_random_uuid(),
  park_id uuid references public.parks (id) on delete set null,
  guessed_park_name text,
  guessed_country text,
  name text not null,
  slug text,
  manufacturer_id uuid references public.manufacturers (id),
  model text,
  opening_date date,
  status coaster_status not null default 'unknown',
  material coaster_material not null default 'other',
  height_m numeric check (height_m >= 0),
  speed_kmh numeric check (speed_kmh >= 0),
  length_m numeric check (length_m >= 0),
  inversions integer check (inversions >= 0),
  type text,
  lat numeric(9,6),
  lng numeric(9,6),
  review_state text not null default 'pending' check (review_state in (
    'pending',
    'accepted',
    'duplicate',
    'rejected',
    'needs_evidence'
  )),
  confidence numeric check (confidence between 0 and 1),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by text,
  accepted_coaster_id uuid references public.coasters (id),
  notes text
);
```

### E. Status history

Status should not be overwritten silently.

```sql
create table public.coaster_status_history (
  id uuid primary key default gen_random_uuid(),
  coaster_id uuid not null references public.coasters (id) on delete cascade,
  status coaster_status not null,
  effective_date date,
  source_id uuid references public.data_sources (id),
  url text,
  created_at timestamptz not null default now(),
  notes text
);
```

### F. Aliases

Names change, and sources may use different names.

```sql
create table public.coaster_aliases (
  id uuid primary key default gen_random_uuid(),
  coaster_id uuid not null references public.coasters (id) on delete cascade,
  alias text not null,
  language text,
  source_id uuid references public.data_sources (id),
  created_at timestamptz not null default now(),
  unique (coaster_id, alias)
);
```

### G. Add operational metadata to canonical coasters

```sql
alter table public.coasters
  add column if not exists last_verified_at timestamptz,
  add column if not exists confidence numeric check (confidence between 0 and 1),
  add column if not exists review_state text not null default 'active' check (review_state in (
    'active',
    'needs_review',
    'possibly_duplicate',
    'possibly_outdated',
    'archived'
  )),
  add column if not exists needs_review_reason text;
```

This allows the app to show things like:

- “Last verified 2024-03-11”
- “Needs review: status may be outdated”
- “Low confidence: only one source”
- “Possible duplicate of another coaster”

---

## 5. Build a source inventory

The world’s coaster data is fragmented, so the first engineering task is to create an inventory of acceptable sources.

I would categorize sources by reliability and license.

### High-priority sources

#### 1. Official park websites

Best source for:

- Coaster existence
- Current operating status
- Name
- Park location
- Opening announcements
- Ride closures
- Height/speed/length stats, sometimes

Examples of pages to target:

- `/rides`
- `/attractions`
- `/thrill-rides`
- `/plan-your-visit/park-map`
- `/news`
- `/press`
- `/whats-new`

Pros:

- High authority
- Usually current
- Ethically clear if accessed publicly

Cons:

- Structured data is rare
- Site formats vary widely
- Some parks use JavaScript-heavy pages
- International parks may be multilingual

#### 2. Manufacturer websites

Best source for:

- Manufacturer
- Model
- Installation list
- Opening year
- Height/speed/length/inversions
- Announcement of new installations

Examples:

- B&M
- Intamin
- Vekoma
- Mack Rides
- Maurer
- Gerstlauer
- Zamperla
- S&S
- ART Engineering
- Great Coasters International
- Gravity Group
- Rocky Mountain Construction
- Premier Rides
- Bolliger & Mabillard
- Maurer
- Zierer
- Pinfari
- SBF Visa
- Technical Park
- etc.

Pros:

- Good for manufacturer/model data
- Often includes technical stats
- Good discovery source for new coasters

Cons:

- May not reflect current operating status
- Some manufacturers only list selected installations
- May not include closed or relocated coasters

#### 3. Government amusement-ride inspection or registration data

Some jurisdictions publish ride inspection data, permit data, or registration lists.

Best source for:

- Existence of a ride at a park
- Operational status
- Ride name
- Location

Pros:

- Often official
- Can reveal smaller parks not well covered elsewhere

Cons:

- Coverage is uneven
- May include all rides, not only coasters
- Data formats may be poor
- Some jurisdictions may not publish data publicly

#### 4. Wikidata

Wikidata may have entities for roller coasters, amusement parks, and manufacturers.

Best source for:

- Discovery
- Coordinates
- Country
- Park association
- Opening date
- Manufacturer
- Official website

Pros:

- Machine-readable
- CC0-ish licensing for structured data
- Good global coverage for major coasters

Cons:

- Incomplete
- Quality varies
- Needs validation

#### 5. Wikipedia

Wikipedia can provide:

- Lists of roller coasters by park, country, or manufacturer
- Opening/closing dates
- Historical context
- References to news or official sources

Pros:

- Good discovery source
- Often contains citations

Cons:

- Text is CC BY-SA, so we should avoid copying prose
- Facts should be verified where possible
- Coverage can be uneven

#### 6. OpenStreetMap

OSM can help find:

- Amusement parks
- Roller coaster features
- Names
- Coordinates
- Tourism-related attractions

Pros:

- Global
- Geospatially useful
- Can identify parks missing from our park table

Cons:

- ODbL licensing requires care
- Quality varies
- Many coasters may be tagged inconsistently

I would use OSM primarily as a discovery and geosatial enrichment source, with legal review.

### Medium-priority sources

#### 7. Official park social media

Useful for:

- Opening announcements
- Closure announcements
- Seasonal operation
- “Now open” posts

Examples:

- X/Twitter
- Facebook
- Instagram
- YouTube

Caveats:

- API costs can be high
- Some content may be difficult to archive legally
- Use mainly as evidence URLs, not as bulk scraped content

#### 8. News search

News can reveal:

- New coaster openings
- Closures
- Accidents affecting status
- Park expansion announcements

Possible APIs:

- Google News search
- Bing News
- NewsAPI
- GDELT
- Regional news search

Pros:

- Good for status changes
- Good for discovering new coasters

Cons:

- Articles may be paywalled
- Headlines may be ambiguous
- Need to avoid copying article text

#### 9. Park maps and PDFs

Official park maps often list rides.

Useful for:

- Discovering coaster names
- Checking if a coaster appears on current map
- Identifying new areas

Cons:

- PDF parsing is annoying
- Maps may not include opening dates
- Need OCR or vision model assistance

### Lower-priority but useful sources

#### 10. Fan sites and forums

Use only as leads, not as source of truth.

Pros:

- Community knowledge may identify gaps
- May know local parks

Cons:

- Licensing and accuracy vary
- May be too close to RCDB-like data
- Need explicit permission if using substantial content

#### 11. User submissions

Long-term, the app could allow authenticated admins or trusted users to submit new coasters.

Each submission should require:

- Park name or location
- Coaster name
- Evidence URL
- Status evidence
- Optional photos or official page

---

## 6. Use a “park-first” discovery strategy

Because the current schema anchors coasters to parks, I would first build a strong park universe.

If we only search for coasters globally, we’ll miss context and create duplicates. Instead:

1. Identify parks.
2. For each park, discover coasters.
3. Link coasters to parks.
4. Use park geography and official sites to validate coaster records.

### Park discovery sources

- OpenStreetMap `tourism=theme_park`, `tourism=attraction`, `leisure=amusement_arcade`, etc.
- Wikidata instances of amusement park, theme park, water park, family entertainment center.
- Wikipedia lists of amusement parks by country.
- Official tourism board directories.
- Search engine queries:
  - `amusement park [country]`
  - `theme park [city]`
  - `family entertainment center roller coaster`
  - `fairground roller coaster`
  - `ski resort alpine coaster`

### Park enrichment fields

I would consider adding to `parks`:

```sql
alter table public.parks
  add column if not exists official_website text,
  add column if not exists park_type text,
  add column if not exists last_verified_at timestamptz,
  add column if not exists review_state text default 'active';
```

Also create park external IDs:

```sql
create table public.park_external_ids (
  id uuid primary key default gen_random_uuid(),
  park_id uuid not null references public.parks (id) on delete cascade,
  source_id uuid not null references public.data_sources (id),
  external_id text,
  url text,
  unique (source_id, external_id)
);
```

---

## 7. Candidate discovery pipeline

I would build a pipeline with these stages:

```text
source discovery
  -> raw fetch
  -> extraction
  -> normalization
  -> candidate creation
  -> matching/deduplication
  -> confidence scoring
  -> human review or auto-accept
  -> canonical coaster creation/update
```

### Stage 1: Raw fetch

For each source:

- Respect robots.txt and terms.
- Rate-limit requests.
- Store:
  - URL
  - fetch timestamp
  - HTTP status
  - content hash
  - raw HTML/PDF or snippet
  - license/source ID

Avoid storing unnecessary personal data. We mostly need public ride and park information.

### Stage 2: Extraction

Use a mix of:

- HTML parsers
- PDF extraction
- OCR/vision models for maps
- LLM-assisted extraction for unstructured pages
- Regex and heuristics for common fields

For LLM extraction, require structured output like:

```json
{
  "coaster_name": "Example Flyer",
  "park_name": "Example World",
  "status": "operating",
  "opening_date": "2024-05-10",
  "manufacturer": "Example Rides",
  "model": "Launch Coaster",
  "height_m": 45,
  "speed_kmh": 100,
  "length_m": 900,
  "inversions": 3,
  "evidence_snippet": "Now open at Example World since May 2024...",
  "confidence": 0.82
}
```

Important rule:

> The LLM should extract from fetched evidence only. It should not invent facts.

### Stage 3: Normalization

Normalize values into controlled vocabularies.

Examples:

Status:

```text
open -> operating
now open -> operating
running -> operating
closed -> defunct
removed -> defunct
demolished -> defunct
coming soon -> under_construction
construction -> under_construction
stand-up but not running -> sbno maybe, depending on evidence
relocated -> relocated
```

Material:

```text
wooden -> wood
wooden coaster -> wood
steel coaster -> steel
hybrid wooden coaster -> hybrid
```

Units:

- ft to m
- mph to km/h
- feet/inches to meters
- kilometers to meters

Dates:

- `2024` -> `2024-01-01` with low date precision
- `May 2024` -> `2024-05-01`
- `2024-05-10` -> exact date

We may want a separate `date_precision` field eventually:

```sql
create type date_precision as enum ('year', 'month', 'day');
```

### Stage 4: Candidate creation

Every extracted coaster becomes a candidate unless it can be confidently matched to an existing coaster.

Candidate fields include:

- Name
- Guessed park
- Guessed country
- Source
- Evidence URL
- Observed status
- Observed opening date
- Confidence
- Raw snippet

---

## 8. Matching and deduplication

This is one of the hardest parts.

A coaster from one source may be called:

- “Big Thunder”
- “Big Thunder Mountain”
- “Big Thunder Mountain Railroad”
- “Thunder Mountain”
- Local transliteration
- Romanized name vs native name

We need identity resolution.

### Matching keys

Use combinations of:

- Normalized coaster name
- Park name
- Park location
- Country
- Manufacturer
- Opening year
- Coordinates
- External IDs

### Blocking

Do not compare every candidate against every coaster. Use blocking:

- Same park ID
- Same guessed park name
- Same country and similar name
- Same coordinates within small radius
- Same external ID/source

### Fuzzy matching

Use PostgreSQL `pg_trgm`:

```sql
create extension if not exists pg_trgm;

create index coasters_name_trgm_idx
  on public.coasters using gin (name gin_trgm_ops);
```

Then score similarity.

Example matching rules:

1. **Exact external ID match**  
   If a candidate has the same source and external ID as an existing coaster, match it.

2. **Same park + high name similarity**  
   If park matches and normalized name similarity > 0.9, likely duplicate.

3. **Same park + same manufacturer + same opening year**  
   Strong evidence of duplicate.

4. **Same coordinates + coaster-like name**  
   Useful for OSM/geospatial candidates.

5. **Low-confidence match**  
   Send to human review.

### Duplicate handling

When a candidate duplicates an existing coaster:

- Do not create a new coaster.
- Add the candidate as an observation.
- Add external ID if new.
- Add alias if name differs.
- Update fields only if:
  - existing field is null, or
  - new source has higher confidence and more recent evidence.

Merges should be logged:

```sql
create table public.coaster_merge_log (
  id uuid primary key default gen_random_uuid(),
  duplicate_candidate_id uuid,
  duplicate_coaster_id uuid,
  canonical_coaster_id uuid not null references public.coasters (id),
  merged_by text,
  reason text,
  created_at timestamptz not null default now()
);
```

---

## 9. Confidence scoring

Not all sources and observations are equal.

I’d create a simple confidence model.

### Source reliability

Example scale:

| Source type | Reliability |
|---|---:|
| Official park page | 5 |
| Manufacturer page | 4 |
| Government ride registry | 4 |
| Major news article | 3 |
| OpenStreetMap/Wikidata | 3 |
| Fan site | 2 |
| User submission | 1 |

### Evidence freshness

Recent evidence should count more than old evidence.

Example:

- Observed within 3 months: high freshness
- Observed within 12 months: medium freshness
- Observed 12–24 months ago: low freshness
- Older: needs review

### Corroboration

A record is more trustworthy when multiple independent sources agree.

Example confidence:

| Evidence | Confidence |
|---|---:|
| One old fan source | 0.2 |
| One official source | 0.6 |
| One official source + one recent news source | 0.8 |
| Two independent official/current sources | 0.9 |
| Official source + government registry + recent evidence | 0.95 |

### Field-level confidence

Eventually, confidence should be field-level.

For example:

- Name: high
- Status: high
- Opening date: medium
- Height: low
- Speed: low
- Manufacturer: medium

This matters because a coaster’s existence may be confirmed, but its technical stats may be uncertain.

---

## 10. Fixing the existing 1,000-record import

The initial import should not be trusted blindly.

I’d treat it as a legacy dataset with these steps.

### Step 1: Mark the import as stale

Add a source record:

```sql
insert into public.data_sources (name, kind, license, reliability, notes)
values (
  '2022 initial import',
  'other',
  'unknown',
  2,
  'Legacy import from 2022. Needs verification.'
);
```

Then associate existing records with this source if possible.

If the legacy source ID is already in `coasters.source`, we can map it into `data_sources` and `coaster_external_ids`.

### Step 2: Add baseline audit metadata

```sql
update public.coasters
set
  last_verified_at = null,
  confidence = 0.3,
  review_state = 'needs_review',
  needs_review_reason = 'Legacy 2022 import; not recently verified'
where review_state is distinct from 'active';
```

Or more selectively:

```sql
update public.coasters
set
  confidence = 0.3,
  review_state = 'needs_review',
  needs_review_reason = 'Legacy 2022 import; not recently verified'
where last_verified_at is null;
```

### Step 3: Prioritize records for review

Priority order:

1. `status = 'under_construction'`
2. `status = 'unknown'`
3. Coasters with missing opening date
4. Coasters with missing manufacturer
5. Coasters with missing coordinates
6. Coasters in countries with low source coverage
7. Coasters with suspicious stats

The `under_construction` records are especially important because it is now 2026 and many may already be operating.

### Step 4: Targeted status refresh

For every coaster currently `under_construction`, run a targeted evidence search:

Queries:

```text
[coaster name] [park name] opening
[coaster name] [park name] now open
[coaster name] [park name] opened 2023
[coaster name] [park name] opened 2024
[coaster name] [park name] opened 2025
[coaster name] [park name] opened 2026
[coaster name] [manufacturer] opening
```

If evidence shows opening:

- Update status to `operating`.
- Insert status history row.
- Set `last_verified_at`.
- Add evidence URL.
- Increase confidence.

If evidence shows cancellation:

- Update status to `defunct`, `relocated`, or `unknown` depending on evidence.
- Flag for admin review.

If no evidence:

- Keep status as `under_construction` only if recent evidence supports ongoing construction.
- Otherwise set to `unknown` and mark `needs_review`.

### Step 5: Batch-update only when safe

I would avoid bulk automatic overwrites.

Safe automatic updates:

- Fill null fields with high-confidence source data.
- Add aliases.
- Add external IDs.
- Add evidence.
- Add coordinates if park location is known and no conflict exists.

Risky automatic updates:

- Changing status.
- Changing park assignment.
- Changing opening date.
- Merging duplicates.
- Deleting records.

For risky changes, create review tasks.

---

## 11. Discovering the missing ~5,000 coasters

To go from ~1,000 to ~6,000, we need broad discovery.

I’d combine several campaigns.

### Campaign A: Wikidata/Wikipedia expansion

Use SPARQL to find entities that are roller coasters or related types.

Example conceptual Wikidata queries:

- Items that are instances of roller coaster
- Items located in an amusement park
- Items with coordinates
- Items with inception/opening date
- Items with manufacturer

Then:

1. Create candidates.
2. Match to existing parks.
3. Match to existing coasters.
4. Verify with official sources where possible.

Wikipedia lists can also help:

- “List of roller coasters in [country]”
- “List of amusement parks in [country]”
- “List of [manufacturer] roller coasters”

Use Wikipedia as a discovery layer, then verify.

### Campaign B: OpenStreetMap park discovery

Find parks and attractions:

- `tourism=theme_park`
- `tourism=attraction`
- `attraction=roller_coaster`
- `leisure=park` with amusement-related tags
- Nodes/ways named “coaster”

Use OSM to:

- Find parks missing from our database.
- Add coordinates.
- Discover coaster names.

Because OSM licensing is ODbL, I would consult legal before integrating OSM data directly. At minimum, we should provide attribution and track source provenance.

### Campaign C: Manufacturer-based discovery

For each major manufacturer:

1. Find installation lists.
2. Extract coaster names, parks, years, models, stats.
3. Create candidates.
4. Match against existing coasters.

This is especially useful for:

- Steel coasters
- New installations
- Technical stats
- Manufacturer/model normalization

### Campaign D: Country-by-country park campaigns

Pick countries or regions and work systematically.

Example order:

1. Countries with many theme parks:
   - United States
   - China
   - Japan
   - Germany
   - France
   - UK
   - South Korea
   - Netherlands
   - Belgium
   - Spain
   - Italy
   - Canada
   - Australia
   - Brazil
   - Mexico

2. Countries with less coverage but known parks:
   - Poland
   - Turkey
   - UAE
   - Saudi Arabia
   - Thailand
   - Malaysia
   - Vietnam
   - Indonesia
   - India

For each country:

- Build park list.
- Find official park websites.
- Extract rides.
- Identify coasters.
- Compare against existing database.
- Queue gaps.

### Campaign E: News-based new openings

Use news search for recent openings:

```text
new roller coaster opened 2023
new roller coaster opened 2024
new roller coaster opened 2025
new roller coaster opened 2026
theme park new coaster opening
amusement park roller coaster debut
```

This is especially useful for updating status and finding coasters opened after 2022.

### Campaign F: Government ride registries

Where available, parse public ride inspection/registration datasets.

Use cases:

- Confirm existence.
- Discover small parks.
- Validate operating status.
- Find coaster names not present in our database.

Need filtering because these lists may include flat rides, carousels, Ferris wheels, etc.

Keywords for coaster classification:

```text
coaster
roller coaster
mountain
runaway
mine train
wild mouse
inverted
suspended
launch
shuttle
bobsled
alpine coaster
family coaster
steel coaster
wooden coaster
```

But these heuristics need manual review.

---

## 12. Search strategy examples

We can use search APIs or manual searches to discover candidates.

### For park discovery

```text
"amusement park" [city] official site
"theme park" [country] official website
"family entertainment center" "roller coaster" [city]
"amusement park" [country] list
```

### For coaster discovery

```text
site:[park-domain] "roller coaster"
site:[park-domain] "coaster"
[park name] "new roller coaster"
[park name] rides "coaster"
[park name] "coming soon" coaster
[park name] "now open" coaster
```

### For status refresh

```text
[coaster name] [park name] status
[coaster name] [park name] closed
[coaster name] [park name] removed
[coaster name] [park name] reopened
[coaster name] [park name] opening date
[coaster name] [park name] now open
```

### For manufacturer discovery

```text
[manufacturer] roller coasters installed
[manufacturer] installations
[manufacturer] new coaster [year]
[manufacturer] [park name] coaster
```

### For map/PDF discovery

```text
[park name] park map pdf
[park name] ride map
[park name] coaster map
```

---

## 13. Automated vs manual processing

The pipeline should be mixed.

### Fully automated

Use automation for:

- Fetching allowed sources
- Extracting raw candidates
- Normalizing units
- Creating candidate records
- Matching obvious duplicates
- Adding evidence links
- Filling null fields from high-confidence sources
- Flagging stale records
- Generating review queues

### Human review

Require human review for:

- Merging duplicates
- Changing park assignment
- Changing status when evidence conflicts
- Adding relocated coasters
- Deleting or rejecting candidates
- Accepting low-confidence sources
- Resolving ambiguous names
- Handling historical coasters

### Semi-automated acceptance

A candidate can be auto-accepted if all of these are true:

- It has at least one official source.
- It matches an existing park with high confidence.
- It has no duplicate candidates.
- It has no conflicting status evidence.
- It has a coaster name and status.
- It does not conflict with an existing coaster.

Even then, I’d mark it as `last_verified_at = source fetch date` and set confidence to something like `0.7`, not `1.0`.

---

## 14. Handling status transitions

Status is time-sensitive.

The current enum:

```sql
create type coaster_status as enum (
  'operating',
  'defunct',
  'sbno',
  'under_construction',
  'relocated',
  'unknown'
);
```

is useful, but status should have history.

### Status transition rules

Examples:

#### `under_construction` to `operating`

Accept if:

- Official park page says “now open”
- Manufacturer says opened
- Recent news confirms public operation
- Park map shows coaster as open

Then:

```sql
insert into coaster_status_history (coaster_id, status, effective_date, source_id, url)
values (...);

update coasters
set
  status = 'operating',
  opening_date = coalesce(opening_date, evidence_date),
  last_verified_at = now(),
  confidence = updated_confidence
where id = ...;
```

#### `operating` to `defunct`

Accept if:

- Official park page removes coaster and announces closure/removal
- Government registry no longer lists it and news confirms removal
- Multiple recent sources confirm closure/removal

Do not automatically mark defunct just because it is missing from a current park page. It could be a website redesign.

#### `operating` to `sbno`

Use carefully. Evidence should indicate:

- Not operating
- Still present
- Not expected to operate again
- Not yet removed

#### `operating` to `relocated`

This is tricky.

If evidence says a coaster moved:

1. Keep the original coaster record.
2. Mark original as `relocated`.
3. Create a new coaster record at the new park, or create a candidate if not ready.
4. Link them with lineage.

Possible lineage table:

```sql
create table public.coaster_lineage (
  id uuid primary key default gen_random_uuid(),
  predecessor_coaster_id uuid references public.coasters (id),
  successor_coaster_id uuid references public.coasters (id),
  relationship text not null check (relationship in (
    'relocated_to',
    'relocated_from',
    'renamed_to',
    'renamed_from',
    'replaced_by',
    'replaces'
  )),
  notes text,
  created_at timestamptz not null default now()
);
```

---

## 15. Enrichment plan for metadata

The current schema includes useful metadata:

- `height_m`
- `speed_kmh`
- `length_m`
- `inversions`
- `material`
- `type`
- `manufacturer_id`
- `model`

I’d enrich in priority order.

### Priority 1: Identity and status

- Name
- Park
- Country
- Status
- Opening date
- Coordinates

### Priority 2: Manufacturer and model

- Manufacturer
- Model
- Material

### Priority 3: Technical stats

- Height
- Speed
- Length
- Inversions

### Priority 4: Classification

- Type: sit-down, inverted, launched, suspended, stand-up, flying, family, wild mouse, shuttle, etc.

The `type` field should eventually use a controlled vocabulary instead of free text.

Possible future table:

```sql
create table public.coaster_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  description text
);
```

But for now, we can keep `type text` and normalize values.

---

## 16. Data quality checks

I’d add automated validation.

### Structural checks

- Height, speed, length must be non-negative.
- Inversions must be integer and non-negative.
- Latitude between -90 and 90.
- Longitude between -180 and 180.
- Every coaster must belong to a park unless it is a candidate.
- Slugs should be stable and URL-safe.

### Logical checks

- `status = 'under_construction'` with opening date far in the past should be reviewed.
- `status = 'operating'` with future opening date should be reviewed.
- `status = 'defunct'` but recent evidence says operating should be reviewed.
- Height/speed/length outliers should be reviewed.

Example outlier thresholds:

| Field | Warning threshold |
|---|---:|
| height_m | > 200 |
| speed_kmh | > 250 |
| length_m | > 5000 |
| inversions | > 15 |

These are not impossible, but they should require review.

### Completeness checks

Track percentage of coasters with:

- Manufacturer
- Opening date
- Status verified
- Coordinates
- Height
- Speed
- Length
- Material
- Type

### Freshness checks

Track:

- Verified in last 3 months
- Verified in last 12 months
- Not verified in 24 months
- Legacy import still unverified

---

## 17. App workflow improvements

Since there is already an app that can visualize and CRUD existing imports, I’d extend it into a review console.

### Candidate review screen

Show:

- Candidate name
- Guessed park
- Country
- Source
- Evidence URL
- Snippet
- Confidence
- Possible matches
- Accept / reject / duplicate buttons

### Coaster detail screen

Show:

- Current canonical values
- All observations
- External IDs
- Aliases
- Status history
- Last verified date
- Confidence
- Flags

### Stale review queue

Filter:

- `under_construction` older than 1 year
- `unknown` status
- No evidence since 2022
- Low confidence
- Missing opening date
- Missing park location

### Merge screen

Side-by-side comparison:

- Two possible duplicate coasters
- Sources for each
- Field conflicts
- Merge button with reason

### Evidence capture

When an admin manually verifies a coaster, the app should ask for:

- Source URL
- Evidence date
- Status observed
- Notes

This turns manual work into durable provenance.

---

## 18. Continuous refresh: making the database “breathing”

A one-time import will immediately become stale. We need ongoing refresh.

### Scheduled jobs

Examples:

| Job | Frequency |
|---|---:|
| Official park page refresh | monthly |
| Manufacturer page refresh | monthly |
| News search for new openings | weekly |
| Government registry refresh | quarterly |
| Wikidata sync | weekly |
| OSM discovery | quarterly |
| Stale record review | weekly |
| Low-confidence record review | weekly |

### Change detection

For official park pages:

- Store content hash.
- Detect page changes.
- Re-extract if relevant keywords appear:
  - “coaster”
  - “new”
  - “opening”
  - “closed”
  - “coming soon”
  - “now open”

For news:

- Create saved searches for major parks and manufacturers.
- Alert on new articles mentioning coaster openings/closures.

### Active learning

Prioritize review by expected impact:

1. Parks with known coasters but stale status.
2. Countries with low coverage.
3. Manufacturers with many recent announcements.
4. Candidates with high confidence.
5. Records with conflicting sources.

---

## 19. Suggested source reliability hierarchy

I would use something like this:

| Rank | Source | Reason |
|---:|---|---|
| 1 | Official park page | Direct operator evidence |
| 2 | Manufacturer announcement | Direct builder evidence |
| 3 | Government ride registry | Official operational evidence |
| 4 | Major news outlet | Timely, usually credible |
| 5 | Park social media | Official but harder to archive |
| 6 | Wikidata/Wikipedia | Good discovery, variable quality |
| 7 | OpenStreetMap | Good geospatial discovery, license care needed |
| 8 | Fan site | Useful lead, not source of truth |
| 9 | User submission | Requires evidence |

This hierarchy should be configurable, not hardcoded.

---

## 20. Example operational workflow

Let’s say we discover a coaster called “Sky Eagle” at a park.

### Step 1: Candidate created

From an official park page:

```text
Sky Eagle - a new launched coaster - opening spring 2025
```

Candidate:

```text
name: Sky Eagle
park: Happyland Theme Park
status: under_construction
opening_date: 2025-05-01 approximate
source: official_park
confidence: 0.7
```

### Step 2: Later evidence

News article says:

```text
Sky Eagle opened to the public on May 24, 2025.
```

Observation:

```text
observed_status: operating
observed_opening_date: 2025-05-24
confidence: 0.8
```

### Step 3: Official page updated

Park page now says:

```text
Sky Eagle is now open.
```

Observation:

```text
observed_status: operating
confidence: 0.95
```

### Step 4: Update canonical record

- Status becomes `operating`.
- Opening date becomes `2025-05-24`.
- Status history row added.
- `last_verified_at` updated.
- Confidence becomes high.

This is the kind of lifecycle we want for thousands of coasters.

---

## 21. Budget-conscious implementation

If the budget is meager, I’d prioritize free/open sources first.

### Low-cost stack

- PostgreSQL
- Python
- Airflow, Prefect, or cron-based jobs
- httpx/requests for fetching
- Playwright only where necessary
- PostgreSQL `pg_trgm` for matching
- LLM API only for high-value extraction
- Search API with limited monthly quota
- Manual admin review for edge cases

### Budget allocation

Possible monthly allocation:

| Item | Purpose | Estimated priority |
|---|---|---|
| Search API | Discovery queries | High |
| News API | Opening/closure monitoring | Medium |
| LLM extraction | Parsing unstructured pages | High |
| Geocoding API | Park location enrichment | Low/Medium |
| Storage | Raw snapshots | Low |
| Proxy/anti-bot | Avoid, unless legally/ethically appropriate | Avoid if possible |

I would avoid expensive scraping infrastructure that may conflict with site terms.

---

## 22. Metrics and dashboards

I’d track:

### Coverage metrics

- Total canonical coasters
- Total candidates
- Total parks
- Parks with at least one coaster
- Countries with coaster coverage
- Manufacturers with coaster coverage

### Freshness metrics

- Coasters verified in last 3 months
- Coasters verified in last 12 months
- Coasters not verified since 2022
- Under-construction records older than 12 months
- Unknown-status records

### Quality metrics

- Percent with manufacturer
- Percent with opening date
- Percent with coordinates
- Percent with height/speed/length
- Percent with status evidence
- Percent with multiple sources
- Duplicate rate
- Manual correction rate

### Pipeline metrics

- Candidates created per week
- Candidates accepted per week
- Candidates rejected per week
- Candidates pending review
- Extraction failures
- Fetch failures
- Source outages

---

## 23. 30/60/90-day plan

### First 30 days: Foundation

Goals:

1. Finalize scope and source policy.
2. Add provenance tables.
3. Mark legacy import as stale.
4. Build source registry.
5. Start with official park and manufacturer sources.
6. Create review UI basics.

Deliverables:

- Schema migration for sources, observations, candidates, status history.
- Legacy import flagged with low confidence.
- List of high-priority sources.
- First batch of candidates from official park sites.
- Admin review workflow.

### First 60 days: Expansion

Goals:

1. Add Wikidata/Wikipedia discovery.
2. Add manufacturer-based discovery.
3. Build matching/dedup pipeline.
4. Refresh existing `under_construction` records.
5. Add status history and evidence links.

Deliverables:

- Existing 2022 import partially refreshed.
- Under-construction records reviewed.
- Several hundred or thousand new candidates.
- Duplicate review queue.
- Confidence scores in database.

### First 90 days: Continuous operation

Goals:

1. Automate scheduled refreshes.
2. Add news monitoring for new openings.
3. Add country-by-country campaigns.
4. Add quality dashboards.
5. Establish weekly review process.

Deliverables:

- Breathing database with regular updates.
- Clear path from 1,000 to 6,000 records.
- Auditable evidence for status changes.
- Operational pipeline for new candidates.
- Metrics showing freshness and completeness.

---

## 24. Risks and mitigations

### Risk 1: Incomplete public data

Mitigation:

- Use multiple sources.
- Prioritize official sources.
- Mark low-confidence records instead of pretending certainty.

### Risk 2: Duplicate records

Mitigation:

- Candidate staging.
- Fuzzy matching.
- Human merge review.
- Merge log.

### Risk 3: Outdated status

Mitigation:

- Status history.
- Last verified timestamp.
- Scheduled refreshes.
- News monitoring.

### Risk 4: Licensing issues

Mitigation:

- Source registry.
- License field.
- Avoid copying article text.
- Use factual extraction with attribution.
- Exclude disallowed sources like RCDB.

### Risk 5: Over-reliance on automation

Mitigation:

- Auto-fill nulls only when safe.
- Human review for merges and status conflicts.
- Confidence scoring.
- Audit trail.

### Risk 6: International coverage gaps

Mitigation:

- Country campaigns.
- Local-language search queries.
- Park-first discovery.
- Manual review for underrepresented regions.

---

## 25. My recommended first concrete action

If I had to pick the very first practical step, it would be:

> **Add provenance and candidate tables, mark the 2022 import as stale, and build a review pipeline for `under_construction` and `unknown` records.**

That immediately improves data quality and creates the infrastructure needed to scale to 6,000 coasters.

Then I’d launch a combined discovery effort:

1. Official park websites.
2. Manufacturer installation/announcement pages.
3. Wikidata/Wikipedia.
4. OpenStreetMap, with license care.
5. News searches for 2023–2026 openings.
6. Government ride registries where available.

The end state should be:

- Every coaster has a canonical record.
- Every important fact has at least one evidence source.
- Status changes are historically tracked.
- New candidates are discovered continuously.
- Humans review ambiguous cases.
- The database gets more complete and more trustworthy over time.
