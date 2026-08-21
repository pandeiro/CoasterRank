# Consolidated Comments on Data Strategy

Extracted from `COMMENTS_RAW.md`. Each comment is de-duped and paired with its original context.

---

## 1. Submissions vs Candidate/Staging Layer

**Original Context**: Section 3 (Candidate/staging layer) and Section 4C (Candidate coasters table) — the proposed `coaster_candidates` table and how it relates to the existing `coaster_submissions` table.

**Consolidated Comment**: We already have a `coaster_submissions` table and UI for user submissions with a manual review queue. The proposed candidate/staging layer for scraped/discovered coasters seems conceptually similar. Should submissions and scraped candidates share the same review queue? If so, the provenance would just differ (user vs. scraping), but the review workflow could be unified. This would avoid duplicate admin UI and redundant logic.

---

## 2. Continuous Refresh & ETL Infrastructure

**Original Context**: Section 5 (Continuous refresh layer) — using pg_cron/Edge Functions for scheduled checks; Section 21 (Budget-conscious implementation) — whether to run ETL on Supabase, a VPS, or locally with a lightweight LLM.

**Consolidated Comment**: We already use `pg_cron` for the 15-minute rankings recompute. Can we extend this to fire Edge Functions for periodic data refresh? Alternatively, would it make more sense to run heavier ETL (especially LLM-assisted extraction) locally on a MacBook with a local LLM (e.g., Qwen 2.7B/7B) to avoid API costs? Need to estimate LLM usage volume and compare commercial API vs. local inference costs. Also have access to a Brave Search API key (rate-limited) that could be used remotely or locally.

---

## 3. RCDB Mirror as Existence Confirmation Only

**Original Context**: Section 3 (Key principle: do not copy RCDB) — operational safeguards against using RCDB data.

**Consolidated Comment**: While we must not copy RCDB data directly (ToS prohibition), we *may* use RCDB mirror projects (e.g., `fabianrguez/rcdb-api` with 2-year-old scraped JSON) simply to **confirm coaster existence** as a lead generator. Any such lead must still be verified against an acceptable public source before entering our database.

---

## 4. Duplicate Detection & Review States

**Original Context**: Section 4G (Operational metadata on canonical coasters) — `review_state` values including `needs_review`, `possibly_duplicate`, `possibly_outdated`.

**Consolidated Comment**: How would a duplicate be detected? This hasn't been discussed in detail. Also, what's the practical difference between `needs_review` and `possibly_outdated`? The former suggests a general data quality issue; the latter specifically flags staleness. Need clear definitions and detection logic (e.g., fuzzy matching on name + park + manufacturer + year).

---

## 5. Park Type Values

**Original Context**: Section 6 (Park-first discovery strategy) — proposed `park_type` column on `parks` table.

**Consolidated Comment**: What would `park_type` values be? Examples: `theme_park`, `amusement_park`, `water_park`, `family_entertainment_center`, `fairground`, `zoo`, `ski_resort` (for alpine coasters), `other`. Should this be an enum or free text? An enum would aid filtering but requires maintenance. Not sure how useful this is, honestly.

---

## 6. External ID Semantics for Parks

**Original Context**: Section 6 — proposed `park_external_ids` table.

**Consolidated Comment**: What do these external IDs refer to? Corporate IDs (e.g., Six Flags park IDs), Wikidata QIDs, OSM IDs, RCDB park IDs (for reference only), tourism board IDs? The table design is generic (`source_id`, `external_id`, `url`), but we should document the expected source types.

---

## 7. LLM Extraction Cost Estimation

**Original Context**: Section 7 (Candidate discovery pipeline, Stage 2: Extraction) — LLM-assisted extraction for unstructured pages.

**Consolidated Comment**: We should estimate how much LLM usage we'd need, and what model size/level of reasoning, to compare costs of commercial API vs. running ETL locally on a local model. This is critical for budgeting the continuous refresh layer.

---

## 8. Unit Conversion at Application Layer

**Original Context**: Section 7 (Stage 3: Normalization) — converting ft→m, mph→km/h, etc.

**Consolidated Comment**: US-based coasters often use Imperial units; rest of world uses metric. We should detect and handle conversion at the application layer (in the extraction/normalization code), not in the database. The database stores only metric (SI) values.

---

## 9. What Constitutes a "Record" for Corroboration?

**Original Context**: Section 9 (Confidence scoring) — corroboration: "A record is more trustworthy when multiple independent sources agree."

**Consolidated Comment**: What's the "record" here? A candidate? An observation? The consolidated canonical coaster? The model needs to be explicit: confidence should ultimately attach to the **canonical coaster's fields**, with each field having its own evidence trail. The `coaster_observations` table design supports this, but the confidence scoring section speaks at a coarser granularity.

---

## 10. Field-Level Confidence Complexity

**Original Context**: Section 9 (Field-level confidence) — confidence per field (name: high, status: high, height: low, etc.).

**Consolidated Comment**: Good point, but this introduces significant complexity. First priority is an accurate and comprehensive **list of coasters** (existence, park, status). Technical stats (height, speed, length) are secondary. Defer field-level confidence until the core pipeline is solid.

---

## 11. Prioritize Duplicate Detection/Merging for Legacy Import

**Original Context**: Section 10 (Fixing the existing 1,000-record import, Step 3: Prioritize records for review).

**Consolidated Comment**: The legacy dataset is known to have duplicates and messy data. We should prioritize detecting/merging duplicate entries in the existing import before or alongside status refresh. Duplicate resolution is a prerequisite for accurate counts and rankings.

---

## 12. RCDB Mirror as Candidate Lead Source

**Original Context**: Section 11 (Campaign A: Wikidata/Wikipedia expansion).

**Consolidated Comment**: The RCDB mirror (e.g., `fabianrguez/rcdb-api`) could be a good lead source to point at potential candidates, even though we can't use it as a primary source. It can help identify gaps in our coverage.

---

## 13. OSM Legal Risk

**Original Context**: Section 11 (Campaign B: OpenStreetMap park discovery) — ODbL licensing requires care.

**Consolidated Comment**: Maybe not worth it if there are legal risks. OSM's ODbL license has share-alike implications that could conflict with our proprietary database. Need legal review before integrating OSM data directly. At minimum, use only for discovery/geospatial hints, not as a bulk source.

---

## 14. LLM for Duplicate Merging

**Original Context**: Section 13 (Automated vs manual processing) — human review required for merging duplicates.

**Consolidated Comment**: Could a capable LLM do duplicate merging well enough? Or at least return a verdict and confidence score for human review? This could significantly reduce manual effort for the large backlog of potential duplicates.

---

## 15. Type Classification Subjectivity

**Original Context**: Section 15 (Enrichment plan, Priority 4: Classification) — `type` field (sit-down, inverted, launched, etc.).

**Consolidated Comment**: This classification is subjective and hard to track consistently. Not worth a controlled vocabulary except as best-effort free text. A separate `coaster_types` table is overkill for v1. Keep `type text` and normalize values opportunistically.

---

## 16. Data Quality Dashboard Visibility

**Original Context**: Section 16 (Data quality checks) — freshness/completeness checks.

**Consolidated Comment**: These metrics would be great to track and surface in a specialized data dashboard, but without visibility (no dashboard built yet), the effort may not be worth it. Defer until there's a UI to consume them.

---

## 17. Merge Screen for Metadata Consolidation

**Original Context**: Section 17 (App workflow improvements) — merge screen with side-by-side comparison.

**Consolidated Comment**: Good idea. Especially important to merge metadata correctly when different entries have different collections of metadata (e.g., one has height, another has manufacturer). The merge should be additive, not destructive.

---

## 18. Finding Specific Park Page URLs for Change Detection

**Original Context**: Section 18 (Continuous refresh, Change detection) — store content hash, detect page changes.

**Consolidated Comment**: Ideally we'd store the specific page within a park website that has the relevant data (e.g., `/rides`, `/attractions`, `/thrill-rides`). How do we find those specific URLs initially? Manual curation per park? Automated discovery via sitemap/crawl? This is a prerequisite for effective change detection.

---

## 19. Local ETL with Local LLM

**Original Context**: Section 21 (Budget-conscious implementation) — low-cost stack, local ETL.

**Consolidated Comment**: Our stack includes Supabase free tier (Postgres, Edge Functions, object store) and Netlify. We can do a lot locally: consider a monthly, manually kicked-off big scrape/processing job using a lightweight local LLM (e.g., Qwen 2.7B). Also have Brave Search API key for discovery. Could shift to remote if useful. Not sure about News APIs or Reddit scraping (browser extension for manual surf/extract of key subreddits?).

---

## 20. MVP Timeline Preference

**Original Context**: Section 23 (30/60/90-day plan).

**Consolidated Comment**: The phased plan makes sense, but would prefer a **first 24–48 hours** effort that gets us 80–90% of the way to a sufficiently comprehensive and accurate list for launch. Data quality maintenance can be secondary/ongoing. The priority is launch-ready data.

---

## 21. End State Alignment, MVP Path Divergence

**Original Context**: Section 25 (Recommended first concrete action).

**Consolidated Comment**: Agreed on the end state (canonical records, evidence for every fact, status history, continuous discovery, human review). Diverge slightly on MVP path: prefer more ad-hoc, non-scalable work initially to get a high-quality dataset fast, then build scalable infrastructure.
