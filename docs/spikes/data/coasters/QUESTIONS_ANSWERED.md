# Questions and Answers

## A. Scope: what counts as a roller coaster?

1. **What entities should be included?**
   - Permanent amusement/theme park coasters only? - MOSTLY, YES
   - Family entertainment centers, fairgrounds, zoos, ski resorts, shopping malls? - ONLY IF ACTUAL ROLLER COASTER - CAR ON RAILS
   - Water coasters, powered coasters, kiddie coasters, wild mice, alpine coasters, bobsleds, suspended coasters? - YES, IF THEY HAVE RAILS
   - Seasonal or traveling coasters? - POSSIBLY
   - Announced but never built coasters? - NOT NECESSARY
   - Coasters that are relocated or stored? - YES

2. **What statuses matter?**
   - Do we include `sbno` as a distinct status indefinitely? - YES
   - If a coaster is closed but not demolished, is it `defunct` or `sbno`? - THAT'S SBNO - STANDING BUT NOT OPERATING
   - Do we track announced/under-construction coasters even if opening is years away? - ONCE ANNOUNCED PUBLICLY
   - Do we track removed coasters historically, or only current/recent coasters? - WE SHOULD NEVER DELETE BUT ONCE DEMOLISHED, UPDATES NO LONGER NEEDED

3. **What level of historical tracking is required?**
   - If a coaster relocates, is that one coaster with a location history, or two coaster records linked together? - ONE COASTER, AND WE CARE ONLY ABOUT NEW CURRENT STATUS
   - If a coaster is renamed, do we preserve old names as aliases? - NICE TO HAVE
   - If a park rebrands or changes ownership, do we preserve park history? - JUST UPDATE PARK NAME IF NECESSARY

## B. Data quality and freshness

4. **How fresh does the data need to be?**
   - Is “verified within the last 12 months” acceptable? - YES BUT MAYBE A SHORTER CADENCE IS BETTER TO CAPTURE THE UNDER CONSTRUCTION TO OPERATING CYCLE MORE CLOSELY
   - Do we need near-real-time status updates for new openings? - NICE TO HAVE
   - Is it acceptable for some international parks to be reviewed only every 24 months? - ALL TOP TIER PARKS SHOULD PROBABLY BE REVIEWED AT THE SAME CADENCE

5. **What confidence threshold is acceptable for automated updates?**
   - Can the system automatically mark a coaster as `operating` if one official park page says so? - WOULD THINK SO
   - Do status changes require two independent sources? - NOT SURE, MAYBE ONE OFFICIAL SOURCE IS FINE, OR ONE ADMIN CONFIRMATION
   - Should humans approve all merges and deletions? - PROBABLY

## C. Legal, ethical, and licensing constraints

6. **Which open sources are legally acceptable?**
   - Wikipedia/Wikidata: usually fine with attribution, but need to confirm license compatibility.
   - OpenStreetMap: ODbL may require careful handling.
   - Government ride-inspection data: usually public, but terms vary by jurisdiction.
   - Official park and manufacturer websites: generally okay to read and extract factual data, but scraping terms need review.

7. **What is the policy around RCDB?**
   - I would assume: no scraping, no bulk extraction, no copying of structured records, no use of their IDs, and no use of RCDB pages as extraction input.
   - It may be acceptable only as a general awareness that the world has more than 1,000 coasters, but not as a data source.
   - COMMENT: RCDB LINKS FOR COASTERS MIGHT BE GREAT METADATA TO INCLUDE FOR USERS TO GET MORE DATA

8. **Can we store raw evidence?**
   - We should store source URLs, fetch timestamps, snippets, and possibly cached HTML/PDFs for auditability. - YES WE COULD STORE EVIDENCE BUT PROBABLY SHORT RETENTION
   - Need to confirm retention policy and whether raw page snapshots are acceptable. - WOULD NEED TO UNDERSTAND COSTS TO DETERMINE IDEAL RETENTION POLICY

## D. Product and operational constraints

9. **How will admins interact with the data?**
   - Does the existing app support bulk imports? - APP DB IS POSTGRES SO BULK INSERTS / SCRIPTS SHOULD BE EASY
   - Can we add review screens for candidates, duplicates, and stale records? - YES THIS IS PROBABLY AN IMPORTANT PART OF HUMAN CURATION
   - Can admins attach evidence URLs to each record? - NOT SURE MODEL SUPPORTS CURRENTLY BUT GOOD TO ADD

10. **What is the expected human review capacity?**
   - If we generate 10,000 candidates, can staff review 50 per day? 500 per day? - PROBABLY CLOSER TO 50
   - Should we build a community contribution workflow later? - WE HAVE SUBMISSIONS ALREADY, SO YES THIS IS A PART OF THE PLAN

11. **What is the actual budget?**
   - A meager budget can still cover search APIs, news APIs, geocoding, and modest LLM extraction costs. - YES
   - If the budget is near zero, we should prioritize official sources, Wikidata, Wikipedia, OpenStreetMap, and manual review. - YES

12. **What are the success metrics?**
   - Total coaster count? - NOT REALLY
   - Percentage of records verified in the last 12 months? - NO
   - Percentage of coasters with opening date, manufacturer, status, and coordinates? - NO
   - Duplicate rate? - YES, DUPLICATES ARE BAD AND NEED TO BE CLEANED
   - False positive rate from automated imports? - YES
   - COMMENT: MOST IMPORTANT METRIC IS QUALITATIVE - "COMPLETENESS" - NO FAMOUS COASTERS MISSING OR PRESENT AS DUPLICATES

