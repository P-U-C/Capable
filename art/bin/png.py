#!/usr/bin/env python3
"""Rasterize SVGs to PNG files with headless Chromium (used by art/bin/icons.mjs).

stdin: [{"name": "icon-192.png", "svg": "<svg ...>", "size": 192}, ...]; argv[1]: out dir.
Each SVG is drawn at exactly size×size device pixels on a transparent page. No network.
"""
import json
import sys
from pathlib import Path

try:
    from playwright.sync_api import sync_playwright
except Exception as err:  # noqa: BLE001
    print(f"SKIP: Python Playwright is not installed ({err})")
    sys.exit(3)

out = Path(sys.argv[1])
items = json.load(sys.stdin)
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(device_scale_factor=1)
    page.route("**/*", lambda route: route.abort())
    for it in items:
        s = it["size"]
        page.set_viewport_size({"width": s, "height": s})
        page.set_content(f'<html><body style="margin:0;background:transparent">{it["svg"].replace("<svg ", f"<svg style=\"display:block;width:{s}px;height:{s}px\" ", 1)}</body></html>')
        page.screenshot(path=str(out / it["name"]), omit_background=True, clip={"x": 0, "y": 0, "width": s, "height": s})
        print(out / it["name"])
    browser.close()
