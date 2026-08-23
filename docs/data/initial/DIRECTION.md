# Direction

Treat this as an ops problem, not an infrastructure problem: split the report into bulk-safe fixes, batch-assisted adds, and human adjudication, then clear them in that order. The fastest path is to fix park identity first, then re-home obvious orphaned coasters, then insert truly missing coasters in batches, while reserving humans for the ambiguous same-name/rename cases.

A few reasons this is the right shape for this repo as it exists now:

- The report already gives a strong backlog: 24 unique missing parks, 128 park-found/coaster-missing, 32 park-not-found entries.
- A lot of misses are not true missing entities. They are:
- park naming mismatches
- coaster naming variants
- coasters stranded in Other (unknown location) or under the wrong park
- The current admin UI supports manual re-homing, but it is too one-by-one for a 200+ item cleanup.
- The long-term strategy doc is right: for launch prep, the win is ad-hoc throughput, not building a full candidate/provenance system first.

## Process

1. Build a triage sheet from the report into 4 buckets.
- Missing park entirely
- Park exists, coaster exists elsewhere and should be re-homed
- Park exists, coaster is truly missing
- Ambiguous fuzzy match / needs human judgment
2. Fix the park layer first.
- Create the 24 missing parks.
- Add a synthetic Travelling park, same idea as Other (unknown location).
- Maintain a simple alias map outside the schema for ingestion/reconciliation, for cases like Busch Gardens Tampa vs Busch Gardens Tampa Bay, Europa Park vs Europa-Park, Hansa Park vs Hansa-Park.
3. Do bulk re-homing next.
- This should clear many high-value misses quickly: Batman: The Ride, Flight of Fear, Possessed, Gemini, TRON, etc.
- These are best handled by code generating candidate UPDATEs plus a human spot-check, not by clicking the admin UI repeatedly.
4. Batch-add missing coasters at known parks.
- Once park identity is cleaned up, many remaining rows become straightforward inserts.
- Process by park, not by coaster, because one research pass often resolves several rows at once.
5. Reserve humans for the genuinely ambiguous items.
- Examples: Comet, Cyclone, Twister, Monster, Medusa, cases where the name exists at multiple parks or the fuzzy match is misleading.
- This is where the harness/LLM should assist with evidence gathering and draft SQL, but a human should approve.

## How I’d divide the work

### Code:
- deterministic bucketing
- alias application
- candidate SQL generation
- bulk re-home / insert scripts

### Harness / LLM:
- park-by-park research
- name normalization judgments
- drafting structured evidence and SQL for medium-confidence cases

### Human:
- approve ambiguous cases
- spot-check batch outputs
- decide policy edge cases like Travelling, clone naming, and when to reuse vs create parks
