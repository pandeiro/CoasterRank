# Static-page body size previews
Captured 2026-10-24 against the PR build at localhost:5199.

## What's shown
| File | Shows |
| --- | --- |
| about-desktop.png | About page body copy at the new `text-base` (16px) size, desktop column |
| about-mobile.png | Same, mobile viewport |
| faq-desktop.png | FAQ at the new body size (also shows `text-lg` section heads) |
| faq-mobile.png | Same, mobile viewport |

## How the state was faked
Tier 1: no session, no mocks — About and FAQ are public pages that make no
Supabase reads. Capture-only; no prod contact.
Scenario: `scripts/src/e2e/scenarios/previews-static-body-size.ts`.
