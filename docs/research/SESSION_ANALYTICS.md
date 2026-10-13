# Session Analytics

Anonymous, privacy-respecting session analytics for CoasterRank.
Status: **v1 spec — implemented in this PR** (docs → `docs/research/` was
stub-only before). Key modules: `app/src/lib/analytics-schema.ts`,
`app/src/lib/analytics.ts`, `app/src/sessions-endpoint.ts`.

## 0. Goal

Answer the early-stage question — *do visitors who hit the page actually
interact with it?* — which was unmeasurable pre-auth (GUEST_UX §5.1):

- Do they scroll the rankings?
- Do they start creating their own ranking (Mark Mode)?
- Do they add rides (mark, bulk-add, import), including returning later to
  add more?
- Do they reorder (change their ranking) on `/rank`?
- How long from page load → first interaction → first mark?
- What % of visits search or filter?

Scope is **anonymous interaction analytics for public sessions** — guest
funnel, shared rider-page landings, and logged-in browsing alike —
as long as payloads stay ID-less and coarse. Account mutations
(signups, applied imports for authed users) stay in the DB we already
have (`guest_promotions`, `import_events`) rather than duplicated here.

## 1. Hard constraints

1. **Anonymous only.** No email, user_id, IP, raw user-agent, or
   cross-session identifier in any analytics payload or table. No
   coaster/park IDs in v1 (counts and buckets only). **No session
   identifier exists at all** — not even a local-only UUID: the tab makes
   one random sampling draw at init and stores nothing in web storage.
2. **Inline with `/privacy`.** First-party beacons only (our code → our
   Worker → Analytics Engine), no new SDK/cookie/beacon, no persistent
   ID, no fingerprinting (coarse `mobile|desktop` only). DNT/GPC are a
   **hard gate on both ends**: the client creates nothing (no capture at
   all), and the Worker re-checks `Sec-GPC: 1` / `DNT: 1` on every POST.
   The privacy-page copy shipped with this change (PrivacyPage §4).
3. **No anon Supabase writes.** Browsers never touch Supabase for
   analytics; ingest terminates at our Worker.
4. **Postgres disk stays flat.** v1 stores nothing in Postgres. Raw
   volume lives and dies in Analytics Engine (3-month retention);
   rollups are deferred (§6).

## 2. Shape

- **Capture always, export gated.** `track(name, props?)` inside existing
  handlers writes to an in-memory buffer (sync, ~free). Export happens
  only when the runtime config enables collection *and* the session-level
  sample chose this tab.
- **Session-level sampling.** One `Math.random()` draw at init; a sampled
  session sends everything. Initial values: enabled + 100% (traffic is
  the bound, not the percentage). Kill switch = dashboard vars, effective
  within the 5-minute config TTL.
- **Two datasets.** Discrete events (`coasterrank_session_events`) +
  one summary row per tab (`coasterrank_session_summary`). The summary is
  the client pre-joining its own timeline, so per-session ordering needs
  no identifier: 1 row answers timings/ratios; the events dataset answers
  rate-over-time.

## 3. V1 event catalog — `session_events`

Fired at most once per meaningful action. Props are coarse buckets only.
Transport batches up to 50 events per POST; the Worker validates every
field against `lib/analytics-schema.ts`.

Events marked **⚡ first-per-session** are deduped centrally in
`track()` (`FIRST_PER_SESSION` set) — one buffered datapoint no matter
how often the callsite fires (every search keystroke, filter toggle,
scroll tick). Call sites do NOT debounce; funnel denominators come from
these four, while everything else is an interaction count.

| Event            | Fires when                              | Prop bucket            |
|------------------|-----------------------------------------|------------------------|
| `mark_mode_entered` | Mark Mode activated (all entry paths) | — |
| `coaster_marked` | Row toggled on (board, search, detail)  | — |
| `coaster_unmarked` | Row toggled off                       | — |
| `park_bulk_add_committed` | Park picker commit added rides | `1-3 \| 4-10 \| 11+` |
| `search_used` ⚡ | First search input per session          | — |
| `filter_used` ⚡ | First non-search filter change per session | — |
| `board_scrolled` ⚡ | First scroll per session                | — |
| `board_scrolled_deep` ⚡ | First ≥75% page scroll per session | — |
| `rank_entered`   | `/rank` visited with ≥1 ride            | — |
| `rank_reordered` | Drag commit on `/rank`                  | — |
| `rank_item_removed` | Item deleted on `/rank`              | — |
| `guest_import_applied` | Guest import committed            | `1-10 \| 11-50 \| 51+` |
| `save_started`   | Save Ranking & Join Board tapped        | `1-4 \| 5-14 \| 15+` |

Deliberately absent: signup/merge completion (post-auth, already in
`guest_promotions`), full URLs, coaster/park IDs, scroll streams.

## 4. Session summary — `session_summary` (1 row/tab)

Beaconed once on `pagehide` (batched events also flush there and every
15s). Blobs (fixed positions): `entry_surface`
(`board | rank | rider_share | coaster | park | other`),
`viewport` (`mobile | desktop`), `max_scroll`
(`none | shallow | mid | deep` — `none` = no scroll, not missing data),
`reached` (`none | mark | rank | save`, highest funnel step),
`auth_state` (`guest | authed` — coarse segment only; summaries are never
joined to `auth.users`).

Doubles: `ms_to_first_interaction` (load → first pointer/key, `−1` never),
`ms_to_first_mark` (load → first ride addition; marks, bulk-add, and
import all count), `duration_ms`, `mark_count`, `reorder_count`,
`did_search`, `did_filter`.

Every §0 question maps to one SQL query over this row set; the AE
timestamp column carries the when (page-load-centric charting preserved).

## 5. Ingest + config: `POST /api/sessions`, `GET /api/sessions`

Naming per review; both live on the existing Worker (`/api/*` already
routes through it) — `app/src/sessions-endpoint.ts`.

- **GET** — `{ enabled, sampleRate }` from dashboard vars
  (`ANALYTICS_ENABLED` / `ANALYTICS_SAMPLE_RATE`, set true/100 at
  launch), served `Cache-Control: max-age=300`. Defaults by intent:
  absent/blank rate var → 100 (the enabled gate covers the unset-everything
  case); present-but-garbled/out-of-range → 0 (operator error bleeds
  nothing). Set these on the **production environment only** — preview
  deploys inherit nothing and fail closed. A KV- or admin-UI-backed
  config is the documented v2 upgrade path; dashboard-var mutation makes
  the kill switch a no-redeploy operation.
- **POST** — JSON `{ events?, summary? }`: allowlist + bucket validation
  (400 on anything unknown/oversized), ≤50 events per batch, 256KB body
  cap, 202 `dropped` when AE bindings are absent (dev/CI) so the client
  never error-loops, 413/415 for malformed transport.
- **Rate limit** — per-client fixed window (30 POST/min), keyed on a
  salted truncated SHA-256 of `CF-Connecting-IP`, in-isolate memory only.
  We limit but never store; isolate-local accuracy is accepted for v1
  (abuse posture per SECURITY.md's bounded-controls stance).
- **AE bindings** — `SESSIONS_AE_EVENTS` / `SESSIONS_AE_SUMMARY` in
  `wrangler.toml`; each event expands to `blobs: [name, bucket]`,
  `doubles: [1]`; summary expands to its 5 blobs + 7 doubles. Locally
  `writeDataPoint` is unavailable (cloudflare/workers-sdk#4258) and the
  path degrades silently.

## 6. Deferred to v2 (revisit triggers)

1. **Postgres rollups.** AE can answer the launch questions directly
   (SQL API / GraphQL / dashboard; the admin-sharing-metrics function is
   precedent). After 1–2 weeks of real data we decide which metrics need
   >3-month history; the spec'd shape (two tiny per-day aggregate tables,
   ETL via Cloudflare Cron Trigger, service-role push) is in git history
   (this PR's draft) — not implemented now.
2. **Indexed event stream** (AE's per-tab sampling-key field) for
   within-session drop-off reconstruction — a separate privacy decision;
   v1's strictly unlinked rows were kept instead.
3. Park/coaster ID payloads (which parks drive bulk-add?) — needs a
   re-identification review (small parks).
4. Admin dashboard surface for the AE-driven numbers.

## 7. Data-hygiene guarantees (implemented)

1. Nothing is created before every gate passes: production-ish origin
   (not localhost/.local/.test unless `?analytics=debug`), non-headless
   UA, not DNT/GPC-opted-out, collection enabled, sampling draw passed.
2. Debug mode (`?analytics=debug`) logs to console and cannot reach the
   network (no config fetch, no beacon).
3. Prop hygiene: no URLs, free text, IP, or UA anywhere in the wire
   schema; every new blob/double position is a reviewed schema change
   (the allowlist in `analytics-schema.ts` is both client and server).
4. Session-duration counting: the summary is beaconed once on a real
   `pagehide`; a bfcache hide (`pagehide` with `persisted=true`) snaps
   nothing, so a tab that revives from cache and continues staying one
   live session. A row per tab remains the unit — two tabs open are two
   sessions, by design (no cross-tab identity exists to dedupe).
5. `track()` no-ops uninitialized (component tests stay quiet), and the
   capture rollups work fully offline — export is the only networked part.
6. Preview-environment containment is by **config, not code**: no
   hostname appears anywhere in the source; `ANALYTICS_ENABLED` /
   `ANALYTICS_SAMPLE_RATE` are set on the production environment only, so
   preview deploys fail closed (and `?analytics=debug` provides a
   zero-network path anywhere the reviewer needs one) — see RUNBOOKS.

## 8. Verification notes

- `src/lib/analytics.test.ts` — gating (localhost / DNT / GPC / headless
  / disabled / unreachable / rate 0 all produce zero network and zero
  storage), rollups, summary composition, Blob transport, debug mode.
- `src/sessions-endpoint.test.ts` — config echo/fail-closed/clamping,
  validation (unknown names, invalid buckets, oversize batch, JSON
  errors), GPC drop, rate limit, missing-binding degradation, blob/double
  expansion shapes.
- Worker CSP needed no change (same-origin `connect-src 'self'`).
- Production observability after merge: AE SQL on either dataset mirrors
  the runbooks' RUM-GraphQL pattern; `stored` counts in POST responses
  (202) and any `[sessions] writeDataPoint failed:` log lines are the
  ingest health signals.
