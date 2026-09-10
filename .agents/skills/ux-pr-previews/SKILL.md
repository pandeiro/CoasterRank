---
name: ux-pr-previews
description: Adding desktop+mobile screenshots to UX PRs — use when preparing PR previews/assets for a UI change, capturing Playwright screenshots of app pages with mocked data or a fake session, or writing a docs/previews/ gallery. Covers the capture harness (scripts/src/e2e/previews.ts), the fake-session + Supabase-mock protocol, prod-safety tiers, and the PR-body image embed pattern.
---

# UX PR previews (CoasterRank)

Desktop+mobile screenshots committed to the repo and embedded in the PR body so
reviewers see the change. Precedent: PRs #159 (share-nudge), #155 (email
templates), #148 (gutter). Harness: `scripts/src/e2e/previews.ts` — sibling of
`scripts/src/e2e/helpers.ts` (which owns login/gesture QA; see also
`.agents/skills/mobile-drag-qa`).

## Workflow

1. **Design the shots first.** 2–6 shots that show the state change: the
   component/feature in context + its key states, each at desktop **and**
   mobile. Clipped component shots for fine work (gutters, typography);
   full-page for layout. Not every shot needs both viewports, but layout
   changes do.
2. **Pick a state tier** (next section). Default: fake session + mocked reads
   — zero prod contact, fully deterministic, works on branches whose
   migrations aren't deployed yet.
3. **Write a thin capture scenario**
   `scripts/src/e2e/scenarios/previews-<slug>.ts` (committed by default), run
   it, review the PNGs it wrote to `docs/previews/<slug>/` — retake until they
   actually show the thing (check console warnings the harness prints).
4. **Write `docs/previews/<slug>/README.md`**: one-line "what's shown" per
   file + how the state was faked. This is the record that survives when the
   glue is deleted (see template below).
5. **Commit PNGs + README + scenario** to the feature branch.
6. **Push, then create the PR** with `prSnippet()` output pasted into the body
   (raw.githubusercontent URLs render on GitHub via camo). Put full-size
   narrative shots inline; a two-column table works well for mobile pairs.
7. **Post-merge**: PNGs live on at `docs/previews/<slug>/` (raw URLs rot once
   the branch is deleted — cosmetic; swap to `blob/main` links only if someone
   complains). Delete the scenario only if it was truly throwaway.

## State tiers (prod safety)

We develop against prod. Escalating trust — stop at the first tier that shows
your state, and never go past tier 3 without asking:

| Tier | What | Prod contact | Rules |
| --- | --- | --- | --- |
| 1 | **Component harness**: temp React page rendering the real component with stub props | none | Remove the harness file before merge (precedent: share-nudge states, welcome modal). |
| 2 | **Fake session + `mockSupabase()`**: localStorage session, fixtures fulfilled locally, pass-through swapped to anon | anon reads only (logged, printed) | No real user's data is read; writes fail RLS as anon — but keep flows read-only anyway. Mock every table the fake user "owns" (`profiles`, `user_rides`, …); only the public catalog may pass through. Best tier for new migrations/RPCs that exist only on your branch. |
| 3 | **Real synthetic-user login** (`helpers.login()`) | reads as that user | Read-only flows only (no drags — they write ranks). Synthetic users are a possibility, not a presence: `testride:report` first, **ask before seeding** (`docs/TEST_DATA.md`). |

Never: real production users' data in shots; sessions for real accounts;
anything that writes (screenshots are capture-only — if your state needs a
write, that write belongs in a fixture or an explicit user-approved seed).

## Harness cheatsheet (`scripts/src/e2e/previews.ts`)

```ts
import { config } from 'dotenv'
config({ path: new URL('../../../../.env', import.meta.url).pathname })

import { chromium } from 'playwright'
import { ensureServer } from '../helpers'
import {
  capturePreviews, mockSupabase, openPreview, prSnippet, waitForVisible,
} from '../previews'

const SLUG = 'my-feature'
const FAKE_ID = '00000000-0000-4000-8000-0000000000aa'

async function main(): Promise<void> {
  await ensureServer() // dev server on :5199 (cd app && npm run dev -- --port 5199 --strictPort)
  const browser = await chromium.launch()
  try {
    const files = await capturePreviews(
      browser, SLUG, 'my-component',
      async (kind) => {
        const page = await openPreview(browser, kind, {
          session: { id: FAKE_ID, email: 'preview@coasterrank.dev', username: 'preview_rider' },
        })
        await mockSupabase(page, {
          tables: {
            profiles: { id: FAKE_ID, username: 'preview_rider', display_name: 'Preview Rider',
                        avatar_url: null, is_admin: false, public_list: false, og_image_url: null },
            user_rides: [],
          },
          rpcs: { share_nudge_eligibility: { eligible: false } },
        })
        await page.goto('http://localhost:5199/me')
        await waitForVisible(page, 'main')
        return page
      },
      { clip: 'main' }, // or omit for full-page
    )
    console.log(prSnippet(SLUG, files)) // paste output into the PR body
  } finally {
    await browser.close()
  }
}

void main()
```

API: `PREVIEW_VIEWPORTS` (desktop 1280×800, mobile 390×844, 1x), `openPreview`
(session + pointer pinning per kind), `mockSupabase(page, { tables, rpcs })`
→ `{ prodReads() }`, `visibleFirst`/`waitForVisible`, `settle` (fonts +
scroll-to-top + frozen animations + delay), `shoot`-level control via
`capturePreviews` opts (`fullPage`, `clip`, `clipPad`, `freezeAnimations`,
`settleMs`), `previewFile`, `previewUrl`, `prSnippet(slug, files, branch?)`,
`currentBranch()`. Email-template precedent (deterministic regeneration):
`scripts/src/oneoff/render-email-previews.ts`.

## Known traps (don't re-derive)

- **Multi-match selectors**: the app renders CSS-gated duplicate layouts
  (`hidden md:block` desktop twins) — bare `waitForSelector` stalls on the
  hidden DOM-first copy. Always `waitForVisible()` / `visibleFirst()` (both
  built-in).
- **Fake-session 401s**: Supabase's gateway rejects the fake Bearer BEFORE
  RLS, so even anon-open reads 401. `mockSupabase()` pass-through swaps the
  header back to the anon key automatically. Mock everything the page needs:
  tables the fake user "owns" (`profiles`, `user_rides`) 401 even as anon (no
  anon policy), and **RPCs have no anon EXECUTE by default** — a page calling
  an unmocked RPC will 401-storm it (harmless for rendering, noisy in
  console). The public catalog (`coasters`, `parks`, …) passes through fine.
  List queries take arrays; `.single()` queries take an object.
- **Route registration order**: register `mockSupabase()` BEFORE the first
  `page.goto`; scenario handlers added after it override its catch-alls.
- **Login redirect races `networkidle`** (tier 3) — wait for URL change, then
  content (`helpers.login()` handles it).
- **HMR staleness**: hard-reload (fresh context — the harness makes a new one
  per shot) after source edits; don't trust one long-lived page.
- Realtime channels: none in the app — no websocket mocking needed.

## Conventions

- **Paths/naming**: `docs/previews/<feature-slug>/<shot>-desktop.png` /
  `-mobile.png` (numbered prefixes `01-…` for ordered flows). Viewports
  1280×800 / 390×844, DSF 1. Keep shots purposeful (2–6 per PR); PNGs are
  committed forever — clip instead of giant full-pages when a component is the
  subject.
- **No real data, no real emails/tokens in shots** (email precedent: fake
  8-digit codes, `example.com` addresses).
- **README template** (`docs/previews/<slug>/README.md`):

  ```markdown
  # <Feature> previews
  Captured <date> against the PR build at localhost:5199.

  ## What's shown
  | File | Shows |
  | --- | --- |

  ## How the state was faked
  <tier used, fixtures mocked, prod contact: none / anon pass-through reads of X>
  ```

- **PR-body embed**: `prSnippet()` emits
  `![alt](https://raw.githubusercontent.com/<owner>/<repo>/<head-branch>/docs/previews/<slug>/<file>)`
  — must name the head branch to render pre-merge. Push before creating the
  PR. Mobile pairs side-by-side in a table reads well.
- **Scenario lifecycle**: commit capture scenarios by default (reproducible;
  email-script precedent). Delete only if branch-specific glue that would rot
  — then the README's "how faked" section is the surviving record.

## Pre-PR checklist

- [ ] Shots reviewed by a human eye (correct state, no loading spinners, no
      broken images/avatars, console warnings printed by the harness addressed
      or explained)
- [ ] `docs/previews/<slug>/README.md` written
- [ ] `prodReads()` output sane (no unexpected tables touched)
- [ ] No stray files committed (`.DS_Store` etc.); PNGs ~≤1 MB each
- [ ] Scenario committed or consciously deleted
- [ ] `cd scripts && npm run typecheck` passes
