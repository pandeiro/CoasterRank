# Guest Onboarding: "Mark & Rank"

**Status:** Ready for Implementation (v2.1 Spec — supersedes v2)  
**Date:** 2026-09-11  
**Target Release:** v1 (Core Mark & Rank) + v1.1 (Coaster Detail Touchpoint)  
**Related Docs:** `docs/PLAN.md` (§2 "Anonymous 'ridden' flags → signup materialization", §11), `docs/SCHEMA.md`, `AGENTS.md`

### Changelog (v2 → v2.1)

Result of the pre-implementation technical review against the live schema and code:

1. **Materialization is now client-side.** v2's `on_auth_user_confirmed` trigger does not exist in Supabase, and the existing RPCs derive the user from `auth.uid()` — unusable from an `auth.users` trigger running as `supabase_auth_admin` (no user JWT). v2.1 materializes on the first `SIGNED_IN` event after email confirmation; `/login?confirmed=1` already lands there with a PKCE session. Works cross-device and in dev (confirmation off → immediate session).
2. **Dedicated `materialize_guest_rides` RPC instead of reusing `apply_imported_rides`.** Reuse was blocked three ways: the RPC's `p_source` guard only accepts `csv | xls | xlsx | paste | sheets` (v2's `'guest-promotion'` would be rejected), append mode requires the payload to cover every currently ranked row (v2's merge modal sent only the new IDs), and guest promotion is not a spreadsheet import — it must not stamp `profiles.import_source` or fire the Telegram import notification.
3. **Guest list cap lowered 250 → 100** (~4KB). `raw_user_meta_data` has undocumented size limits with auth-breaking failure modes (supabase/auth#1776). Overflow UX is now defined.
4. **Telemetry redesign.** Pre-auth events are unmeasurable (no anon-writable tables), and v2's +35% conversion metric had no denominator. Replaced with server-authoritative metrics via a new `guest_promotions` table written by the materialization/merge RPCs (§5.1).
5. Smaller: logged-in zero-ride `/rank` behavior defined; `/rank` empty state; merge-modal silent no-op edge; copy hierarchy consolidated; a11y row-focus notes.

---

## Part I: Product Requirements Document (PRD)

### 1. Problem Statement

Today, CoasterRank forces prospective users through a high-friction sequence before delivering value:
1. **Sign-up-before-value**: Visitors must register with email/password and verify their email via an inbox confirmation link before they can build any personal ranking.
2. **Blank-canvas paralysis**: Upon reaching `/me`, users face an empty list and a bare search box, forcing them to recall and type coaster names from memory.

Email verification is a load-bearing anti-abuse invariant protecting the public Bradley–Terry rating engine from ballot-stuffing. It cannot be eliminated. However, asking for it **up front** repels high-intent visitors.

**"Mark & Rank"** moves account creation to the end of the funnel: visitors check off coasters they've ridden directly from the public board, immediately drag-sort them into a customized personal top list, and only then save their work to a verified account.

---

### 2. Goals & Non-Goals

#### Goals
- **Zero-Friction Discovery**: Enable visitors to mark coasters they've ridden directly from the public board (`/`) with zero authentication.
- **Instant Drag-and-Drop Value**: Transition marked coasters into an interactive, reorderable ranking workbench (`/rank`) powered by the existing `@dnd-kit` sorting engine.
- **Smart Initial Heuristic**: Automatically seed marked coasters into **Board Rank Order** (descending Bradley–Terry score) so the list begins in a sensible order.
- **Cross-Device Auth Durability**: Preserve guest rankings across the email verification loop, even when the user confirms their email in a different mobile app or browser tab.
- **Ironclad Clobber Protection**: Guarantee that logging in or signing up from a guest session can **never** accidentally overwrite or destroy an existing user's saved ranking.
- **Logged-In Fast-Add**: Allow authenticated users to leverage the same marking UI to append newly ridden coasters to their existing `/me` list with one click.
- **Preserve Browse Density**: Ensure visitors who just want to explore the public board experience zero UI clutter, zero layout shift, and zero performance regression.

#### Non-Goals
- **No Anonymous Database Writes**: Unverified guests write exclusively to client-side storage (`localStorage`). No anonymous writes ever hit Supabase or Bradley–Terry rating calculations.
- **No Shadow / Deferred Accounts**: Guest lists remain local until the user explicitly commits to email signup.
- **No Redesign of `@dnd-kit`**: We reuse the proven drag-and-drop sortable components from `MyCoastersPage.tsx`.
- **No Cross-Device Local Sync**: Guest sessions are bound to their current browser until promoted to a confirmed account.
- **No Pre-Auth Server Telemetry**: Guest events are never written server-side; funnel capture happens post-auth via `guest_promotions` (§5.1 spells out the measurement consequences).
- **No `auth.users` Trigger in v1**: Materialization is client-side on the confirmed login path (§3.4); a server-side trigger is deferred hardening, not launch scope.
- **Guest Cap: 100 Coasters**: Guests can mark at most 100 coasters (metadata-size safety, §2.2); power users rank beyond that after signup.

---

### 3. User Journeys & Experience Design

```mermaid
flowchart TD
    A[Visitor on Public Board '/'] -->|Clicks 'Rank My Rides'| B[Mark Mode Overlay Activated]
    B -->|Taps Coaster Rows| C[Rows Highlighted + Dock Counter Updates]
    B -->|Filters by Park / Manufacturer| C
    C -->|Clicks 'Rank My Rides (X)' in Dock| D[Navigate to '/rank']
    D -->|Drag-Sort Reordering| E[Customized Local Ranking]
    E -->|Clicks 'Save Ranking & Join Board'| F['/signup' Flow + Guest Payload]
    F -->|Confirms Email on ANY Device| K[First Login Detects pending_guest_rides]
    K -->|materialize_guest_rides RPC| L[Materialized on '/me' + Metadata Wiped]
    
    A -->|Authed User Enters Mark Mode| H[Mark Mode: Add Mode]
    H -->|Selects New Rides| I[Clicks 'Add X to My Coasters']
    I -->|Atomic Append RPC| J[Appended to '/me' + 10s Undo Toast]
```

#### 3.1 Mode 1: The Browse Experience (Default)
- The global board (`/`) loads in its clean, read-optimized table layout.
- The desktop header CTA changes from a generic `Sign up` to **`Rank My Rides`**.
- The existing engagement-timed nudge (`SignupCta`) continues firing for passive browsers (after 16s engaged dwell + scroll, `SIGNUP_CTA_ENGAGED_SECONDS`), but its primary button now reads **`Rank My Rides`** — the same CTA as the header — triggering Mark Mode directly on the board rather than sending the user to a blank form.

#### 3.2 Mode 2: "Mark Ridden" Mode (Board Focus / Selection Overlay)
Activated when the visitor clicks **`Rank My Rides`** in the header or board hero:
1. **Contextual Top Guidance**:
   - A slim, non-disruptive banner appears above the filter bar:
     > **Step 1 of 2: Select the coasters you've ridden** · Filter by park or search below. When finished, tap Rank My Rides.
   - Includes a clean `Exit` button to return to pure browsing.
2. **Row Interaction Shift**:
   - In standard browse mode, tapping a row navigates to `/coasters/:slug`.
   - In **Mark Mode**, tapping anywhere on a row toggles its selected state (check/uncheck).
   - Selected rows immediately update visually:
     - Subtle accent/teal background tint (`bg-accent/10`).
     - A checkmark indicator replaces or sits alongside the rank badge.
   - Coaster and Park name links continue to allow opening details in a new tab without toggling selection (`e.stopPropagation()`).
3. **Multi-Filter Persistence**:
   - Selections are stored globally in the session selection set.
   - A user can search "Cedar Point", select 4 coasters, clear the filter, search "Kings Island", and select 3 coasters. The running selection count accurately reflects all 7 coasters.
4. **Floating Action Dock**:
   - Once $\ge 1$ coaster is marked, a floating dock smoothly animates into bottom-center:
     - **`Rank My Rides (N) →`** (Primary accent pill button).
     - **`Clear`** (Soft reset).
   - When Mark Mode is active, the generic 16s `SignupCta` is **completely suppressed** to eliminate visual conflict.

#### 3.3 Mode 3: The Ranking Workbench (`/rank`)
When the user clicks **`Rank My Rides (N)`**, they transition to `/rank`:
1. **Initial Seed Ordering**:
   - The selected coasters are automatically arranged in **Global Board Rank Order** (highest Bradley–Terry score first).
   - This provides an intelligent starting point, saving users from having to rank 15 coasters from scratch.
2. **Interactive Drag-Sort (`@dnd-kit`)**:
   - Renders the exact sortable card UI used on `/me`.
   - Users can drag handles to reposition coasters, fine-tuning their personal hierarchy.
   - Items can be deleted from the draft list via the standard swipe/trash affordance.
3. **Status Banner & CTA Chrome**:
   - Top banner:
     > **Unsaved Guest Ranking** · Drag to order your favorites. Create a free account to join the global board and save your list.
    - Sticky footer action bar:
      - **`Save Ranking & Join Board`** (Prominent coral/accent button).
      - **`+ Add More Coasters`** (Navigates back to `/` with Mark Mode pre-activated and existing selections preserved).
4. **Direct / Empty Visits**:
   - `/rank` hit directly (shared URL, back button) with no guest rides shows an empty state: brief explainer plus a **`Rank My Rides`** button returning to the board with Mark Mode pre-activated.
   - A logged-in user with **0 rides** who reaches `/rank` (not redirected — see Part II §3.1) gets the same workbench in seed mode; saving materializes the list via `materialize_guest_rides` — no signup, no merge modal.

#### 3.4 Mode 4: Promotion to Verified Account & Cross-Device Resilience
1. User clicks **`Save Ranking & Join Board`** on `/rank`.
2. Router directs to `/signup?from=guest`.
3. On submit, the signup call bundles the guest payload into auth metadata: `options.data.pending_guest_rides = { ids: orderedIds, started_at: createdAt }` (details in Part II §4.1).
4. **Cross-Device Problem Solved (client-side materialization)**:
   - The confirmation email can be opened on any device; the payload lives in `auth.users.raw_user_meta_data`, not in the originating browser.
   - The confirmation link lands on `/login?confirmed=1`, which already establishes a PKCE session (existing plumbing in `SignupPage.tsx`).
   - On the first `SIGNED_IN` event whose metadata contains `pending_guest_rides`, the client calls the `materialize_guest_rides` RPC with the full ordered list, then wipes the metadata (`auth.updateUser`) and clears `cr.guest-rides.v1` locally.
   - The user lands on `/me` with their ranked list fully populated.
   - Whichever device completes the first login performs the materialization — one implementation, no server-side trigger needed.
   - Dev note: with email confirmation disabled, `signUp` returns a session immediately and the same `SIGNED_IN` hook fires; no special-case code.
5. **Why not an `auth.users` trigger (rejected design)**: Supabase has no native on-confirmation hook; a hand-rolled `AFTER UPDATE` trigger runs as `supabase_auth_admin` with no user JWT, so `auth.uid()`-based RPCs are unusable from it. A trigger may be added later as belt-and-braces; it is explicitly out of v1 scope.

#### 3.5 Mode 5: Ironclad Clobber-Protection for Existing Accounts
If a user builds a guest list and then logs into an **existing** account:
- **Rule 1: Never auto-overwrite.** Destructive replacement (`replace = true`) is prohibited for guest merges.
- **Rule 2: Conflict Detection**:
  - If the account has **0 saved rides**: The guest list automatically becomes their account ranking.
  - If the account has **$\ge 1$ saved rides**: A clear modal interrupts the login redirect:
    > **You have coasters in progress**  
    > You selected 4 coasters in this session, and already have 38 coasters ranked in your account.  
    > - **[Add 4 coasters to the bottom of my account]** *(Guest-only coasters join at the bottom; your order is untouched)*  
    > - **[Discard session and keep my existing 38 coasters]**
  - There is **no** "Replace existing list" option in this flow. Existing rankings are strictly protected against accidental deletion.
- **Rule 3: Append sends the complete merged ladder.** The persistence RPC refuses append payloads that omit any currently ranked coaster, so "Add to the bottom" always submits `existing ranked ids (order unchanged) + new guest ids` as one ordered array — never just the new IDs.
- **Rule 4: Silent no-op edge.** If every guest ID already exists in the remote ranking, skip the modal entirely: clear the guest state and continue to `/me` without prompting.

#### 3.6 Mode 6: Logged-in Fast-Add (Append Mode)
Authenticated users browsing `/` can also enter Mark Mode:
- The top banner reads: **`Add ridden coasters to your ranking`**.
- The floating dock displays: **`Add (N) to My Coasters`**.
- Clicking it commits the selection by submitting the complete merged ladder (`existing ranked ids` + new ids appended at the bottom) via `materialize_guest_rides(p_kind := 'fast_add')` — the same coverage guard as every other path.
- A 10-second undo toast appears (*"Added 3 coasters to your ranking · [Undo]"*); undo removes the appended rides via the existing `useRemoveRide` mutation (N ≤ 100, looped).
- No navigation away from the board is required, making logging a park visit effortless.

#### 3.7 Touchpoint: Coaster Detail Page Funnel (`/coasters/:slug`)
- **v1 Scope**: Drop coaster detail integration from v1 core to keep the public board $\to$ `/rank` flow bulletproof.
- **v1.1 Fast-Follow**: Add a compact `"I've Ridden This"` pill on `/coasters/:slug`.
  - Clicking it adds the coaster to the active guest selection set and shows a toast:
    > *Added to your rides · [Mark more on board] or [Rank my rides (N)]*

---

### 4. Success Metrics & Guardrails

| Metric | Target | Measurement Method |
| :--- | :--- | :--- |
| **Verified-Signup Lift** | +35% vs baseline | Verified signups per active day vs. a comparable pre-launch baseline window. Coarse (traffic mix confounds it); with no pre-auth funnel this is a cohort comparison, not a true conversion rate (§5.1). |
| **Time-to-First-Ranking** | < 90 seconds | `guest_promotions.duration_ms`, server-computed from the client's `started_at` (first mark engagement) carried in the signup payload. Converters only. |
| **Starter List Depth** | Median $\ge 5$ rides | `guest_promotions.ride_count` (higher depth improves Bradley–Terry model accuracy). |
| **Merge-Conflict Resolution** | No modal dead-ends | `guest_promotions.kind = 'merge_append' \| 'merge_discard'` distribution; silent no-ops count as neither. |
| **Browse Experience Neutrality** | Qualitative in v1 | Bounce/scroll depth requires an analytics layer that doesn't exist yet; deferred (§5.1). Guarded by design instead: Mark Mode UI mounts only when activated, zero layout shift. |
| **Account Safety Guarantee** | 0 overwrites | Enforced structurally: no merge path can reach a `replace`-mode write (coverage guard + no replace option in the modal). Verified by unit + property tests. |

---

## Part II: Technical Specification

### 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│ Browser Client                                              │
│                                                             │
│  ┌─────────────────────────┐   ┌──────────────────────────┐ │
│  │ BoardPage (/)           │   │ GuestRankPage (/rank)    │ │
│  │  - CoasterTable (Mark)  │   │  - RankedCoasterList     │ │
│  │  - MarkModeBanner       │   │  - LocalStorageAdapter   │ │
│  │  - MarkModeDock         │   │  - Save / Promote CTA    │ │
│  └───────────┬─────────────┘   └────────────┬─────────────┘ │
│              │                              │               │
│              └──────────────┬───────────────┘               │
│                             │                               │
│              ┌──────────────▼───────────────┐               │
│              │ GuestRankingContext / Hook   │               │
│              │  - cr.guest-rides.v1         │               │
│              │  - Set<coaster_id>           │               │
│              └──────────────┬───────────────┘               │
└─────────────────────────────┼───────────────────────────────┘
                              │ Promotion via Supabase Auth
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ Supabase Platform                                           │
│                                                             │
│  auth.signUp(options.data.pending_guest_rides)              │
│  (ids + started_at live in raw_user_meta_data)              │
│                 │                                           │
│                 ▼                                           │
│  Email confirmed on ANY device → first login                │
│  (client: /login?confirmed=1 PKCE session → SIGNED_IN)      │
│                 │                                           │
│                 ▼                                           │
│  materialize_guest_rides RPC  (client-side call)            │
│                 │                                           │
│                 ▼                                           │
│  user_rides (Persistent & Verified)                         │
│  + guest_promotions (server-authoritative funnel metrics)   │
└─────────────────────────────────────────────────────────────┘
```

---

### 2. Client-Side Data Model

#### 2.1 Storage Key & Schema
Guest state is saved in `localStorage` under key `cr.guest-rides.v1`:

```typescript
export interface GuestRideItem {
  coaster_id: string
  name: string
  slug: string
  park_name: string | null
  park_country: string | null
  material: string
  status: string
  board_rank: number | null
  added_at: number
}

export interface GuestRankingState {
  version: 1
  /** Ordered list of coaster IDs representing user's custom ranking order */
  orderedIds: string[]
  /** Snapshot dictionary to render cards without re-querying the network */
  items: Record<string, GuestRideItem>
  /** Timestamp when mark mode was first engaged */
  createdAt: number
  /** Timestamp of most recent edit */
  updatedAt: number
}
```

#### 2.2 Storage Limits & Sanitation
- **Quota Safety**: Max 100 coasters stored locally (~4KB of IDs + snapshots; well under the 5MB browser quota). The 100 cap also keeps the signup-metadata payload far below GoTrue's undocumented `raw_user_meta_data` size limits, which can break auth sessions when exceeded (supabase/auth#1776).
- **Cap Overflow UX**: Marking beyond 100 is a no-op: the row toggles back off, a toast explains ("You can rank up to 100 coasters as a guest"), and the dock counter stays at 100. The RPC enforces a generous server-side ceiling (200) as defense-in-depth.
- **Catalog Drift Resilience**: Snapshots store `name` and `slug` so that if catalog data updates while offline, the user’s UI does not crash.
- **Idempotency**: Adding an already-selected coaster is a no-op; removing a coaster deletes it from both `orderedIds` and `items`.

---

### 3. Route & Component Architecture

#### 3.1 Route Setup (`app/src/App.tsx`)
A new public route is added outside `<RequireAuth />`:

```tsx
<Route path="/rank" element={<GuestRankPage />} />
```
- Accessible without login.
- A logged-in user **with ≥ 1 ranked ride** who navigates to `/rank` is redirected cleanly to `/me` (their workbench lives there).
- A logged-in user with **0 rides** gets the workbench in seed mode: saving materializes via `materialize_guest_rides` — no signup, no merge modal (§3.3 Mode 3).

#### 3.2 Decoupling `RankedCoasterList.tsx`
Currently, `RankedCoasterList.tsx` directly imports:
```tsx
const removeRide = useRemoveRide()
const saveRanks = useSaveRanks()
```
To support both authenticated (`/me`) and local (`/rank`) contexts, `RankedCoasterList` is refactored to accept an optional storage interface:

```typescript
export interface RankingStorageAdapter {
  isLocal: boolean
  onSaveRanks: (orderedIds: string[]) => Promise<void>
  onRemoveRide: (coasterId: string) => Promise<void>
}
```
- In `MyCoastersPage`: Passes `SupabaseAdapter` (uses `useSaveRanks` and `useRemoveRide`).
- In `GuestRankPage`: Passes `LocalStorageAdapter` (updates `cr.guest-rides.v1`).

#### 3.3 Enhancements to `CoasterTable.tsx`
`CoasterTable` receives three new props:
```typescript
interface CoasterTableProps {
  // ... existing props
  selectionMode?: boolean
  selectedIds?: Set<string>
  onToggleSelect?: (coaster: RankingRow) => void
}
```

When `selectionMode === true`:
1. **Row Click Handler**:
   ```tsx
   const handleRowClick = (row: RankingRow) => {
     if (selectionMode && onToggleSelect) {
       onToggleSelect(row)
       return
     }
     if (row.slug) navigate(`/coasters/${row.slug}`)
   }
   ```
2. **Visual Treatment**:
   - In place of the standard hover state, selected rows receive `bg-accent/15 border-l-4 border-accent`.
   - The rank badge area renders an animated checkmark icon when selected.

#### 3.4 New UI Components
- **`MarkModeBanner`**: Pinned above table filters when Mark Mode is active. Renders guidance text, selected counter, and `Exit` button.
- **`MarkModeDock`**: Fixed bottom-center floating bar with safe-area insets.
  - Renders: `Rank My Rides (${selectedCount})` with entrance slide-up transition.
  - Secondary button: `Clear all`.

---

### 4. Promotion & Cross-Device Verification Workflow

#### 4.1 Stashing Guest Data on Signup
When the user submits the signup form on `/signup`:
```typescript
const guestState = readGuestRanking()

const { error } = await supabase.auth.signUp({
  email,
  password,
  options: {
    data: {
      pending_guest_rides: guestState
        ? { ids: guestState.orderedIds, started_at: guestState.createdAt }
        : undefined
    }
  }
})
```

#### 4.2 Materialization on Email Confirmation (client-side)
When the user verifies their email (regardless of which device or browser opens the email link):
1. Supabase Auth marks `auth.users.email_confirmed_at = now()`; the verification link redirects to `/login?confirmed=1`, where the PKCE exchange establishes the session (existing behavior).
2. A `SIGNED_IN` listener (the guest-promotion hook) checks `user.user_metadata.pending_guest_rides`:
   - If present, calls `materialize_guest_rides(p_rides, p_started_at)` with the full ordered list.
   - On success, wipes the payload via `supabase.auth.updateUser({ data: { pending_guest_rides: null } })`, then clears `cr.guest-rides.v1`.
   - The RPC is idempotent (it rewrites the ladder from array position), so a retry after a failed wipe is safe.
3. The user lands on `/me` with the list already in `user_rides`.

This deliberately replaces v2's server-side trigger: Supabase has no native on-confirmation hook, and an `AFTER UPDATE ON auth.users` trigger runs as `supabase_auth_admin` (no user JWT), so `auth.uid()`-based RPCs are unusable from it. Client-side materialization is cross-device by construction and behaves identically when confirmation is disabled (dev), where `signUp` returns a session immediately.

#### 4.3 `materialize_guest_rides` RPC (new migration, Phase 4)

Guest promotion is **not** a spreadsheet import: it must not touch `profiles.imported_at`/`import_source`, write `import_events`, or fire the Telegram import notification. Reusing `apply_imported_rides` is blocked outright anyway — its `p_source` guard only accepts `csv | xls | xlsx | paste | sheets`, and its append contract conflicts with v2's merge-modal payload. Phase 4 therefore adds a purpose-built RPC:

```sql
materialize_guest_rides(p_rides jsonb, p_kind text default 'materialize', p_started_at timestamptz default null)
returns integer
```

Semantics (mirrors the ranked-ladder half of `apply_imported_rides`, minus import provenance):
- **Security invoker** — runs as the authenticated user; the target is `auth.uid()`. (A client call always has a JWT — unlike the rejected trigger path.)
- **Ladder validation**: payload must be a JSON array of coaster UUIDs; any unknown ID raises (same "refresh and retry" contract as the import RPC). Duplicates are deduped, first occurrence wins.
- **Coverage guard**: if the user has ranked rows absent from the payload, raise. Clients always send the complete ladder — the full guest list for fresh accounts, the full merged list for merge-append — making "never silently drop part of a ladder" structurally impossible.
- **Rewrite**: ranks are rewritten `1..n` gapless from array position; holding-pen rows (`rank = null`) not in the payload stay unranked. Idempotent by construction.
- **Server-side ceiling**: reject payloads > 200 IDs (the client caps at 100; this is defense-in-depth).
- **Telemetry**: when provided, inserts one `guest_promotions` row with server-computed `duration_ms`.
- **No side effects**: no Telegram notification, no `import_events` row, no profile stamping.

Companion table (RLS: `select` for `user_id = auth.uid()`; inserts only via the RPCs, which run as the invoker):

```sql
create table public.guest_promotions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  kind         text not null check (kind in ('materialize', 'merge_append', 'merge_discard', 'fast_add')),
  ride_count   integer not null default 0,
  duration_ms  integer,
  created_at   timestamptz not null default now()
);
```

A tiny sibling RPC `log_guest_merge_decision(p_kind text)` records `merge_discard` (which materializes nothing). `merge_append` and `fast_add` are logged by their `materialize_guest_rides` calls themselves.

#### 4.4 Existing Account Merge Modal (`ExistingAccountMergeModal.tsx`)

#### 4.3 Existing Account Merge Modal (`ExistingAccountMergeModal.tsx`)
If a returning user logs in with an active guest ranking in `localStorage`:
```typescript
// If remote account has rides:
if (remoteRides.length > 0 && guestRides.length > 0) {
  setShowMergeDialog(true)
}
```
Options presented:
1. **Append**:
   - Fetches the remote ranked list first (existing rides hooks, paginated with `.range()` per repo convention).
   - Computes `merged = remoteRankedIds ++ guestOnlyIds` (guest-only = present in the guest list but not remotely).
   - Submits the **complete merged ladder** via `materialize_guest_rides(merged, p_kind := 'merge_append')` — the coverage guard refuses partial payloads, so only-new-ID payloads are structurally impossible.
   - Clears `cr.guest-rides.v1`.
2. **Discard**:
   - Leaves the remote list untouched.
   - Logs `log_guest_merge_decision('merge_discard')`, clears `cr.guest-rides.v1`.
3. **Silent no-op**: if `guestOnlyIds` is empty, skip the modal — clear guest state and continue to `/me` without prompting.

---

### 5. Telemetry & Analytics

**Constraint (v2.1):** guests leave no server-side trace — the no-anon-writable-tables rule holds and there is no pre-auth analytics layer. v2.1 therefore captures telemetry **post-auth only**, through `guest_promotions` rows written by the RPCs (server-authoritative) plus fields carried inside the signup metadata payload. Pre-auth events (mark-mode entered, drag-sorted) are explicitly **not captured in v1**.

| Signal | Capture Point | Data |
| :--- | :--- | :--- |
| `guest_promotions.kind = 'materialize'` | `materialize_guest_rides` RPC | ride_count, duration_ms (server-computed from `started_at`), created_at |
| `guest_promotions.kind = 'merge_append'` | `materialize_guest_rides` RPC | appended count |
| `guest_promotions.kind = 'merge_discard'` | `log_guest_merge_decision` RPC | — |
| `guest_promotions.kind = 'fast_add'` | `materialize_guest_rides` RPC | appended count (Mode 6) |
| signup payload | `pending_guest_rides = { ids, started_at }` | ordered list depth at promotion time |

#### 5.1 Measurement limitations (explicit)

- Users who enter Mark Mode but never sign up leave **no trace**; Mark Mode entry rate and mid-funnel drop-off are unmeasurable without an analytics layer. Any "conversion" number is therefore a **cohort comparison** (verified-signup lift vs. a pre-launch baseline window), not a true funnel rate.
- If a privacy-safe aggregate analytics layer lands later (e.g., Cloudflare Workers Analytics Engine counters), pre-auth funnel events (`mark_mode_entered`, `rides_swept`) become the first candidates.

---

### 6. Accessibility & Responsiveness

- **Touch Targets**: On mobile, row heights in selection mode provide a minimum touch target of 54px.
- **Keyboard Navigation**:
  - `Space` and `Enter` toggle selection when a row is focused in Mark Mode. Implementation care: `<tr>` elements are not focusable by default — Mark Mode rows get `tabIndex={0}` with button-like semantics (or a visually-integrated checkbox input, which carries native keyboard behavior), and `aria-pressed` reflects selection state.
  - Drag-and-drop on `/rank` fully supports `@dnd-kit` keyboard sorting coordinates.
- **Screen Reader Announcements**:
  - Dock count changes are wrapped in an `aria-live="polite"` live region (`"X coasters selected"`).
- **Reduced Motion**: All slide-up and fade transitions obey `prefers-reduced-motion: reduce`.

---

### 7. Implementation Phasing

#### Phase 1: Foundation & State Engine
- Create `GuestRankingContext` and `cr.guest-rides.v1` storage manager (100-coaster cap + overflow UX, §2.2).
- Decouple `RankedCoasterList.tsx` to support swappable storage adapters.

#### Phase 2: Board Mark Mode
- Add `MarkModeBanner` and `MarkModeDock` to `BoardPage.tsx`.
- Add selection toggle handling to `CoasterTable.tsx`.
- Repurpose `SignupCta.tsx` to launch Mark Mode.

#### Phase 3: The Ranking Workbench (`/rank`)
- Create `GuestRankPage.tsx` using decoupled `RankedCoasterList`.
- Implement Global Board Rank initial sort heuristic.
- Build sticky save/exit action bar.

#### Phase 4: Auth Bridge & Clobber Protection
- Migration (via `supabase migration new`, PR-only flow): `guest_promotions` table + `materialize_guest_rides` + `log_guest_merge_decision` RPCs (§4.3).
- Update `/signup` to pack `pending_guest_rides` (`ids` + `started_at`).
- Implement the client-side `SIGNED_IN` materialization hook + metadata wipe (§4.2).
- Build `ExistingAccountMergeModal` on `/login` (complete merged ladder payload, silent no-op edge, §4.4).

#### Phase 5 (v1.1 Fast-Follow): Coaster Detail Integration
- Add "I've Ridden This" quick-add button on `/coasters/:slug`.
