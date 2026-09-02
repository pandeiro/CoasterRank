---
name: mobile-drag-qa
description: Browser QA for CoasterRank touch and drag flows with Playwright + CDP — use when testing the My Coasters ranking screen, long-press drag, undo-delete, toasts, mobile viewport layout, or any flow gated on (pointer: coarse). Covers matchMedia pinning, long-press dispatch, synthetic-user protocol, and known false alarms.
---

# Mobile drag & touch QA (CoasterRank)

Playwright-driven QA of the app's mobile/touch behavior. The `/me` screen is
the main subject: dnd-kit sortable list with long-press activation on touch,
undo-window deletes, optimistic adds.

## Synthetic users: a possibility, not a presence

1. Check first — `cd scripts && npm run testride:report` is read-only and
   shows whether synthetic users exist (emails on `@test.coasterrank.dev`,
   shared password `testride-password`, e.g. `mock-0001`).
2. If none exist, **ask the user** before creating any (`testride:seed --apply`
   is a production DB write).
3. Mutate only synthetic users, and prefer flows that don't write:
   - The undo-delete path makes **zero server calls** if you tap Undo.
   - Desktop position-pick selection only sets client state until you click an
     insert divider.
   - Drag reorder DOES write ranks; restore afterwards (see below).
4. See `docs/TEST_DATA.md` for the full lifecycle and
   `scripts/src/oneoff/restore-mock0001-order.mts` for restoring mock-0001's
   canonical rank order (it uses the app's own API path — do NOT restore data
   by scripted gestures; dnd-kit auto-scroll makes multi-slot drags land
   unpredictably).

## Harness facts

- Binaries are mise-managed: prefix commands with
  `export PATH="$HOME/.local/share/mise/shims:$PATH"` (also needed for the
  bundled `with_server.py`, which runs npm in a subshell).
- Dev server: from `app/`, `npm run dev -- --port 5199 --strictPort`, then
  run Playwright directly (Python playwright is installed on this machine).
- Auth is per browser **context** — cookies/localStorage do not carry over.
  Log in inside each context. After clicking "Log in", wait for the URL to
  change (`page.wait_for_url`), not for `networkidle` — the auth redirect
  races networkidle.
- Always attach `page.on('pageerror')` and console-error capture; several
  real bugs here surfaced only as console errors.
- Standard viewport sweeps: 375 / 768 / 1280, assert
  `document.documentElement.scrollWidth === clientWidth` (catches the
  negative-margin bleed class of bug), screenshot top + stuck + full states.

## Pin `(pointer: coarse)` — Playwright media emulation is flaky

The same context options have reported `pointer: fine` in one context and
`coarse` in another. Anything the app gates on pointer type (whole-row
long-press drag, keyboard blur-on-select) must be pinned via an init script:

```js
ctx.add_init_script("""
  const orig = window.matchMedia.bind(window)
  window.matchMedia = (q) => {
    const res = orig(q)
    let override = null
    if (q.includes('pointer: coarse')) override = true
    else if (q.includes('pointer: fine')) override = false
    if (override === null) return res
    return {
      matches: override, media: res.media, onchange: null,
      addEventListener: (...a) => res.addEventListener(...a),
      removeEventListener: (...a) => res.removeEventListener(...a),
      addListener: (cb) => res.addListener && res.addListener(cb),
      removeListener: (cb) => res.removeListener && res.removeListener(cb),
      dispatchEvent: (ev) => res.dispatchEvent(ev),
    }
  }
""")
```

**Do not** use `Object.create(mql)` to override `matches` — native methods
lose their receiver and throw `TypeError: Illegal invocation` inside React
effects.

## Long-press gestures via CDP

Playwright's `touchscreen` only taps. Drive dnd-kit's TouchSensor (200ms
delay, 8px tolerance) with CDP:

```python
cdp = ctx.new_cdp_session(page)
cdp.send('Input.dispatchTouchEvent',
         {'type': 'touchStart', 'touchPoints': [{'x': cx, 'y': cy}]})
page.wait_for_timeout(350)          # past the 200ms activation delay
for i in range(1, 13):              # small stepped moves, ~40ms apart
    cdp.send('Input.dispatchTouchEvent',
             {'type': 'touchMove', 'touchPoints': [{'x': cx, 'y': cy - d * i / 12}]})
    page.wait_for_timeout(40)
cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
```

Verify the scroll guard held: `window.scrollY` must be identical before and
after the moves (the row's `touchmove` guard prevents native panning only
after activation; real swipes past the 8px tolerance must still scroll).

## Known false alarms (don't debug these)

- **Dragging row 1 upward changes nothing** — `over` correctly stays the
  dragged row; there are no droppables above it. Same for the last row
  downward. Pick a middle row.
- **`pointermove` events continue after a drag starts even though touchmove
  is preventDefault-ed** — that's the design (the guard blocks native panning,
  not pointer delivery).
- **Stale module after editing code**: the long-lived dev server + HMR can
  serve a mix of old/new modules to a running page. Hard-reload (fresh
  context) between probes after source edits; don't trust contradictory
  results from one long-lived page.
- Instrument app lifecycle via temporary `console.log` in the DndContext
  handlers (`onDragStart`/`onDragMove`/`onDragEnd` log `over?.id`), captured
  with `page.on('console')`, rather than guessing from DOM state.
