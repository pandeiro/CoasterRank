---
name: jsdom-testing
description: Vitest/jsdom conventions for CoasterRank app tests — use when writing or fixing unit tests that hit missing browser APIs (IntersectionObserver, matchMedia, Element.animate), Tailwind-class assertions, fake timers with react state, react-query or Supabase mocking, or flaky-looking component tests.
---

# jsdom & vitest conventions (CoasterRank)

The app test suite is vitest + jsdom + @testing-library. jsdom lacks several
browser APIs the app uses; the house patterns below keep tests deterministic
and the workarounds documented at the point of use.

## Missing browser APIs — the three recurring ones

- **`matchMedia` does not exist in jsdom.** Prod code must guard
  (`typeof window.matchMedia === 'function'`) and the fallback default is a
  deliberate choice per call site — `useMediaQuery` defaults to `true`
  (render desktop layout in tests), while `isCoarsePointer` defaults to
  `false` (keep the desktop interaction flow). Know which one your feature
  uses before asserting on behavior.
- **`IntersectionObserver` does not exist.** Prod code (ScrollSentinel,
  MyCoastersPage stuck-state) constructs it unconditionally; test files stub
  it with `vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} })`
  near the imports.
- **`Element.animate` (WAAPI) does not exist.** Any prod code using it must
  guard with `typeof el.animate === 'function'` so jsdom tests exercise the
  timing (setTimeout-driven) logic without the animation.

## No Tailwind in jsdom

Layout/hit-area regressions can't be measured by size in jsdom. Pin the
classes instead (`expect(handle).toHaveClass('p-3.5', '-m-3', 'sm:p-2')`) with
a comment explaining the intent — see the drag-handle test in
`RankedCoasterItem.test.tsx`.

## Fake timers + React state

With `vi.useFakeTimers()`, use `fireEvent.click(...)` (sync) and
`act(() => vi.advanceTimersByTime(ms))` — `userEvent`'s async pacing fights
fake timers. Always `try/finally { vi.useRealTimers() }`.

## Mocking shapes

- **Hooks over modules**: mock at the hook boundary, keeping the real module's
  other exports: `vi.mock('../lib/coasters', async (importOriginal) => ({ ...actual, useParks: vi.fn() }))`.
- **Mutations**: a `mockMutations()` helper returning `mutate` fakes that
  invoke the passed `onSuccess`/`onError` synchronously — beware this makes
  `itemsRef.current`-style render-mirrors stale within the same tick; prefer
  functional `setState` updates in prod code so both orders work.
- Components calling `useQuery` directly need a `QueryClientProvider` wrapper,
  or mock the hook instead.

## Learnings bank (from past bugs — keep appending)

- PostgREST many-to-one embeds return an **object**, older code assumed an
  array and crashed on field reads (accept both shapes — see `useMyRides`).
- Selecting **view-only columns** (`score`, `comparisons`) on a **table**
  query → Postgres 42703; the types mirror what the table embed returns.
- The "Showing 8 of N" cap footer counts only reachable (non-excluded)
  matches; excluded coasters are filtered before slicing.
- The synthetic `Other (unknown location)` park name must never render
  verbatim — `parkLabel` substitutes a neutral label; matching BY that name
  is fine (search), rendering it is not.
- Prettier + oxlint run in CI (`npm run gates` from the repo root); format
  generated test code before committing.

When you hit a new jsdom/PostgREST/React-testing edge case, fix it, then add
one line here and a comment at the fix site.
