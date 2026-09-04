#!/usr/bin/env python3
"""Regenerate every CoasterRank mark asset from the source SVGs in this directory.

Covers the v6 mark (2026-09): coaster hill (ink #202030), ranked heart
(coral #E85D75), wave (accent #48CAE4). Two approved sources, both landscape:

  v6-color-full.svg — detailed mark: app header, board hero, social cards
  v6-color-mini.svg — simplified mark: favicon, app tile
  v6-bw.svg         — single-color full variant (external use)

Outputs:
  app/public/logo.svg             full color mark, transparent (light surfaces)
  app/public/favicon.svg          square 1024x1024, mini mark padded (browser tab)
  app/public/logo-reversed.svg    full mark, hill in canvas #FEFCF3 (dark surfaces)
  app/public/apple-touch-icon.png 180x180 ink tile + reversed mini mark
  app/public/og-default.png       screenshot of docs/social-preview/og-default.html
  docs/social-preview/coasterrank-social-preview.png
                                  screenshot of docs/social-preview/github-og.html
  mark-color-{1024,512,192,64,32}.png   transparent rasters of the full mark
  mark-reversed-1024.png / mark-bw-1024.png

Usage:
  python3 export.py                 # everything (needs playwright + chromium)
  python3 export.py --svgs-only     # just the three production SVGs
"""

import re
import sys
from pathlib import Path

MARK_DIR = Path(__file__).resolve().parent
ROOT = MARK_DIR.parent.parent.parent
APP_PUBLIC = ROOT / "app" / "public"
SOCIAL_DIR = ROOT / "docs" / "social-preview"

FULL = MARK_DIR / "v6-color-full.svg"
MINI = MARK_DIR / "v6-color-mini.svg"
BW = MARK_DIR / "v6-bw.svg"

INK = "#202030"  # hill ink in the v6 mark (v1 potrace palette)
CANVAS = "#FEFCF3"  # paper canvas — reversed-mark hill color
TILE_INK = "#1A1A2E"  # apple-touch tile background (design-system Ink)
FAVICON_PAD = 0.92  # mini mark fills 92% of the square favicon canvas

HEADER = (
    "<!-- CoasterRank v6 mark (2026-09): coaster hill, ranked heart, wave.\n"
    "     Generated from docs/design/mark/v6-color-{full,mini}.svg — edit there, then run\n"
    "     `python3 docs/design/mark/export.py` to regenerate all variants/rasters. -->"
)


def load_source(svg: Path) -> tuple[tuple[float, float, float, float], str, str]:
    """Return (viewbox, open <g> tag, inner body) of the source's outer group."""
    src = svg.read_text()
    vb = re.search(r'viewBox="([^"]+)"', src).group(1)
    x, y, w, h = (float(v) for v in vb.split())
    open_tag = re.search(r"<g\b[^>]*>", src).group(0)
    body = re.search(r"<g\b[^>]*>(.*)</g>", src, re.S).group(1)
    return (x, y, w, h), open_tag, body


def svg_doc(viewbox: tuple[float, float, float, float], wrapped_body: str) -> str:
    x, y, w, h = viewbox
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" '
        f'viewBox="{x:g} {y:g} {w:g} {h:g}">\n  <title>CoasterRank mark</title>\n  {HEADER}\n'
        f"{wrapped_body}\n</svg>\n"
    )


def inline_mark_svg(viewbox: tuple[float, float, float, float], wrapped_body: str, width: int) -> str:
    x, y, w, h = viewbox
    return (
        f'<svg width="{width}" viewBox="{x:g} {y:g} {w:g} {h:g}" aria-hidden="true">\n'
        f"{wrapped_body}\n</svg>"
    )


def build_svgs() -> None:
    full_vb, full_open, full_body = load_source(FULL)
    mini_vb, mini_open, mini_body = load_source(MINI)

    full_rev_body = full_body.replace(f'fill="{INK}"', f'fill="{CANVAS}"')
    mini_rev_body = mini_body.replace(f'fill="{INK}"', f'fill="{CANVAS}"')

    full_color_g = f"{full_open}\n{full_body}  </g>"
    full_rev_g = f"{full_open}\n{full_rev_body}  </g>"
    mini_rev_g = f"{mini_open}\n{mini_rev_body}  </g>"

    # Full mark: source viewBox verbatim (light + dark surfaces).
    (APP_PUBLIC / "logo.svg").write_text(svg_doc(full_vb, full_color_g))
    (APP_PUBLIC / "logo-reversed.svg").write_text(svg_doc(full_vb, full_rev_g))

    # Favicon: square 1024 canvas, mini mark scaled to 92% of the canvas and
    # centered (larger dimension fills 92%).
    mx, my, mw, mh = mini_vb
    s = FAVICON_PAD * 1024 / max(mw, mh)
    tx = (1024 - mw * s) / 2
    ty = (1024 - mh * s) / 2
    mini_color_g = f"{mini_open}\n{mini_body}  </g>"
    padded = (
        f'<g transform="translate({tx:.1f} {ty:.1f}) scale({s:.5f})">\n'
        f"  {mini_color_g}\n"
        "</g>"
    )
    (APP_PUBLIC / "favicon.svg").write_text(svg_doc((0, 0, 1024, 1024), padded))

    # Apple-touch tile embeds the reversed mini mark inline.
    (MARK_DIR / ".tile-mark.html").write_text(inline_mark_svg(mini_vb, mini_rev_g, 128))

    print("wrote logo.svg, favicon.svg, logo-reversed.svg")


# --- raster exports (playwright) -------------------------------------------


def img_html(svg: Path, w: int, h: int) -> str:
    return (
        '<!doctype html><html><head><style>'
        "html,body{margin:0;padding:0;background:transparent}"
        "</style></head><body>"
        f'<img id="shot" src="file://{svg}" style="display:block;width:{w}px;height:{h}px">'
        "</body></html>"
    )


def shoot(page, html: str, out: Path, omit_background: bool) -> None:
    tmp = MARK_DIR / ".shot.html"
    tmp.write_text(html)
    page.goto(f"file://{tmp}")
    page.locator("#shot").screenshot(path=str(out), omit_background=omit_background)
    print(f"wrote {out.relative_to(ROOT)}")


def export_rasters() -> None:
    from playwright.sync_api import sync_playwright

    fx, fy, fw, fh = load_source(FULL)[0]
    aspect = fh / fw  # raster height = width * aspect

    color = APP_PUBLIC / "logo.svg"
    reversed_svg = APP_PUBLIC / "logo-reversed.svg"
    bw = BW

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1600, "height": 1400})

        # Transparent mark rasters (color / reversed / bw), full-mark aspect.
        for size in (1024, 512, 192, 64, 32):
            shoot(
                page,
                img_html(color, size, round(size * aspect)),
                MARK_DIR / f"mark-color-{size}.png",
                True,
            )
        shoot(page, img_html(reversed_svg, 1024, round(1024 * aspect)), MARK_DIR / "mark-reversed-1024.png", True)
        shoot(page, img_html(bw, 1024, round(1024 * aspect)), MARK_DIR / "mark-bw-1024.png", True)

        # Apple touch icon: full-bleed ink tile with the reversed mini mark
        # (inline SVG generated by build_svgs).
        tile_mark = (MARK_DIR / ".tile-mark.html").read_text()
        tile = (
            "<!doctype html><html><head><style>"
            "html,body{margin:0;padding:0}"
            "</style></head><body>"
            '<div id="shot" style="width:180px;height:180px;background:'
            f"{TILE_INK};display:flex;align-items:center;justify-content:center\">"
            f"{tile_mark}"
            "</div></body></html>"
        )
        shoot(page, tile, APP_PUBLIC / "apple-touch-icon.png", False)

        # Social cards from their committed HTML sources (Google Fonts need network).
        for html_file, out in (
            (SOCIAL_DIR / "og-default.html", APP_PUBLIC / "og-default.png"),
            (SOCIAL_DIR / "github-og.html", SOCIAL_DIR / "coasterrank-social-preview.png"),
        ):
            page.goto(f"file://{html_file}")
            page.wait_for_load_state("networkidle")
            page.wait_for_timeout(2000)  # let Google Fonts settle
            page.locator("#shot").screenshot(path=str(out))
            print(f"wrote {out.relative_to(ROOT)}")

        browser.close()
    (MARK_DIR / ".shot.html").unlink(missing_ok=True)
    (MARK_DIR / ".tile-mark.html").unlink(missing_ok=True)


if __name__ == "__main__":
    build_svgs()
    if "--svgs-only" not in sys.argv:
        export_rasters()
