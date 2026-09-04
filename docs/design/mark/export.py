#!/usr/bin/env python3
"""Regenerate every CoasterRank mark asset from the source SVGs in this directory.

Covers the v3 Heartline mark (2026-09): coaster hill (ink #202030), ranked heart
(coral #E85D75), wave (accent #48CAE4).

Outputs:
  app/public/logo.svg             color mark, transparent (light surfaces)
  app/public/favicon.svg          square 1024x1024, padded (browser tab)
  app/public/logo-reversed.svg    hill in canvas #FEFCF3 (dark surfaces)
  app/public/apple-touch-icon.png 180x180 ink tile + reversed mark
  app/public/og-default.png       screenshot of docs/social-preview/og-default.html
  docs/social-preview/coasterrank-social-preview.png
                                  screenshot of docs/social-preview/github-og.html
  mark-color-{1024,512,192,64,32}.png   transparent rasters (external use)
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

COLOR = MARK_DIR / "v3-color.svg"
BW = MARK_DIR / "v3-bw.svg"

INK = "#202030"  # hill ink in the v3 mark (v1 potrace palette)
CANVAS = "#FEFCF3"  # paper canvas — reversed-mark hill color
TILE_INK = "#1A1A2E"  # apple-touch tile background (design-system Ink)

VIEWBOX = "0 0 1024 941"  # mark aspect ~1.088 (nearly square)
HEADER = (
    "<!-- CoasterRank v3 Heartline mark (2026-09): coaster hill, ranked heart, wave.\n"
    "     Generated from docs/design/mark/v3-color.svg — edit there, then run\n"
    "     `python3 docs/design/mark/export.py` to regenerate all variants/rasters. -->"
)


def load_inner(svg: Path) -> tuple[str, str]:
    """Return (open <g> tag, inner body) of the source's single top-level group."""
    src = svg.read_text()
    open_tag = re.search(r"<g\b[^>]*>", src).group(0)
    body = re.search(r"<g\b[^>]*>(.*)</g>", src, re.S).group(1)
    return open_tag, body


def svg_doc(viewbox: str, wrapped_body: str) -> str:
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" '
        f'viewBox="{viewbox}">\n  <title>CoasterRank mark</title>\n  {HEADER}\n'
        f"{wrapped_body}\n</svg>\n"
    )


def build_svgs() -> None:
    open_tag, body = load_inner(COLOR)
    rev_body = body.replace(f'fill="{INK}"', f'fill="{CANVAS}"')

    color_g = f"{open_tag}\n{body}  </g>"
    rev_g = f"{open_tag}\n{rev_body}  </g>"

    # Plain mark: source viewBox verbatim.
    (APP_PUBLIC / "logo.svg").write_text(svg_doc(VIEWBOX, color_g))

    # Reversed (dark surfaces): hill ink -> canvas.
    (APP_PUBLIC / "logo-reversed.svg").write_text(svg_doc(VIEWBOX, rev_g))

    # Favicon: square canvas, mark padded to 92% and centered
    # (x: (1024-1024*.92)/2 = 41; y: (1024-941*.92)/2 = 79.1).
    padded = (
        '<g transform="translate(41 79.1) scale(0.92)">\n'
        f"  {color_g}\n"
        "</g>"
    )
    (APP_PUBLIC / "favicon.svg").write_text(svg_doc("0 0 1024 1024", padded))

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

    color = APP_PUBLIC / "logo.svg"
    reversed_svg = APP_PUBLIC / "logo-reversed.svg"
    bw = MARK_DIR / "v3-bw.svg"

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1400, "height": 1200})

        # Transparent mark rasters (color / reversed / bw).
        for size in (1024, 512, 192, 64, 32):
            h = round(size * 941 / 1024)
            shoot(page, img_html(color, size, h), MARK_DIR / f"mark-color-{size}.png", True)
        shoot(page, img_html(reversed_svg, 1024, 941), MARK_DIR / "mark-reversed-1024.png", True)
        shoot(page, img_html(bw, 1024, 941), MARK_DIR / "mark-bw-1024.png", True)

        # Apple touch icon: full-bleed ink tile, reversed mark at ~71% width.
        tile = (
            "<!doctype html><html><head><style>"
            "html,body{margin:0;padding:0}"
            "</style></head><body>"
            '<div id="shot" style="width:180px;height:180px;background:'
            f"{TILE_INK};display:flex;align-items:center;justify-content:center\">"
            f'<img src="file://{reversed_svg}" style="width:128px;height:auto;display:block">'
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


if __name__ == "__main__":
    build_svgs()
    if "--svgs-only" not in sys.argv:
        export_rasters()
