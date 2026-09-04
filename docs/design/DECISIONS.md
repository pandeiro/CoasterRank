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

- The public board remains a semantic HTML table.
- Desktop and mobile both use a dense spreadsheet-like presentation; mobile
  may horizontally scroll rather than converting rows into cards.
- Rank is the primary visual signal. Score, comparisons, and participants are
  supporting metrics.
- Search and filters remain directly available on the board. Filters use a
  compact responsive grid and retain their URL-backed behavior.
- The shared page container is intentionally wider than the original shell so
  the board can show useful data without feeling cramped.

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

The mark (v3 "Heartline", September 2026) combines a coaster hill, a coral
heart carrying the ranking trend line, and an accent wave — the ride, the
love, the return. It replaces the busier v1 mark (archived in
`docs/logo-archive/`) with bolder shapes that hold up at favicon sizes and at
hero scale.

Mark palette: hill ink `#202030` (the v1 potrace dark), heart `#E85D75`, wave
`#48CAE4`.

Production files:

- [`app/public/logo.svg`](../../app/public/logo.svg) — color mark on
  transparent, used for the header mark, board hero, and favicon source.
- [`app/public/favicon.svg`](../../app/public/favicon.svg) — square-padded
  variant for the browser tab.
- [`app/public/logo-reversed.svg`](../../app/public/logo-reversed.svg) — hill
  rendered in canvas for dark surfaces (design-board header, social cards).
- [`app/public/apple-touch-icon.png`](../../app/public/apple-touch-icon.png) —
  180×180 ink tile with the reversed mark.
- [`docs/design/mark/`](../design/mark/README.md) — source SVGs, transparent
  raster exports for external use, and `export.py`, which regenerates every
  derived asset (production SVGs, rasters, social cards).

Wordmark and small-size variants can evolve independently from the mark.

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
