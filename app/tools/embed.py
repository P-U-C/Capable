"""Dev tool: render the embed card (fc:miniapp imageUrl) to assets/embed.png.

  python3 -I tools/embed.py [--out assets/embed.png]

The composition is tools/embed.mjs (the seal and wordmark, the four stamps and
a row of portraits on paper, from the art grammar). Rendered at 1200x800 (3:2)
in headless Chrome and checked to be at most 1 MB. The PNG is committed; the
build copies it to dist/embed.png.
"""
import argparse
import os
import subprocess
import sys
import tempfile

from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.dirname(HERE)
ap = argparse.ArgumentParser()
ap.add_argument("--out", default=os.path.join(APP, "assets", "embed.png"))
args = ap.parse_args()

html = subprocess.run(["node", os.path.join(HERE, "embed.mjs")], cwd=APP, check=True, capture_output=True, text=True).stdout
os.makedirs(os.path.dirname(args.out), exist_ok=True)
with tempfile.TemporaryDirectory() as tmp:
    page_path = os.path.join(tmp, "embed.html")
    with open(page_path, "w") as f:
        f.write(html)
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path="/usr/bin/google-chrome")
        page = browser.new_page(viewport={"width": 1200, "height": 800}, device_scale_factor=1)
        page.goto("file://" + page_path)
        page.evaluate("document.fonts.ready")
        page.wait_for_timeout(300)
        page.screenshot(path=args.out, type="png")
        browser.close()
size = os.path.getsize(args.out)
if size > 1024 * 1024:
    sys.exit(f"{args.out} is {size} bytes, over 1 MB")
print(f"{args.out}: 1200x800, {size / 1024:.1f} KB")
