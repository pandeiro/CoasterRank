# Questions and Answers

## A. Scope: what counts as a roller coaster?

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

## B. Data quality and freshness

4. **How fresh does the data need to be?**
   - Is “verified within the last 12 months” acceptable?
   - Do we need near-real-time status updates for new openings?
   - Is it acceptable for some international parks to be reviewed only every 24 months?

5. **What confidence threshold is acceptable for automated updates?**
   - Can the system automatically mark a coaster as `operating` if one official park page says so?
   - Do status changes require two independent sources?
   - Should humans approve all merges and deletions?

## C. Legal, ethical, and licensing constraints

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

## D. Product and operational constraints

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

