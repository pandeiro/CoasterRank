This is a fantastic brief. You have a functioning **data-heavy, community-driven engine** (the Bradley-Terry model), but it’s wrapped in a **generic, utilitarian shell** (default Tailwind slate/gray). 

Right now, the UX says: *"This is a reliable database."* 
We need it to say: *"This is a global, live arena for thrill-seekers to crown the ultimate coaster."*

As a senior designer, I look at this as an **"Adrenaline-Meets-Analytics"** problem. Before I outline the tactical plan, I have **3 clarifying questions** that will determine the depth of the pivot:

1. **Brand Legacy:** Do you already have a logo/favicon, or are we starting from a blank slate? (I’ll assume blank slate for now).
2. **Admin UI:** You have an Admin Dashboard (mentioned in README). Should it inherit the full "theme" (brand colors, rounded corners, high-emotion aesthetic), or should it be visually muted/utilitarian to signal *"back-office"* to the admins?
3. **Accessibility Constraint:** Does the visual overhaul need to strictly comply with WCAG AA (high contrast), or can we lean into darker, more saturated "night-ride" aesthetics with slightly lower contrast for pure mood?

---

### My Strategic Plan: "The CoasterRank Ascent"

We are shifting from a *list* to a *leaderboard*. Here is the 7-phase plan to transform the prototype.

#### Phase 1: The Brand Soul & Visual Identity (The "Why")
We create a brand persona: **"The Thrill-Seeking Data Analyst."** 
It’s precise (data-driven) but visceral (roller coasters).

- **Logo:** A custom wordmark or icon that subtly merges a **chart-bar (data)** with a **lift-hill (coaster)**. A stylized, upward-climbing geometric path.
- **Color Palette (Moving beyond `slate-900`):**
  - *Primary (Dark):* Deep **"Midnight Track"** (`#0B0C10` / `#1F2833`) – replaces slate for headers and footers. Signals premium, night-rides, and focus.
  - *Secondary (Accent):* **"Gold Medal"** (`#F5A623` / `#FFD700`) – used for #1 rankings, primary CTAs, and the "live" aspect. Gold denotes the top of the leaderboard.
  - *Tertiary (Energy):* **"G-Force Red/Orange"** (`#FF4500` or `#E63946`) – used sparingly for speed, inversions, and user action buttons (Add Coaster).
  - *Background:* Off-white `#F9F9F9` with subtle textured grain or a very faint grid pattern to echo "engineering/blueprints".
- **Typography:**
  - *Headlines:* A geometric, condensed sans-serif (e.g., **Racing Sans One** or **Oswald**) – evokes speed and compact strength.
  - *Body:* A highly readable, modern sans-serif (e.g., **Inter** or **DM Sans**) – keeps the data clean.

#### Phase 2: The Design System (Tailwind Override)
Instead of using Tailwind's default grays, we create a **custom theme** via `tailwind.config.js` and CSS variables to ensure engineering can pick it up immediately.

- **Radius:** Shift from standard `rounded` to a mixed system. Cards get a heavy `rounded-2xl` on the top, but `rounded-b-none` to create a "stacked" leaderboard effect.
- **Shadows:** Introduce a "Glow" shadow system (using the Gold/Red accents) for the Top 3 coasters to make them literally pop off the board.
- **Semantic Tokens:** Define `--brand-gold`, `--brand-track`, `--brand-accel` instead of hardcoding hex codes.

#### Phase 3: The Public Board (From "List" to "Live Leaderboard")
The `BoardPage.tsx` is the heartbeat. It needs to feel alive.

- **The Header:** Instead of "CoasterRank" in plain text, we use the branded wordmark. The subtitle is replaced with a **live "Last Updated: X minutes ago"** badge, reinforcing the 15-minute pg_cron job.
- **The Table Redesign:** Tables are boring. We turn this into a **"Racing Grid"**:
  - **Rank Column:** Large, bold, left-aligned numbers. #1, #2, #3 get distinct medal icons (🥇🥈🥉) or a gold/silver/bronze pill background.
  - **Coaster Name:** Paired with the Park Name directly below it in smaller, muted text (removing the need for a separate park column).
  - **The "Score":** The Bradley-Terry score is abstract. We display it as a **"Track Rating"** — a horizontal micro-bar that visually shows the power gap between the #1 and the #100 coaster.
  - **Filters (`FilterBar`):** Turn this into a horizontal, pill-based "Pit Lane" that sticks to the top (using your `sticky` class) with a slight blur (`backdrop-blur`) so it stays visible while scrolling the massive list.

#### Phase 4: "My Coasters" (Drag & Drop Precision)
This is the user's garage. It needs to feel tactile.

- **The "Unranked" Pile:** Currently, you search and add. In the UI, newly added coasters should appear at the top with a **pulsing highlight** (which you already have with `highlightId` – we just amplify the glow).
- **Rank Badges:** Instead of a static number, each coaster in the list gets a **large, draggable handle** (a hamburger icon + rank number). When you drag it, the list uses a **"Rubber Band"** physics effect (just a smooth spring animation via Framer Motion or CSS `transition`) to snap into place.
- **The "Pending Add" Banner:** You currently have a blue banner. We make it a bottom-sheet notification, or a full-width "Drop Zone" at the top of the list that says *"Drop here to rank #1!"* – gamifying the insertion.

#### Phase 5: Profile Page (The "Rider's License")
The Profile page is currently a form. We elevate it to a **"Rider's Passport."**

- **Layout:** Split-screen. Left side shows the avatar, username, and "Member since" date. 
- **Stats:** Add quick micro-stats (even if they're client-side computed): *"Coasters ridden: 24"*, *"Longest drop: 78m"*.
- **Admin Tag:** If `is_admin`, turn the small text badge into a highly visual "Track Inspector" shield.

#### Phase 6: Motion & Micro-interactions (The "Polished" Feel)
A static design is half the story. We define a motion charter:

- **Rank Shift:** When the global board updates (every 15 mins), any coaster that moves up in rank gets a subtle green flash; any that drops gets a red flash. (Using React `animate` on key changes).
- **Hover States:** On the Board, hovering a row lifts it slightly (translateY) and drops a strong shadow, acting like a physical trading card.
- **Loading Skeletons:** Replace the "Loading..." text with skeleton bars that shimmer. This signals high-performance data processing.

#### Phase 7: Implementation Bridge (Deliverables)
To make this immediately actionable for your React/Tailwind stack, I will deliver:

1. **A Figma Design Kit:** Containing the Core Components (Button, Input, Card, Table Row, Rank Badge) with auto-layout and variants.
2. **A `theme.css` & `tailwind.config.js`:** A drop-in file mapping all the new colors, fonts, and border-radii to Tailwind classes so your devs don't have to change component structure—just the classes.
3. **A Micro-interaction Guide:** Describing the CSS/React-spring values for the drag-drop physics and rank flashes.

---

**My next step**, if you approve, is to drill down into the **Board Page's table redesign**. 

- Do you prefer a **"Card-based"** mobile-first grid (where each coaster is a full card with art/score), or a **"Racing Spreadsheet"** (dense, compact, showing 50+ coasters at a glance) for the enthusiasts who love the data? 
- I personally lean toward a **hybrid**: compact rows on desktop (to show the top 100 quickly), but with visual "tickets" on mobile. Which suits your product vision best?
