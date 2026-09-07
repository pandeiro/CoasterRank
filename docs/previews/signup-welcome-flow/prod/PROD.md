# Signup → first ranking: live prod verification (post-#142)

> 2026-09-07. Headless Chromium (Playwright) against `https://coasterrank.app`,
> driven end-to-end: real signup → real confirmation email (Resend SMTP, sender
> `ops@coasterrank.app`) → real inbox click (Gmail, plus-addressed test
> aliases) → ranking. Synthetic-user portions used the `testride` CLI
> (5 users, seeded + cleaned up in the same session). All test accounts and
> synthetic users were deleted afterwards; `testride:report` = 0 synthetic.

## What was verified live

| # | Behavior | Result | Evidence |
| - | -------- | ------ | -------- |
| 1 | Logged-out visit to `/submit` bounces to `/login`, stashing the destination | ✅ | ![1](01-requireauth-bounce-login.png) |
| 2 | Signup form (username rules, private-by-default microcopy) | ✅ | ![2](02-signup-form.png) |
| 3 | "Check your email" panel after signup | ✅ | ![3](03-check-your-email-panel.png), deep-link variant ![4](04-check-your-email-deep-link.png) |
| 4 | Confirmation email arrives in Gmail **inbox** (not spam; sender `ops@coasterrank.app`); original-signup link carries `redirect_to=/login?confirmed=1[&next=…]` | ✅ | link URLs captured in session notes |
| 5 | `/login?confirmed=1` shows the green banner, signs the user in via the URL token, auto-forwards | ✅ | ![5](05-login-confirmed-banner.png) |
| 6 | **Deep link survives the email round-trip**: `next=%2Fsubmit` → auto-forward lands on `/submit` | ✅ | ![6](06-deep-link-landed-submit.png) |
| 7 | Welcome modal renders for a zero-ride confirmed user at `/me?welcome=1` | ✅ | ![7](07-welcome-modal-from-email.png) |
| 8 | "Start ranking" dismisses modal (persists; param cleared) | ✅ | ![8](08-me-after-start-ranking.png) |
| 9 | Search → add → rank 3 coasters; toast + list correct; rows persist in `user_rides` | ✅ | ![9](09-me-ranked-3.png) |
| 10 | Modal suppressed for users with rides > 0, even with `?welcome=1` | ✅ | ![10](10-no-modal-after-ranking.png) |
| 11 | Plain password login without params shows no modal; wrong-credential path shows "Email not confirmed" + resend affordance | ✅ | ![11](11-login-unconfirmed-resend.png) |
| 12 | testride matrix: seeded zero-ride user at `/me?welcome=1` shows modal; back-button revisit suppressed; milestone-2 CTA ("11 coasters ranked!") + dismiss persistence; desktop drag reorder + restore; touch long-press drag + scroll guard + restore | ✅ | ![15](15-welcome-modal-testride.png), ![16](16-share-cta-milestone2.png), ![17](17-desktop-drag-reorder.png), ![18](18-touch-me.png), ![19](19-touch-drag-reorder.png) |
| 13 | Quality gates | ✅ 452 tests / lint / typecheck / prettier | CI |

## Findings

| # | Finding | Status |
| - | ------- | ------ |
| F1 | **Resent confirmation links dropped the deep link**: `resend()` passed no `emailRedirectTo`, so GoTrue fell back to the Site URL and the resent link landed logged-in on the public board root with no banner/nudge (pre-#142 behavior). Captured: ![13](13-BUG-resent-landing-site-root.png), ![14](14-BUG-resent-user-dropped-on-board.png). Original link: `redirect_to=/login?confirmed=1`; resent link: `redirect_to=/` | **Fixed + re-tested in prod (#156)** |
| F2 | **Silent resend failure**: Supabase enforces a short per-address resend cooldown; the login page swallowed the 429, leaving the button looking dead | **Fixed + re-tested in prod (#156)** |
| F3 | **`testride:seed` was broken** by #145's `profiles_username_format_check` (`mock-0001` hyphen rejected). Every seed run failed with a constraint violation | **Fixed** (`fix/testride-username-constraint`) |
| F4 | The header "Sign up" pill (and the `/riders/<user>` CTA) link to `/signup` without `state.from`, so deep links only survive via the RequireAuth-bounce path. Minor; candidate follow-up | Open |
| F5 | Cloudflare Web Analytics beacon blocked by CSP (`script-src 'self'`); analytics likely dark. Unrelated to this feature | Open |

## Residue / cleanup verification

- `testride:cleanup --synthetic --yes` → 5 users deleted (22 rides cascaded)
- `testride:cleanup --emails <4 test gmails> --yes` → 4 users deleted (3 rides cascaded)
- `testride:recompute` → 99 coasters re-rated, converged (16.5 s, 12 iterations)
- `testride:report` → **synthetic: 0**; `auth.users` back to the 3 pre-test real accounts; zero rows matching `coaster.rank.app+%` or `@test.coasterrank.dev`
- Console: zero page errors across all flows (one benign CSP beacon notice, F5)

## Post-fix re-test (after #156 merged + deployed)

| # | Behavior | Result | Evidence |
| - | -------- | ------ | -------- |
| 14 | Resend returns 200 with visible "Confirmation email sent." feedback (no silent failure) | ✅ | ![20](20-resend-accepted-postfix.png) |
| 15 | **Resent link carries the deep link**: `redirect_to=/login?confirmed=1&next=%2Fsubmit` (was `redirect_to=/` before #156) | ✅ | link URL captured |
| 16 | Resent-link landing: green banner → auto-forward → `/submit`, signed in | ✅ | ![21](21-resent-banner-postfix.png), ![22](22-resent-landed-submit-postfix.png) |

The F1/F2 fixes are verified in prod. Test user cleaned up afterwards.

## Notes for future runs

- Cloudflare Email Routing (the `test@coasterrank.app` test mailbox) does **not**
  support plus addressing — `test+foo@coasterrank.app` bounces 550. Gmail
  plus-addressing was used instead and worked first try.
- Email verification links are single-use; a crashed test run consumed one
  token (flowA) — the same leg was re-proven via flowB/flowD.
- Resend probe emails need ~2 min spacing (per-address resend cooldown).
