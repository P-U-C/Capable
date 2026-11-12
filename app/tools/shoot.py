"""Dev tool: screenshot a built dist/ in headless Chrome.

  python3 -I tools/shoot.py --dist dist --out /tmp/shots [--assets /tmp/appassets]

The sandbox cannot reach Google Fonts, cdnjs or the video hosts, so requests to
them are answered locally: fonts from @fontsource packages, hls.js from the
npm package, and every .m3u8/.ts from a generated test stream (ffmpeg). Pass
--native-hls off to force the hls.js path in Chrome.
"""
import argparse
import functools
import http.server
import json
import mimetypes
import os
import re
import sys
import threading
import time

from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument("--dist", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--assets", default="/tmp/appassets")
ap.add_argument("--only", default="")
args = ap.parse_args()
os.makedirs(args.out, exist_ok=True)
NM = os.path.join(args.assets, "node_modules")

FONT_FILES = {
    "archivo": ("Archivo", "normal", "100 900", "62% 125%", "@fontsource-variable/archivo/files/archivo-latin-wdth-normal.woff2"),
    "inter500": ("Inter", "normal", "500", "100%", "@fontsource/inter/files/inter-latin-500-normal.woff2"),
    "inter600": ("Inter", "normal", "600", "100%", "@fontsource/inter/files/inter-latin-600-normal.woff2"),
    "inter700": ("Inter", "normal", "700", "100%", "@fontsource/inter/files/inter-latin-700-normal.woff2"),
    "inter800": ("Inter", "normal", "800", "100%", "@fontsource/inter/files/inter-latin-800-normal.woff2"),
    "pixel": ("Pixelify Sans", "normal", "600", "100%", "@fontsource/pixelify-sans/files/pixelify-sans-latin-600-normal.woff2"),
    "playfair": ("Playfair Display", "italic", "700", "100%", "@fontsource/playfair-display/files/playfair-display-latin-700-italic.woff2"),
    "mono400": ("Space Mono", "normal", "400", "100%", "@fontsource/space-mono/files/space-mono-latin-400-normal.woff2"),
    "mono700": ("Space Mono", "normal", "700", "100%", "@fontsource/space-mono/files/space-mono-latin-700-normal.woff2"),
}
FONT_CSS = "\n".join(
    f"@font-face{{font-family:'{fam}';font-style:{style};font-weight:{w};font-stretch:{st};font-display:swap;src:url(https://fonts.gstatic.com/local/{k}.woff2) format('woff2');}}"
    for k, (fam, style, w, st, _) in FONT_FILES.items()
)

mimetypes.add_type("application/manifest+json", ".webmanifest")


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=os.path.abspath(args.dist)))
threading.Thread(target=server.serve_forever, daemon=True).start()
BASE = f"http://127.0.0.1:{server.server_address[1]}/"
STREAM = os.path.join(args.assets, "stream")


def route(r):
    url = r.request.url
    if url.startswith("https://fonts.googleapis.com/css2"):
        return r.fulfill(status=200, content_type="text/css", body=FONT_CSS, headers={"access-control-allow-origin": "*"})
    m = re.match(r"https://fonts\.gstatic\.com/local/(\w+)\.woff2", url)
    if m:
        with open(os.path.join(NM, FONT_FILES[m.group(1)][4]), "rb") as f:
            return r.fulfill(status=200, content_type="font/woff2", body=f.read(), headers={"access-control-allow-origin": "*"})
    if url.startswith("https://cdnjs.cloudflare.com/ajax/libs/hls.js/"):
        with open(os.path.join(NM, "hls.js/dist/hls.min.js"), "rb") as f:
            return r.fulfill(status=200, content_type="application/javascript", body=f.read(), headers={"access-control-allow-origin": "*"})
    if url.endswith(".m3u8"):
        with open(os.path.join(STREAM, "test.m3u8"), "rb") as f:
            return r.fulfill(status=200, content_type="application/vnd.apple.mpegurl", body=f.read(), headers={"access-control-allow-origin": "*"})
    m = re.search(r"/(seg\d+\.ts)$", url)
    if m:
        with open(os.path.join(STREAM, m.group(1)), "rb") as f:
            return r.fulfill(status=200, content_type="video/mp2t", body=f.read(), headers={"access-control-allow-origin": "*"})
    if url.startswith(BASE):
        return r.continue_()
    return r.abort()


report = {"console": [], "errors": [], "shots": [], "checks": {}, "fit": {}}

with open(os.path.join(args.dist, "app.json")) as f:
    APP = json.load(f)
LESSONS = [l["id"] for l in sorted(APP["lessons"], key=lambda l: l["number"])]
# the first lesson with a lead video, for the video, drag and sheet shots
LEAD_LESSON = next((l["id"] for l in sorted(APP["lessons"], key=lambda l: l["number"]) if any(w["role"] == "lead" and w["kind"] == "video" for w in l.get("work", []))), LESSONS[0])
KINDS = ["idea", "story", "term", "counter", "question", "practice", "lead", "more", "trait", "deeper", "next"]


def new_page(browser, w, h, reduced=False, native_hls=False, storage=None):
    ctx = browser.new_context(viewport={"width": w, "height": h}, device_scale_factor=2, is_mobile=w < 600, has_touch=w < 600, service_workers="block", reduced_motion="reduce" if reduced else "no-preference")
    ctx.route("**/*", route)
    init = ""
    if not native_hls:
        init += "HTMLMediaElement.prototype.canPlayType=(function(o){return function(t){return /mpegurl/i.test(t)?'':o.call(this,t)}})(HTMLMediaElement.prototype.canPlayType);"
    if storage:
        init += f"try{{localStorage.setItem('citizen.v1', {json.dumps(json.dumps(storage))})}}catch(e){{}}"
    if init:
        ctx.add_init_script(init)
    page = ctx.new_page()
    page.on("console", lambda m: report["console"].append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
    page.on("pageerror", lambda e: report["errors"].append(str(e)))
    return ctx, page


def settle(page, ms=500):
    page.wait_for_timeout(ms)
    page.evaluate("document.fonts.ready")


def shot(page, name):
    if args.only and not re.search(args.only, name):
        return
    p = os.path.join(args.out, f"{name}.png")
    page.screenshot(path=p)
    report["shots"].append(p)


def goto_card(page, kind, nth=0):
    i = page.evaluate(f"[...document.querySelectorAll('.deck .card')].filter(c=>c.dataset.type==='{kind}')[{nth}]?.dataset.i")
    if i is None:
        return False
    page.evaluate(f"window.__deckGo && window.__deckGo({i})")
    cur = page.evaluate("+document.querySelector('.card.is-active').dataset.i")
    while cur < int(i):
        page.keyboard.press("ArrowRight")
        page.wait_for_timeout(60)
        cur = page.evaluate("+document.querySelector('.card.is-active').dataset.i")
    while cur > int(i):
        page.keyboard.press("ArrowLeft")
        page.wait_for_timeout(60)
        cur = page.evaluate("+document.querySelector('.card.is-active').dataset.i")
    page.wait_for_timeout(450)
    return True


def fit_report(page):
    """Per card: the type step it settled on, whether it scrolls, and any text cut off (must be none)."""
    return page.evaluate("""[...document.querySelectorAll('.deck .card')].map(c => {
      const b = c.querySelector('.card__body');
      return { i: +c.dataset.i, type: c.dataset.type, fit: c.dataset.fit || '', scrolls: c.hasAttribute('data-scrolls'),
               over: b ? b.scrollHeight - b.clientHeight : 0, clipX: b ? b.scrollWidth - b.clientWidth : 0 };
    }).filter(x => x.fit !== '' || x.over > 1 || x.clipX > 1)""")


def overflow_x(page):
    return page.evaluate("Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth")


with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--autoplay-policy=no-user-gesture-required"])

    # phone, 390×844
    ctx, page = new_page(browser, 390, 844)
    page.goto(BASE)
    settle(page, 900)
    shot(page, "01-home")
    report["checks"]["home_overflow_390"] = overflow_x(page)
    page.evaluate("document.querySelector('.tiles__item:nth-child(2) .tile').scrollIntoView({block:'start'})")
    settle(page, 300)
    shot(page, "02-home-tile")
    page.evaluate("document.querySelector('#you').scrollIntoView({block:'start'})")
    settle(page, 300)
    shot(page, "03-home-you")

    for lesson in LESSONS:
        page.evaluate(f"location.hash='#/l/{lesson}'")
        settle(page, 700)
        goto_card(page, "cover")
        shot(page, f"10-{lesson}-cover")
        for kind in KINDS:
            for nth in range(6 if kind == "idea" else 1):
                if goto_card(page, kind, nth):
                    if kind == "lead":
                        page.wait_for_timeout(1800)
                    if kind == "trait":
                        page.wait_for_timeout(500)
                    look = page.evaluate("document.querySelector('.card.is-active').dataset.look || ''")
                    shot(page, f"1{KINDS.index(kind)+1:x}{'abcdef'[nth] if kind == 'idea' else ''}-{lesson}-{kind}{'-' + look if look else ''}")
        report["checks"][f"deck_overflow_{lesson}"] = overflow_x(page)
        report["fit"][f"390/{lesson}"] = fit_report(page)
        if lesson == LEAD_LESSON:
            goto_card(page, "lead")
            report["checks"]["video_state"] = page.evaluate("document.querySelector('.card.is-active .vframe').className")
            report["checks"]["video_has_element"] = page.evaluate("!!document.querySelector('.card.is-active video')")
            report["checks"]["hls_loaded"] = page.evaluate("!!window.Hls")
            report["checks"]["video_time"] = page.evaluate("document.querySelector('.card.is-active video')?.currentTime ?? -1")
            # mid-drag frame: the card follows the finger and turns
            box = page.evaluate("(()=>{const r=document.querySelector('.deck__stage').getBoundingClientRect();return [r.x,r.y,r.width,r.height]})()")
            x0, y0 = box[0] + box[2] * 0.8, box[1] + box[3] * 0.5
            page.mouse.move(x0, y0)
            page.mouse.down()
            for k in range(1, 8):
                page.mouse.move(x0 - k * 20, y0 + k * 2)
                page.wait_for_timeout(16)
            shot(page, "30-drag")
            page.mouse.move(x0 - 40, y0)
            page.mouse.up()
            page.wait_for_timeout(500)
            goto_card(page, "more")
            page.click(".card.is-active [data-open]")
            page.wait_for_timeout(1500)
            shot(page, "31-sheet")
            page.keyboard.press("Escape")
            page.wait_for_timeout(300)
    ctx.close()

    # video error fallback: the stream 404s
    ctx, page = new_page(browser, 390, 844)
    ctx.route(re.compile(r".*\.m3u8$"), lambda r: r.fulfill(status=404, body="no"))
    page.goto(BASE + f"#/l/{LEAD_LESSON}")
    settle(page, 700)
    goto_card(page, "lead")
    page.wait_for_timeout(2500)
    shot(page, "32-video-error")
    report["checks"]["video_error_class"] = page.evaluate("document.querySelector('.card.is-active .vframe').className")
    ctx.close()

    # progress remembered: finish two lessons, then home
    ctx, page = new_page(browser, 390, 844, storage={"pos": {LESSONS[0]: 13, LESSONS[1]: 4}, "furthest": {LESSONS[0]: 1, LESSONS[1]: 0.3}, "done": {LESSONS[0]: True}, "ticks": {}, "sound": False})
    page.goto(BASE)
    settle(page, 800)
    shot(page, "04-home-progress")
    page.evaluate("document.querySelector('#you').scrollIntoView({block:'start'})")
    settle(page, 300)
    shot(page, "05-home-you-progress")
    ctx.close()

    # narrow phone, 320×568
    ctx, page = new_page(browser, 320, 568)
    page.goto(BASE)
    settle(page, 800)
    shot(page, "40-home-320")
    report["checks"]["home_overflow_320"] = overflow_x(page)
    for lesson in LESSONS:
        page.evaluate(f"location.hash='#/l/{lesson}'")
        settle(page, 700)
        report["fit"][f"320/{lesson}"] = fit_report(page)
    page.evaluate(f"location.hash='#/l/{LESSONS[-1]}'")
    settle(page, 700)
    shot(page, "41-cover-320")
    goto_card(page, "idea")
    shot(page, "41b-idea-320")
    goto_card(page, "story")
    shot(page, "42-story-320")
    goto_card(page, "counter")
    shot(page, "43-counter-320")
    goto_card(page, "practice")
    shot(page, "45-practice-320")
    goto_card(page, "trait")
    shot(page, "44-trait-320")
    for lesson in LESSONS:
        page.evaluate(f"location.hash='#/l/{lesson}'")
        settle(page, 500)
        if goto_card(page, "lead"):
            page.wait_for_timeout(1200)
            shot(page, f"46-lead-320-{lesson}")
        goto_card(page, "cover")
        shot(page, f"47-cover-320-{lesson}")
    report["checks"]["deck_overflow_320"] = overflow_x(page)
    ctx.close()

    # desktop, 1280×800
    ctx, page = new_page(browser, 1280, 800)
    page.goto(BASE)
    settle(page, 800)
    shot(page, "50-desktop-home")
    page.evaluate(f"location.hash='#/l/{LESSONS[0]}'")
    settle(page, 700)
    goto_card(page, "idea")
    shot(page, "51-desktop-deck")
    ctx.close()

    # reduced motion
    ctx, page = new_page(browser, 390, 844, reduced=True)
    page.goto(BASE + f"#/l/{LESSONS[-1]}")
    settle(page, 700)
    page.keyboard.press("ArrowRight")
    page.wait_for_timeout(80)
    shot(page, "60-reduced-midfade")
    ctx.close()

    browser.close()

server.shutdown()
print(json.dumps(report, indent=1))
