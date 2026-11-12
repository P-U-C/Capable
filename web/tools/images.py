#!/usr/bin/env python3
"""Render the hosted build's share images into web/static/ with headless Chrome.

  python3 web/tools/images.py [--fonts /tmp/fontwork/node_modules]

og.png 1200x800 (3:2, the Mini App embed), icon.png 1024x1024 (no alpha),
splash.png 200x200. The Figure is drawn by src/figure.mjs, so the images use
the same mark the app does.
"""
import argparse, io, pathlib, subprocess
from playwright.sync_api import sync_playwright
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parents[1]
ap = argparse.ArgumentParser()
ap.add_argument("--fonts", default="")
a = ap.parse_args()

fig = subprocess.run(["node", "--input-type=module", "-e", """
import { renderFigure } from './src/figure.mjs';
import { model } from './src/model.mjs';
import { readFileSync } from 'node:fs';
const m = model(JSON.parse(readFileSync('../contract/fixtures/book.sample.json', 'utf8')));
process.stdout.write(String(renderFigure(m, ['network-state-visuals', 'friend-speech', 'exit'], { idPrefix: 'og' })));
"""], cwd=ROOT, capture_output=True, text=True, check=True).stdout
css = (ROOT / "src" / "styles.css").read_text()
fonts = ""
if a.fonts:
    f = pathlib.Path(a.fonts)
    fonts = f"""
@font-face{{font-family:'Newsreader';font-style:normal;font-weight:200 800;src:url('{(f / "@fontsource-variable/newsreader/files/newsreader-latin-opsz-normal.woff2").as_uri()}')}}
@font-face{{font-family:'Newsreader';font-style:italic;font-weight:200 800;src:url('{(f / "@fontsource-variable/newsreader/files/newsreader-latin-opsz-italic.woff2").as_uri()}')}}
@font-face{{font-family:'IBM Plex Mono';font-weight:400;src:url('{(f / "@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2").as_uri()}')}}
"""

def page(body, w, h, extra=""):
    return f"""<!doctype html><html><head><style>{fonts}{css}
html,body{{margin:0;width:{w}px;height:{h}px;overflow:hidden;background:#F3EFE6}}
:root{{color-scheme:light}} {extra}</style></head><body>{body}</body></html>"""

OG = page(f"""
<div style="position:absolute;inset:0;padding:84px 96px;display:grid;grid-template-columns:1fr 380px;gap:48px;align-items:center">
  <div>
    <p class="mono" style="color:#5E594F;font-size:20px;line-height:28px">An atlas of ideas · unofficial</p>
    <h1 style="margin:40px 0 0;font-size:200px;line-height:.9;font-weight:300;letter-spacing:-.045em;font-variation-settings:'opsz' 72;color:#1B1A17">Primer</h1>
    <p style="margin-top:28px;font-size:40px;line-height:52px;font-style:italic;color:#5E594F">The prize threads, read as a book: one idea at five depths.</p>
  </div>
  <div style="width:380px">{fig}</div>
</div>""", 1200, 800, ".fig .facet{stroke-width:1.1}")
ICON = page(f"""<div style="position:absolute;inset:150px">{fig}</div>""", 1024, 1024, ".fig .facet{stroke-width:1.6}")
SPLASH = page(f"""<div style="position:absolute;inset:28px">{fig}</div>""", 200, 200, ".fig .facet{stroke-width:2}")

out = ROOT / "static"
out.mkdir(exist_ok=True)
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox", "--allow-file-access-from-files"])
    for name, html, w, h in [("og.png", OG, 1200, 800), ("icon.png", ICON, 1024, 1024), ("splash.png", SPLASH, 200, 200)]:
        tmp = pathlib.Path("/tmp") / f"primer-{name}.html"
        tmp.write_text(html)
        pg = b.new_page(viewport={"width": w, "height": h}, device_scale_factor=1)
        pg.goto(tmp.as_uri())
        pg.wait_for_timeout(300)
        png = pg.screenshot()
        Image.open(io.BytesIO(png)).convert("RGB").save(out / name, optimize=True)
        print("wrote", out / name)
    b.close()
