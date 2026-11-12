#!/usr/bin/env python3
"""Rasterize SVGs in headless Chromium and report pixel colours (test helper).

stdin:  {"items": [{"svg": "<svg ...>", "size": 16, "points": [[x, y], ...]}]}
stdout: {"items": [[[r, g, b, a], ...], ...]}

Each SVG is drawn onto a size×size canvas (device pixel ratio 1) and the
listed pixels are read back. No network: the page is about:blank and the SVG
is a data: URL. Exit 3 with "SKIP: reason" when Playwright or Chromium is
unavailable, so the Node test can skip with that message.
"""
import json
import sys

try:
    from playwright.sync_api import sync_playwright
except Exception as err:  # noqa: BLE001
    print(f"SKIP: Python Playwright is not installed ({err})")
    sys.exit(3)

JS = """
async (items) => {
  const out = [];
  for (const it of items) {
    const img = new Image();
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(it.svg);
    await img.decode();
    const c = document.createElement("canvas");
    c.width = it.size; c.height = it.size;
    const g = c.getContext("2d");
    g.fillStyle = "#ffffff"; g.fillRect(0, 0, it.size, it.size);
    g.drawImage(img, 0, 0, it.size, it.size);
    const d = g.getImageData(0, 0, it.size, it.size).data;
    out.push(it.points.map(([x, y]) => Array.from(d.slice((y * it.size + x) * 4, (y * it.size + x) * 4 + 4))));
  }
  return out;
}
"""

def main():
    req = json.load(sys.stdin)
    try:
        with sync_playwright() as p:
            try:
                browser = p.chromium.launch()
            except Exception as err:  # noqa: BLE001
                print(f"SKIP: Chromium could not launch ({str(err).splitlines()[0]})")
                sys.exit(3)
            page = browser.new_page(device_scale_factor=1)
            page.route("**/*", lambda route: route.abort())
            res = page.evaluate(JS, req["items"])
            browser.close()
    except SystemExit:
        raise
    except Exception as err:  # noqa: BLE001
        print(f"ERROR: {err}")
        sys.exit(1)
    json.dump({"items": res}, sys.stdout)

main()
