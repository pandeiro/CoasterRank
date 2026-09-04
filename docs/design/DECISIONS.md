# CoasterRank design decisions

Status: accepted  
Date: 2026-08-20  
Scope: v1 visual design system and product UI styling

This is the canonical record of the design decisions made during the design
system spike. The original material in `docs/spikes/design/` remains as
historical source material; this document records the decisions we are
implementing.

## Product character

CoasterRank should feel like a precise, data-driven leaderboard with the
energy of a boardwalk or night-ride experience. The visual language is
“adrenaline meets analytics,” but metaphors stay restrained so ranking data
remains easy to scan.

## Visual language

The palette uses a deep indigo/ink structure, warm paper-like surfaces, one
primary teal accent, and coral for emphasis. Accent colors are semantic and
are not assigned mechanically to rank positions.

| Role | Value | Use |
| --- | --- | --- |
| Ink | `#1A1A2E` | Primary text, navigation, primary actions |
| Ink soft | `#2F2E48` | Secondary headings and supporting emphasis |
| Canvas | `#FEFCF3` | Page background |
| Surface | `#F5F0E8` | Quiet panels, controls, tags |
| Surface bright | `#FFFFFF` | Cards, tables, form surfaces |
| Line | `#E0DBD1` | Borders and dividers |
| Muted | `#4A4A5A` | Secondary text and metadata |
| Accent | `#48CAE4` | Interactive emphasis and active states |
| Accent strong | `#159AB8` | Accent text and stronger borders |
| Coral | `#E85D75` | Brand emphasis and selected highlights |
| Success | `#2E8B73` | Successful operations |
| Warning | `#B7791F` | Low-confidence or cautionary states |
| Danger | `#C24156` | Errors and destructive actions |

The source of truth for these values is
[`app/src/index.css`](../../app/src/index.css), with Tailwind aliases in
[`app/tailwind.config.js`](../../app/tailwind.config.js). Components should
use semantic aliases rather than raw hex values.

## Typography

- `Racing Sans One` is reserved for the wordmark, page titles, rank numbers,
  and selected display moments.
- `Inter` is used for navigation, tables, forms, metadata, and body copy.
- System fallbacks remain in place so the app stays usable while the web fonts
  load or when a font request is unavailable.

## Layout and board behavior

Amended September 2026 after an external design review of the live board
(see PLAN.md Phase 3.1); the original v1 stance is retained where it still
holds.

- The public board remains a semantic HTML table.
- Desktop and mobile both use a dense spreadsheet-like presentation; mobile
  may horizontally scroll rather than converting rows into cards.
- The board leads with a single masthead heading — mark + "CoasterRank"
  wordmark, nothing else. The "World's Best Roller Coasters" descriptor was
  dropped entirely after it kept competing with the wordmark for weight; the
  status line (`N coasters · N countries · Live` with a teal pulse dot) carries
  the live claim on its own. The mark renders ~10% larger than the wordmark's
  cap height with a tightened gap, and the wordmark takes a small optical rise
  (`-0.06em`) off the shared baseline so it nestles into the mark's right
  slope instead of hanging at its bottom edge. (First shipped as brand block +
  separate H1 + tagline, then merged into one h1, then the descriptor dropped;
  see PLAN Phase 3.1.)
- Rank is the primary visual signal, now rendered as display-font editorial
  numerals at a larger, low-contrast size (the original typography intent,
  which had not fully shipped). The podium rows carry a neutral surface tint
  (#1 slightly stronger than #2–3); accents are still never assigned to rank
  positions, and medal colors were explicitly rejected.
- A quiet **Score** column returns (amending the Phase 3.0 removal) to answer
  the cold-visitor question "ranked by what?". Raw BT strengths compress into
  a ±3% band around the 1.0 anchor, so scores are displayed on an index
  scale — `score × 100`, one decimal, 100 = community average — with the
  basis explained in the header tooltip. Comparisons and participants remain
  off the table (few-votes badge and first-place pill carry them).
- Whole rows navigate to the coaster detail page; the inline coaster and park
  links keep their own targets.
- Search and filters remain directly available on the board, as one control
  system: labeled groups (Track: All/Wood/Steel, Status: Running/All —
  "Any" renamed to "All"), quiet outlined toggles whose selected state uses
  the teal accent instead of filled ink, and URL-backed behavior unchanged.
  On mobile the toggles still fold into the Filters popover.
- The shared page container is intentionally wider than the original shell so
  the board can show useful data without feeling cramped; reviewers' request
  to narrow it was declined after measuring (the cap is 72rem, not
  edge-to-edge).
- The page's one decorative visual layer is a subtle vector track-line
  (hill–dip–loop) behind the hero. Coaster photography would need a licensed
  image source (none exists in the schema; RCDB photos are copyrighted) and
  stays out of scope.

## Component strategy

This is a small in-product design system, not a separate component-library
package. Shared primitives live in
[`app/src/components/ui.tsx`](../../app/src/components/ui.tsx):

- Buttons and variants
- Badges
- Panels
- Page headers
- Message states
- Shared form-control classes

Existing feature components continue to own their product-specific behavior.
They should consume the shared primitives and semantic tokens rather than
duplicating visual decisions.

## Interaction and motion

The first implementation emphasizes useful feedback:

- Clear hover, focus, disabled, error, and selected states
- Subtle row elevation and drag-sort transitions
- Loading, empty, and error states that preserve layout context
- Highlighting for newly inserted personal rankings

Rank movement animations, historical deltas, and weekly movers are deferred
because they require ranking refresh/history data that is not part of the
current read model.

## Admin and authenticated surfaces

Admin, auth, profile, submission, and personal-ranking pages use the same
tokens and primitives. Admin can be denser and more utilitarian, but it does
not need a separate visual theme.

The existing personal-ranking behavior is retained: users can add a coaster to
the top, bottom, or a specific insertion point, then drag-sort with optimistic
save and rollback.

## Logo

The mark (v6, September 2026) combines a coaster hill, an accent track with
its support columns — lift, drop, and loop — and a coral heart threaded by the
loop's stitching: the drop, the ride, the love. It replaces the v3 "Heartline"
mark (archived in `docs/logo-archive/v3/`) after the September 2026 design
review: one clear coaster gesture instead of a heartbeat metaphor, holding up
at both favicon and hero scale.

Two approved sources, both potrace vectorizations recolored to the
design-token palette (ink `#202030`, coral `#E85D75`, accent `#48CAE4`) with
viewBoxes tightened to the ink bounds:

- `v6-color-full.svg` — detailed mark for the header, hero, and social cards.
- `v6-color-mini.svg` — simplified mark for the favicon and app tile.
- `v6-bw.svg` — single-color variant (derived from the full mark).

Production files (generated, never hand-edited):

- [`app/public/logo.svg`](../../app/public/logo.svg) — color mark on
  transparent, used for the header mark and board hero.
- [`app/public/favicon.svg`](../../app/public/favicon.svg) — square-padded
  mini variant for the browser tab.
- [`app/public/logo-reversed.svg`](../../app/public/logo-reversed.svg) — hill
  rendered in canvas for dark surfaces (design-board header, social cards).
- [`app/public/apple-touch-icon.png`](../../app/public/apple-touch-icon.png) —
  180×180 ink tile with the reversed mini mark.
- [`docs/design/mark/`](../design/mark/README.md) — source SVGs, transparent
  raster exports for external use, and `export.py`, which regenerates every
  derived asset (production SVGs, rasters, social cards).

Brand lockups (navbar, hero) align the mark and the wordmark with
`items-baseline`: an image's flex baseline is its bottom edge, and
"CoasterRank" has no descenders, so baseline = visual bottom edge — the mark's
bottom edge sits exactly on the wordmark's.

## Explicitly out of scope

The following are product/data-model ideas, not design-system work:

- First-place vote counts
- Last-updated metadata in the board read model
- Rank history, rank deltas, or weekly movers
- New coaster statistics or profile analytics
- New ranking behavior or Bradley-Terry algorithm changes

## Living reference

[`app/design.html`](../../app/design.html) is a standalone, unlinked design
board. It renders the actual app tokens and shared primitives without loading
Supabase data. It is intentionally not protected by admin auth because it
contains no private data or privileged operations. It includes `noindex`
metadata to discourage search indexing.
