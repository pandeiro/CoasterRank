# CoasterRank mark (v6, 2026-09)

Source of truth for the brand mark: a coaster **hill** (ink `#202030`), an
accent **track** — lift, drop, and loop with support columns (`#48CAE4`), and
a coral **heart** threaded by the loop's stitching (`#E85D75`). Both sources
are hand-drawn art vectorized via potrace, then recolored to the
design-token palette with their viewBoxes tightened to the ink bounds (so the
displayed box equals the artwork box). v6 replaces v3, archived in
`docs/logo-archive/v3/`.

## Files

| File | Purpose |
| --- | --- |
| `v6-color-full.svg` | Approved detailed source — header, hero, social cards. viewBox 1443.9 × 1113.2. |
| `v6-color-mini.svg` | Approved simplified source — favicon, app tile. viewBox 1916.3 × 1471.4. |
| `v6-bw.svg` | Single-color full variant (derived: every region flattened to ink). |
| `mark-color-{1024,512,192,64,32}.png` | Transparent raster exports for external use (app stores, social profiles, docs) — not referenced by the app itself. |
| `mark-reversed-1024.png` | Reversed raster (hill in canvas) for dark surfaces. |
| `mark-bw-1024.png` | Single-color raster. |

Generated from these sources (do not hand-edit; regenerate instead):

- `app/public/logo.svg` — full color mark on transparent, used by the app
  header, board hero, and design board (light surfaces).
- `app/public/favicon.svg` — square 1024×1024 canvas, mini mark padded to 92%.
- `app/public/logo-reversed.svg` — full mark with the hill in canvas
  `#FEFCF3` for dark surfaces (design-board header, social cards).
- `app/public/apple-touch-icon.png` — 180×180 ink tile (`#1A1A2E`) with the
  reversed mini mark.
- `app/public/og-default.png` and
  `docs/social-preview/coasterrank-social-preview.png` — social cards rendered
  from the HTML sources in `docs/social-preview/`, which reference
  `/logo-reversed.svg` rather than inlining mark paths.

## Regenerating

```bash
python3 docs/design/mark/export.py            # everything (needs playwright + chromium)
python3 docs/design/mark/export.py --svgs-only
```

`export.py` rebuilds the three production SVGs from `v6-color-full.svg` and
`v6-color-mini.svg`, rasterizes the exports above, and re-screenshots both
social-card HTML files. Social card copy (board rows, counts) is edited in the
HTML sources first, then re-exported with the same command.
