#!/usr/bin/env python3
"""Local render check: screenshots of web/dist/index.html with headless Chrome.

  python3 web/tools/shoot.py [--out /tmp/primer-shots] [--fonts /tmp/fontwork/node_modules]

Google Fonts are unreachable from some sandboxes; with --fonts pointing at a
node_modules that holds @fontsource-variable/newsreader and @fontsource/ibm-plex-mono,
the font requests are answered from those files so the render matches production.
Without it, the fallback faces render (which is itself a useful check).
Also reports horizontal overflow at 320px and console errors.
"""
import argparse, json, os, pathlib, sys
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[1]
ap = argparse.ArgumentParser()
ap.add_argument("--out", default="/tmp/primer-shots")
ap.add_argument("--fonts", default="")
ap.add_argument("--file", default=str(ROOT / "dist" / "index.html"))
ap.add_argument("--routes", default="cover,exit,friend-speech,what-lasts,network-state-visuals,prologue,glossary,credits,about")
a = ap.parse_args()
out = pathlib.Path(a.out); out.mkdir(parents=True, exist_ok=True)
url = pathlib.Path(a.file).resolve().as_uri()

def font_css():
    f = pathlib.Path(a.fonts)
    nr = f / "@fontsource-variable/newsreader/files"
    pm = f / "@fontsource/ibm-plex-mono/files"
    return f"""
@font-face{{font-family:'Newsreader';font-style:normal;font-weight:200 800;font-display:swap;src:url(https://fonts.gstatic.com/local/nr-normal.woff2) format('woff2')}}
@font-face{{font-family:'Newsreader';font-style:italic;font-weight:200 800;font-display:swap;src:url(https://fonts.gstatic.com/local/nr-italic.woff2) format('woff2')}}
@font-face{{font-family:'IBM Plex Mono';font-style:normal;font-weight:400;font-display:swap;src:url(https://fonts.gstatic.com/local/pm-400.woff2) format('woff2')}}
@font-face{{font-family:'IBM Plex Mono';font-style:normal;font-weight:500;font-display:swap;src:url(https://fonts.gstatic.com/local/pm-500.woff2) format('woff2')}}
""", {
        "nr-normal.woff2": nr / "newsreader-latin-opsz-normal.woff2",
        "nr-italic.woff2": nr / "newsreader-latin-opsz-italic.woff2",
        "pm-400.woff2": pm / "ibm-plex-mono-latin-400-normal.woff2",
        "pm-500.woff2": pm / "ibm-plex-mono-latin-500-normal.woff2",
    }

css, files = font_css() if a.fonts else ("", {})
reads = ["prologue", "exit", "friend-speech"]
report = {"overflow": {}, "errors": []}
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    for scheme in ["light", "dark"]:
        for (w, h, tag) in [(390, 844, "m"), (1280, 800, "d"), (320, 640, "xs")]:
            ctx = b.new_context(viewport={"width": w, "height": h}, color_scheme=scheme, device_scale_factor=2 if w < 1000 else 1)
            def route(r):
                u = r.request.url
                if "fonts.googleapis.com" in u and css:
                    return r.fulfill(status=200, content_type="text/css", body=css)
                if "fonts.gstatic.com/local/" in u and files:
                    name = u.rsplit("/", 1)[1]
                    return r.fulfill(status=200, content_type="font/woff2", body=files[name].read_bytes(), headers={"access-control-allow-origin": "*"})
                if u.startswith("file:"):
                    return r.continue_()
                return r.abort()
            ctx.route("**/*", route)
            page = ctx.new_page()
            page.on("console", lambda m: report["errors"].append(m.text) if m.type == "error" else None)
            page.on("pageerror", lambda e: report["errors"].append(str(e)))
            page.goto(url)
            page.evaluate("(r) => localStorage.setItem('primer:v1', JSON.stringify({reads: r, depth: 3, path: 'editors-path', last: r[r.length-1]}))", reads)
            for r in a.routes.split(","):
                page.goto(f"{url}#{r}")
                page.reload()
                page.wait_for_timeout(350)
                ov = page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
                if ov > 0: report["overflow"][f"{tag}-{scheme}-{r}"] = ov
                if tag == "xs": continue
                page.screenshot(path=str(out / f"{r}-{tag}-{scheme}.png"), full_page=True)
                if r == "cover" or r == "exit":
                    page.screenshot(path=str(out / f"{r}-{tag}-{scheme}-fold.png"), full_page=False)
            ctx.close()
    b.close()
print(json.dumps(report, indent=1))
