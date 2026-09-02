# e2e scenarios (on-demand browser QA)

Thin Playwright gesture-and-assert scripts for interactive QA of app
surfaces. **Not a regression suite** — no CI, no test runner. Scenarios are
run deliberately (by a human or agent) when touching the relevant UI, the
same way `src/oneoff/` scripts are.

```bash
# dev server first (terminal 1)
cd app && npm run dev -- --port 5199 --strictPort

# then, from scripts/:
npm run e2e:desktop-drag
npm run e2e:touch
# or a custom one:
npx tsx src/e2e/scenarios/<name>.ts
```

All scenarios run against the **synthetic QA user** and target the dev server
(`E2E_BASE_URL` overrides `http://localhost:5199`), which talks to production
Supabase — so the rules in `.agents/skills/mobile-drag-qa` apply:

1. Synthetic users are a possibility, not a presence: `requireSyntheticUser()`
   checks read-only and throws with instructions if none exists — **ask the
   user** before seeding (`testride:seed --apply` is a production DB write).
2. Scenarios that reorder must restore the original order before exiting.
3. Prefer no-write flows where possible (e.g. the undo-delete path makes zero
   server calls; search selection only enters pending-add until confirmed).

## Writing a scenario

Import from `../helpers` — it owns the boilerplate so scenarios stay pure
gesture-and-assert: `ensureServer`, `requireSyntheticUser`, `login`,
`launchTouchContext` (pins `(pointer: coarse)`; Playwright's emulation is
flaky), `longPressDrag` (CDP touch events; returns scroll positions for
scroll-guard assertions), `mouseDragRow`, `rankedNames`, `rowPitch`,
`assertNoHorizontalOverflow`, `captureDiagnostics`.

Scenario contract:

- `main()` + `process.exit(1)` on failure, `pass:` lines per assertion.
- Always attach `captureDiagnostics` and fail on collected page errors.
- Log what mutated and restore it. Assume the run may be interrupted.

Behavior knowledge (why the assertions look the way they do — edge-row
`over = self`, pointer-emulation flakiness, HMR staleness) lives in the repo
skill `.agents/skills/mobile-drag-qa/SKILL.md`. Extend that skill when you
learn something new; add a helper here when you re-type something twice.
