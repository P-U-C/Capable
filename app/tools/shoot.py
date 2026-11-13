"""Dev tool: screenshot a built dist/ in headless Chrome.

  python3 -I tools/shoot.py --dist dist --out /tmp/shots [--assets /tmp/capable-assets]

Fonts and hls.js are served from dist itself now (self-hosted). The sandbox
cannot reach the video hosts, so every .m3u8/.ts request is answered from a
local test stream made with ffmpeg in <assets>/stream:

  ffmpeg -f lavfi -i testsrc2=size=360x640:rate=25 -f lavfi -i sine=frequency=440 -t 12 \\
    -c:v libx264 -pix_fmt yuv420p -c:a aac -hls_time 4 -hls_playlist_type vod \\
    -hls_segment_filename 'seg%d.ts' test.m3u8

Chrome is told it cannot play HLS natively, so the lazy hls.js chunk is used.
The "v3a" shots (--only v3a) are the review pass: first run, home after one
lesson, a deck mid-way, the hand-off, a video card, and zoomed long cards.
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
ap.add_argument("--assets", default="/tmp/capable-assets")
ap.add_argument("--only", default="")
args = ap.parse_args()
os.makedirs(args.out, exist_ok=True)

mimetypes.add_type("application/manifest+json", ".webmanifest")
mimetypes.add_type("font/woff2", ".woff2")
mimetypes.add_type("text/javascript", ".js")


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=os.path.abspath(args.dist)))
threading.Thread(target=server.serve_forever, daemon=True).start()
BASE = f"http://127.0.0.1:{server.server_address[1]}/"
STREAM = os.path.join(args.assets, "stream")
OFFSITE = []


def route(r):
    url = r.request.url
    if url.endswith(".m3u8"):
        with open(os.path.join(STREAM, "test.m3u8"), "rb") as f:
            return r.fulfill(status=200, content_type="application/vnd.apple.mpegurl", body=f.read(), headers={"access-control-allow-origin": "*"})
    m = re.search(r"/(seg\d+\.ts)$", url)
    if m:
        with open(os.path.join(STREAM, m.group(1)), "rb") as f:
            return r.fulfill(status=200, content_type="video/mp2t", body=f.read(), headers={"access-control-allow-origin": "*"})
    if url.startswith(BASE):
        return r.continue_()
    OFFSITE.append(url)
    return r.abort()


report = {"console": [], "errors": [], "shots": [], "checks": {}, "fit": {}, "offsite": OFFSITE}

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


    # ---- v3a: the review pass ------------------------------------------------
    LEAD_TYPE = "lead"
    first_lesson = LESSONS[0]
    one_done = {"v": 2, "at": {first_lesson: "next"}, "furthest": {first_lesson: 1}, "done": {first_lesson: True}, "ticks": {}, "sound": False}
    for w, h in ((390, 844), (320, 568)):
        tag = f"{w}x{h}"
        ctx, page = new_page(browser, w, h)
        page.goto(BASE)
        settle(page, 900)
        shot(page, f"v3a-01-home-firstrun-{tag}")
        report["checks"][f"v3a_cta_box_{tag}"] = page.evaluate("(()=>{const r=document.querySelector('.intro__cta').getBoundingClientRect();return [Math.round(r.top),Math.round(r.bottom),innerHeight]})()")
        ctx.close()
        ctx, page = new_page(browser, w, h, storage=one_done)
        page.goto(BASE)
        settle(page, 900)
        shot(page, f"v3a-02-home-after-lesson1-{tag}")
        page.evaluate("document.querySelector('.tiles').scrollIntoView({block:'start'})")
        settle(page, 300)
        shot(page, f"v3a-02b-home-tiles-after-lesson1-{tag}")
        ctx.close()
        ctx, page = new_page(browser, w, h)
        page.goto(BASE + f"#/l/{first_lesson}")
        settle(page, 800)
        n = page.evaluate("document.querySelectorAll('.deck .card').length")
        for _ in range(n // 2):
            page.keyboard.press("ArrowRight")
            page.wait_for_timeout(60)
        page.wait_for_timeout(450)
        shot(page, f"v3a-03-deck-midway-{tag}")
        goto_card(page, "practice")
        page.click(".card.is-active .step >> nth=0")
        page.wait_for_timeout(200)
        shot(page, f"v3a-03b-practice-ticked-{tag}")
        goto_card(page, "next")
        shot(page, f"v3a-04-handoff-{tag}")
        report["checks"][f"v3a_handoff_href_{tag}"] = page.evaluate("document.querySelector('.card.is-active a.btn--primary')?.getAttribute('href')")
        ctx.close()
        ctx, page = new_page(browser, w, h)
        page.goto(BASE + f"#/l/{LEAD_LESSON}")
        settle(page, 800)
        if goto_card(page, "lead"):
            page.wait_for_timeout(2500)
            shot(page, f"v3a-05-video-{tag}")
            report["checks"][f"v3a_video_{tag}"] = page.evaluate("(()=>{const v=document.querySelector('.card.is-active video');return v?{paused:v.paused,muted:v.muted,t:+v.currentTime.toFixed(1),bar:getComputedStyle(document.querySelector('.card.is-active .vframe__bar')).display}:null})()")
            page.keyboard.press("k")
            page.wait_for_timeout(400)
            report["checks"][f"v3a_video_after_k_{tag}"] = page.evaluate("document.querySelector('.card.is-active video')?.paused")
            shot(page, f"v3a-05b-video-paused-{tag}")
        ctx.close()
    # last lesson with three unread: the hand-off must not say all caught up
    ctx, page = new_page(browser, 390, 844)
    page.goto(BASE + f"#/l/{LESSONS[-1]}")
    settle(page, 800)
    goto_card(page, "next")
    shot(page, "v3a-04b-handoff-last-lesson-unread-390x844")
    report["checks"]["v3a_last_handoff_text"] = page.evaluate("document.querySelector('.card.is-active').innerText.replace(/\\s+/g,' ').slice(0,160)")
    ctx.close()
    # 200% zoom: a phone (390x844 at 200% = 195x422 CSS px) and a desktop (1280x800 at 200% = 640x400)
    for (w, h, dsf, name) in ((195, 422, 4, "phone200"), (640, 400, 2, "desktop200"), (844, 390, 2, "landscape")):
        ctx = browser.new_context(viewport={"width": w, "height": h}, device_scale_factor=dsf, is_mobile=name != "desktop200", has_touch=name != "desktop200", service_workers="block")
        ctx.route("**/*", route)
        page = ctx.new_page()
        page.on("pageerror", lambda e: report["errors"].append(str(e)))
        page.goto(BASE + f"#/l/{first_lesson}")
        settle(page, 800)
        goto_card(page, "counter")
        page.evaluate("scrollTo(0,0)")
        page.wait_for_timeout(200)
        shot(page, f"v3a-06-zoom-{name}-counter")
        page.evaluate("scrollTo(0, document.documentElement.scrollHeight)")
        page.wait_for_timeout(200)
        shot(page, f"v3a-06b-zoom-{name}-counter-scrolled")
        report["checks"][f"v3a_zoom_{name}"] = page.evaluate("""(()=>{const c=document.querySelector('.card.is-active');const b=c.querySelector('.card__body');
          return {cardH:Math.round(c.getBoundingClientRect().height), bodyScrolls:b.scrollHeight>b.clientHeight+2, pageH:document.documentElement.scrollHeight, segsOverflow:document.querySelector('.segs').scrollWidth-document.querySelector('.segs').clientWidth, overflowX: document.documentElement.scrollWidth-innerWidth}})()""")
        goto_card(page, "practice")
        page.evaluate("scrollTo(0,0)")
        page.wait_for_timeout(200)
        shot(page, f"v3a-06c-zoom-{name}-practice")
        ctx.close()
    # a long card that still scrolls inside a phone (320x568): the cue sits in its own strip
    ctx, page = new_page(browser, 320, 568)
    page.goto(BASE + f"#/l/{first_lesson}")
    settle(page, 800)
    for kind in ("counter", "practice", "story"):
        goto_card(page, kind)
        shot(page, f"v3a-07-320-{kind}")
        report["checks"][f"v3a_cue_{kind}"] = page.evaluate("""(()=>{const c=document.querySelector('.card.is-active');const cue=c.querySelector('.card__more');const b=c.querySelector('.card__body');
          const cr=cue.getBoundingClientRect(), br=b.getBoundingClientRect();return {scrolls:c.hasAttribute('data-scrolls'), cueTop:Math.round(cr.top), bodyBottom:Math.round(br.bottom), cueShown:getComputedStyle(cue).display}})()""")
    ctx.close()

    browser.close()

server.shutdown()
print(json.dumps(report, indent=1))
