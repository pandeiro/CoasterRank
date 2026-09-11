# Guest Onboarding: "Mark & Rank"

**Status:** Approved for Implementation (v2 Spec)  
**Date:** 2026-09-11  
**Target Release:** v1 (Core Mark & Rank) + v1.1 (Coaster Detail Touchpoint)  
**Related Docs:** `docs/PLAN.md` (§2 "Anonymous 'ridden' flags → signup materialization", §11), `docs/SCHEMA.md`, `AGENTS.md`

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

---

### 3. User Journeys & Experience Design

```mermaid
flowchart TD
    A[Visitor on Public Board '/'] -->|Clicks 'Rank My Rides'| B[Mark Mode Overlay Activated]
    B -->|Taps Coaster Rows| C[Rows Highlighted + Dock Counter Updates]
    B -->|Filters by Park / Manufacturer| C
    C -->|Clicks 'Rank My Rides (X)' in Dock| D[Navigate to '/rank']
    D -->|Drag-Sort Reordering| E[Customized Local Ranking]
    E -->|Clicks 'Save Ranking & Join Board'| F['/signup' Flow]
    F -->|Email Confirmation| G[Materialized on '/me']
    
    A -->|Authed User Enters Mark Mode| H[Mark Mode: Add Mode]
    H -->|Selects New Rides| I[Clicks 'Add X to My Coasters']
    I -->|Atomic Append RPC| J[Appended to '/me' + 10s Undo Toast]
```

#### 3.1 Mode 1: The Browse Experience (Default)
- The global board (`/`) loads in its clean, read-optimized table layout.
- The desktop header CTA changes from a generic `Sign up` to **`Rank My Rides`**.
- The existing engagement-timed nudge (`SignupCta`) continues firing for passive browsers (after 16s engaged dwell + scroll), but its primary button now reads **`Start Your Ranking`**, triggering Mark Mode directly on the board rather than sending the user to a blank form.

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

#### 3.4 Mode 4: Promotion to Verified Account & Cross-Device Resilience
1. User clicks **`Save Ranking & Join Board`** on `/rank`.
2. Router directs to `/signup?from=guest`.
3. The guest list payload (`ordered_ids`) is bundled into the signup metadata (`options.data.pending_guest_rides`).
4. **Cross-Device Problem Solved**:
   - When users open their confirmation email on their phone instead of the initial laptop browser, the list is not lost!
   - Upon clicking the email verification link, the backend trigger/RPC reads `pending_guest_rides` directly from the verified auth user and creates the corresponding `user_rides` rows.
   - The user lands on `/me` with their ranked list fully populated.
   - The local `cr.guest-rides.v1` in `localStorage` is cleared.

#### 3.5 Mode 5: Ironclad Clobber-Protection for Existing Accounts
If a user builds a guest list and then logs into an **existing** account:
- **Rule 1: Never auto-overwrite.** Destructive replacement (`replace = true`) is prohibited for guest merges.
- **Rule 2: Conflict Detection**:
  - If the account has **0 saved rides**: The guest list automatically becomes their account ranking.
  - If the account has **$\ge 1$ saved rides**: A clear modal interrupts the login redirect:
    > **You have coasters in progress**  
    > You selected 4 coasters in this session, and already have 38 coasters ranked in your account.  
    > - **[Add 4 coasters to the bottom of my account]** *(Appends only new, unranked coasters)*  
    > - **[Discard session and keep my existing 38 coasters]**
  - There is **no** "Replace existing list" option in this flow. Existing rankings are strictly protected against accidental deletion.

#### 3.6 Mode 6: Logged-in Fast-Add (Append Mode)
Authenticated users browsing `/` can also enter Mark Mode:
- The top banner reads: **`Add ridden coasters to your ranking`**.
- The floating dock displays: **`Add (N) to My Coasters`**.
- Clicking it immediately commits the selected coasters to `user_rides` via the atomic append RPC.
- A 10-second undo toast appears (*"Added 3 coasters to your ranking · [Undo]"*).
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
| **Guest-to-Signup Conversion** | +35% vs baseline | Signup completion rate of visitors entering Mark Mode vs. cold `/signup` visits. |
| **Time-to-First-Ranking** | < 90 seconds | Timestamp delta between session start and first verified ranking save. |
| **Starter List Depth** | Median $\ge 5$ rides | Number of coasters ranked in initial submission (higher depth improves Bradley–Terry model accuracy). |
| **Browse Experience Neutrality** | Zero regression | Bounce rate and scroll depth of visitors who do not engage Mark Mode. |
| **Account Safety Guarantee** | 0 overwrites | Zero incidents of existing user rankings clobbered by guest session merges. |

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
│                 │                                           │
│                 ▼                                           │
│  on_auth_user_confirmed trigger / RPC                       │
│                 │                                           │
│                 ▼                                           │
│  apply_imported_rides(source = 'guest-promotion')           │
│                 │                                           │
│                 ▼                                           │
│  user_rides table (Persistent & Verified)                   │
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
- **Quota Safety**: Max 250 coasters stored locally (less than 50KB, well under the 5MB browser quota).
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
- If a logged-in user with an existing list navigates to `/rank`, they are redirected cleanly to `/me`.

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
      pending_guest_rides: guestState?.orderedIds ?? []
    }
  }
})
```

#### 4.2 Materialization on Email Confirmation
When the user verifies their email (regardless of which device or browser opens the email link):
1. Supabase Auth marks `auth.users.email_confirmed_at = now()`.
2. A database trigger or post-confirmation hook detects `raw_user_meta_data->'pending_guest_rides'`:
   - Invokes `apply_imported_rides(p_rides, p_replace := false, p_source := 'guest-promotion')`.
   - Wipes `pending_guest_rides` from metadata to ensure one-time execution.
3. When the user logs in, their list is already in `user_rides`.

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
   - Identifies coaster IDs present in `guestRides` but not in `remoteRides`.
   - Appends them to the end of the remote list via `apply_imported_rides()`.
   - Clears `cr.guest-rides.v1`.
2. **Discard**:
   - Leaves remote list untouched.
   - Clears `cr.guest-rides.v1`.

---

### 5. Telemetry & Analytics

To track conversion funnel health without violating the standing "no anon-writable tables" rule, telemetry fires post-auth or via existing event monitors:

| Event Name | Trigger Point | Data Captured |
| :--- | :--- | :--- |
| `guest_mark_mode_entered` | User toggles Mark Mode | Source (`header_cta` \| `hero` \| `signup_nudge`) |
| `guest_rides_swept` | User clicks "Rank My Rides" | Count of coasters selected |
| `guest_rank_reordered` | First drag-sort interaction on `/rank` | List length |
| `guest_promotion_initiated` | User clicks "Save Ranking" | List length |
| `guest_promotion_completed` | Server materializes `user_rides` | Final saved count, time from first mark |
| `existing_account_conflict` | Returning user logs in with guest state | Choice taken (`append` \| `discard`) |

---

### 6. Accessibility & Responsiveness

- **Touch Targets**: On mobile, row heights in selection mode provide a minimum touch target of 54px.
- **Keyboard Navigation**:
  - `Space` and `Enter` toggle selection when a row is focused in Mark Mode.
  - Drag-and-drop on `/rank` fully supports `@dnd-kit` keyboard sorting coordinates.
- **Screen Reader Announcements**:
  - Dock count changes are wrapped in an `aria-live="polite"` live region (`"X coasters selected"`).
- **Reduced Motion**: All slide-up and fade transitions obey `prefers-reduced-motion: reduce`.

---

### 7. Implementation Phasing

#### Phase 1: Foundation & State Engine
- Create `GuestRankingContext` and `cr.guest-rides.v1` storage manager.
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
- Update `/signup` to pack `pending_guest_rides`.
- Implement post-confirmation materialization trigger/RPC.
- Build `ExistingAccountMergeModal` on `/login`.

#### Phase 5 (v1.1 Fast-Follow): Coaster Detail Integration
- Add "I've Ridden This" quick-add button on `/coasters/:slug`.
