# Session Analytics

Anonymous, privacy-respecting session analytics for the guest funnel.
Status: **Draft v1 spec for review**. Nothing here is implemented.

## 0. Goal

Answer the early-stage question — *do visitors who hit the page actually
interact with it?* — which we currently cannot answer (GUEST_UX §5.1):

- Do they scroll the rankings?
- Do they start creating their own ranking (Mark Mode)?
- Do they add rides (mark, bulk-add, import), including returning later to
  add more?
- Do they reorder (change their ranking) on `/rank`?
- How long from page load → first interaction → first mark?
- What % of visits search or filter?

Without breaking the privacy promise or the Postgres disk budget.

## 1. Hard constraints

1. **Anonymous only.** No email, user_id, IP, raw user-agent, or
   cross-session identifier in any analytics payload or table. No
   coaster/park IDs in v1 (counts and buckets only).
2. **Inline with `/privacy` as written.** Current policy (§4): essential
   cookies only, no third-party trackers / ad cookies / cross-site
   tracking, Cloudflare Web Analytics only (cookieless, aggregate).
   Therefore: first-party beacons only (our code → our Worker → AE), no
   new SDK/cookie/beacon, no persistent ID, no fingerprinting (coarse
   `mobile|desktop` only), respect DNT/GPC as opt-out. A small honest
   privacy-page tweak ships *before* enabling export (§8).
3. **No anon Supabase writes.** GUEST_UX's "no anonymous DB writes"
   invariant survives: browsers never touch Supabase for analytics. All
   anon traffic terminates at our Cloudflare Worker → Analytics Engine.
4. **Postgres disk stays ~flat.** Raw volume lives and dies in AE (3-month
   retention). Postgres holds only tiny daily rollups (§7).

## 2. Shape (recap of the agreed design)

- **Capture always, export gated.** A tiny `track(name)` call inside
  existing handlers writes to an in-memory buffer (sync, <1ms, zero
  network). Export happens only when a runtime flag is on *and* the
  session is sampled *and* the visitor hasn't opted out.
- **Session-level sampling.** Decided once per tab
  (`hash(sessionId) % 100 < rate`); a sampled session sends everything,
  otherwise funnels break. Start at 100% while traffic is small; the bound
  is absolute rows/day, not a percentage.
- **Two datasets, not one.** Discrete events (time-series counts) +
  one session summary per tab (timings, ratios). The summary answers every
  question in §0 with a single row and no session ID (§5).

## 3. V1 event catalog

### 3.1 Discrete events → AE dataset `session_events`

Fired at most once per meaningful action (dedupe repeats locally, e.g.
first scroll-depth crossing per session). Props are coarse buckets only.

| Event | Fires when | Props (buckets, never IDs/text) |
|---|---|---|
| `mark_mode_entered` | Mark Mode activated | `entry: board \| rank-add-more` |
| `coaster_marked` | Row toggled on (board, search, detail pill) | none (count = 1) |
| `coaster_unmarked` | Row toggled off | none |
| `park_bulk_add_committed` | Park picker committed | `added_bucket: 1-3 \| 4-10 \| 11+` |
| `search_used` | First search keystroke per session | none |
| `filter_used` | First filter change per session | none |
| `board_scrolled_deep` | First scroll past ~75% of board per session | `viewport: mobile \| desktop` |
| `rank_entered` | `/rank` workbench visited with ≥1 ride | none |
| `rank_reordered` | Drag commit on `/rank` | none |
| `rank_item_removed` | Item deleted on `/rank` | none |
| `guest_import_applied` | Guest import committed | `rows_bucket: 1-10 \| 11-50 \| 51+` |
| `save_started` | Save Ranking & Join Board tapped | `rides_bucket: 1-4 \| 5-14 \| 15+` |

Deliberately absent: `signup_completed` (post-auth; already covered by
`guest_promotions`), full URLs, coaster/park IDs, scroll streams.

### 3.2 Session summary → AE dataset `session_summary` (1 row/tab)

Beaconed once on `pagehide`/`visibilitychange:hidden` via `sendBeacon`.
No session ID — the row *is* the session.

Blobs (fixed positions): `blob1 entry_path (/ | /rank | other)`,
`blob2 viewport (mobile | desktop)`, `blob3 max_scroll (shallow | mid |
deep)`, `blob4 reached (none | mark | rank | save)` (highest funnel step).

Doubles: `double1 time_to_first_interaction_ms`,
`double2 time_to_first_mark_ms` (−1 if never),
`double3 session_duration_ms`, `double4 mark_count`,
`double5 reorder_count`, `double6 did_search (0/1)`,
`double7 did_filter (0/1)`.

Every §0 question maps to one query: scroll rate → `max_scroll` dist;
start rate → `reached ≥ mark`; add/reorder behavior → `mark_count`,
`reorder_count` averages; timings → avg/p50 of `double1/2`;
search/filter % → mean of `double6/7`.

## 4. Client shape (`lib/analytics.ts`, new)

```
handlers (mark, dock, drag, import, save, search, filter)
  → track(name, props?)     // allowlisted, sync, ring buffer
  → session state           // firsts, counts, timers, max scroll depth
  → sampler (once per tab)  // hash(sessionStorage UUID) < rate?
  → if (enabled && sampled && !DNT/GPC): sendBeacon batch
      every 15s (events) + once on hide (events + summary)
```

- Session ID: `crypto.randomUUID()` in `sessionStorage`, per tab, never
  persisted, never sent in v1 (reserved for a future indexed stream).
- Export gated to production origin; `?analytics=debug` logs to console
  instead of beaconing; bots/headless excluded client-side.
- Config (runtime, no redeploy): public `app_settings` rows
  `analytics_enabled` (bool, default false) + `analytics_sample_rate`
  (int 0–100, default 100), read on boot, cached ~5 min. Kill switch =
  set either to off/0; must take effect within minutes.

## 5. Why no session ID in v1

AE stamps every datapoint server-side, so time-series are preserved
without any client ID. Per-session ordering (was this mark and that save
the same visit?) is reconstructed from the summary row instead of a join:
the tab already knows its own timeline, so it pre-joins locally and sends
the answer. Result: strictly anonymous (single unlinked rows), 1 row per
session for the interesting half of the data. If we later need "where
exactly do sessions die," add an indexed event stream (AE's `indexes`
field takes a per-tab random key) as a *second* dataset — a conscious,
separate privacy decision, not scope creep on this one.

## 6. Ingest: Worker-first (no anon Supabase surface)

`POST /api/analytics` on the existing Worker (`app/src/worker.ts`;
`/api/*` already routes through it) + AE binding in `wrangler.toml`:

- Validate: event name in allowlist, blobs ≤ 16 KB total (AE limit),
  batch ≤ 50 events, 250 datapoints/invocation max.
- Rate-limit per IP with a sliding window — limit, don't store (never log
  IP alongside events).
- `writeDataPoint()` needs no await (runtime drains in background).
- Dev dataset binding separate from prod; prod export gated to prod origin.

## 7. ETL + Postgres footprint

AE retention is 3 months — Postgres keeps the long-term picture as two
tiny rollup tables, backfilled by a **Cloudflare Cron Trigger** on the
same Worker (daily): run the AE SQL (counts + avg/p50 per event/day;
session-ratio aggregates), push rows to Supabase via service-role REST.
Anon ingest and privileged ETL never share a path or a credential. (A
Supabase pg_cron → pg_net pull is possible but puts CF secrets in
Postgres; avoid unless CF cron is unavailable.)

```sql
-- dozens of rows/day, kept ~2y. No session rows, ever.
create table public.analytics_event_counts_day (
  day date not null, event text not null, sessions integer not null,
  count integer not null, primary key (day, event));
create table public.analytics_session_summary_day (
  day date primary key, sessions integer not null,
  pct_scrolled_deep numeric, pct_reached_mark numeric,
  pct_reached_rank numeric, pct_reached_save numeric,
  pct_search numeric, pct_filter numeric,
  avg_ms_to_first_interaction integer, p50_ms_to_first_mark integer,
  avg_marks numeric, avg_reorders numeric);
```

Disk: <100 rows/day ≈ nothing. Raw volume lives and dies in AE.

## 8. Privacy-page diff (ships before enabling export)

Append to §4 (Cookies & Tracking), or equivalent:

> To improve the ranking flow we count aggregate, anonymous interactions
> (for example, how many visits scroll the board or start a ranking, and
> how long that typically takes). These counts use no cookies, no
> identifiers, and no cross-session tracking, are sent to our own servers
> only, and are never joined to accounts. Browser Do-Not-Track and Global
> Privacy Control signals opt you out.

## 9. Open questions (v2+, explicitly deferred)

1. Park/coaster IDs in payloads (which parks drive bulk-add?) — counts
   first; IDs need a separate privacy review (re-identification via small
   parks).
2. Indexed event stream for drop-off path analysis (§5).
3. Sample-rate budget in rows/day once traffic is known.
4. Admin dashboard surface for the rollups (reuse Sharing-tab pattern).

## 10. Build order

1. Privacy-page copy (§8) + `app_settings` keys.
2. `lib/analytics.ts` + handler hooks (capture only, export off).
3. Worker `POST /api/analytics` + AE datasets (dev first).
4. Session summary + sampling + kill-switch verification.
5. Cron ETL + rollup migration + admin read surface.
6. Enable at 100%, review for a week, then decide the long-term rate.
