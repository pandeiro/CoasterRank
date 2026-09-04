# CoasterRank mark (v3 "Heartline", 2026-09)

Source of truth for the brand mark: a coaster **hill** (ink `#202030`), a
coral **heart** carrying the ranking trend line (`#E85D75`), and an accent
**wave** (`#48CAE4`). The palette continues the v1 potrace pipeline
(`docs/logo-archive/`); v3 simplifies the shapes so the mark stays legible at
favicon sizes and at hero scale.

## Files

| File | Purpose |
| --- | --- |
| `v3-color.svg` | Approved color source (verbatim from the logo workshop). |
| `v3-bw.svg` | Approved single-color source. |
| `mark-color-{1024,512,192,64,32}.png` | Transparent raster exports for external use (app stores, social profiles, docs) — not referenced by the app itself. |
| `mark-reversed-1024.png` | Reversed raster (hill in canvas) for dark surfaces. |
| `mark-bw-1024.png` | Single-color raster. |

Generated from these sources (do not hand-edit; regenerate instead):

- `app/public/logo.svg` — color mark on transparent, used by the app header,
  board hero, and design board (light surfaces).
- `app/public/favicon.svg` — square 1024×1024 canvas, mark padded to 92%.
- `app/public/logo-reversed.svg` — hill in canvas `#FEFCF3` for dark surfaces
  (design-board header, social cards, app icon tile).
- `app/public/apple-touch-icon.png` — 180×180 ink tile (`#1A1A2E`) with the
  reversed mark.
- `app/public/og-default.png` and
  `docs/social-preview/coasterrank-social-preview.png` — social cards rendered
  from the HTML sources in `docs/social-preview/`.

## Regenerating

```bash
python3 docs/design/mark/export.py            # everything (needs playwright + chromium)
python3 docs/design/mark/export.py --svgs-only
```

`export.py` rebuilds the three production SVGs from `v3-color.svg`, rasterizes
the exports above, and re-screenshots both social-card HTML files. Social card
copy (board rows, counts) is edited in the HTML sources first, then re-exported
with the same command.
