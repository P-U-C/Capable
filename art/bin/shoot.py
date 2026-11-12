#!/usr/bin/env python3
"""Screenshot the art gallery for review.

    python3 art/bin/shoot.py [gallery.html] [outdir]

Writes one PNG per gallery section (logo, favicon, icons, scenes, portraits,
stamps) plus the full page, to /tmp/art-gallery by default. Needs Python
Playwright with Chromium. Local file only; no network.
"""
import os
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

here = Path(__file__).resolve().parent
src = Path(sys.argv[1]) if len(sys.argv) > 1 else here.parent / "gallery.html"
out = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("/tmp/art-gallery")
out.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1280, "height": 900}, device_scale_factor=1)
    page.route("**/*", lambda route: route.continue_() if route.request.url.startswith("file:") else route.abort())
    page.goto(src.resolve().as_uri())
    page.wait_for_timeout(300)
    for sec in ["tokens", "logo", "favicon", "icons", "scenes", "portraits", "stamps"]:
        page.locator(f"#{sec}").screenshot(path=str(out / f"{sec}.png"))
        print(out / f"{sec}.png")
    page.screenshot(path=str(out / "full.png"), full_page=True)
    print(out / "full.png")
    browser.close()
