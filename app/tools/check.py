"""Dev tool: behaviour checks in headless Chrome against a built dist/.
  python3 -I tools/check.py --dist dist
Prints one line per check and exits non-zero on failure."""
import argparse, functools, http.server, json, os, sys, threading
from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser(); ap.add_argument("--dist", required=True); args = ap.parse_args()
dist = os.path.abspath(args.dist)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Q, directory=dist))
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = f"http://127.0.0.1:{srv.server_address[1]}/"
fails = 0
def check(name, ok, detail=""):
    global fails
    fails += 0 if ok else 1
    print(("PASS " if ok else "FAIL ") + name + (f" — {detail}" if detail else ""))

with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path="/usr/bin/google-chrome")
    ctx = b.new_context(viewport={"width": 390, "height": 844}, has_touch=True, service_workers="block")
    ctx.route("**/*", lambda r: r.continue_() if r.request.url.startswith(BASE) else r.abort())
    page = ctx.new_page()
    csp = []
    page.on("console", lambda m: csp.append(m.text) if "Content Security Policy" in m.text or "Refused" in m.text else None)
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(BASE + "#/l/what-lasts"); page.wait_for_timeout(600)
    active = lambda: page.evaluate("+document.querySelector('.card.is-active').dataset.i")
    for _ in range(3): page.keyboard.press("ArrowRight"); page.wait_for_timeout(120)
    check("arrow keys advance", active() == 3, str(active()))
    check("focus follows the card", page.evaluate("document.activeElement === document.querySelector('.card.is-active')"))
    check("live region announces", page.evaluate("document.querySelector('[data-announce]').textContent").startswith("Card 4 of"))
    check("inactive cards are inert", page.evaluate("[...document.querySelectorAll('.card:not(.is-active)')].every(c => c.inert && c.getAttribute('aria-hidden') === 'true')"))
    page.keyboard.press("Shift+Space"); page.wait_for_timeout(120)
    check("shift+space goes back", active() == 2)
    page.reload(); page.wait_for_timeout(600)
    check("position remembered across reloads", active() == 2, str(active()))
    box = page.evaluate("(()=>{const r=document.querySelector('.deck__stage').getBoundingClientRect();return [r.x,r.y,r.width,r.height]})()")
    page.mouse.click(box[0] + box[2] * 0.9, box[1] + box[3] * 0.5); page.wait_for_timeout(400)
    check("tap on the right third goes forward", active() == 3, str(active()))
    page.mouse.click(box[0] + box[2] * 0.1, box[1] + box[3] * 0.5); page.wait_for_timeout(400)
    check("tap on the left third goes back", active() == 2, str(active()))
    # swipe with the mouse (pointer events)
    x0, y0 = box[0] + box[2] * 0.8, box[1] + box[3] * 0.5
    page.mouse.move(x0, y0); page.mouse.down()
    for k in range(1, 10): page.mouse.move(x0 - k * 22, y0); page.wait_for_timeout(10)
    page.mouse.up(); page.wait_for_timeout(450)
    check("swipe left goes forward", active() == 3, str(active()))
    page.mouse.move(x0, y0); page.mouse.down()
    for k in range(1, 6): page.mouse.move(x0 - k * 6, y0); page.wait_for_timeout(60)
    page.wait_for_timeout(120); page.mouse.up(); page.wait_for_timeout(450)
    check("a short, slow drag springs back", active() == 3, str(active()))
    # practice ticks persist
    i = page.evaluate("+[...document.querySelectorAll('.card')].find(c => c.dataset.type === 'practice').dataset.i")
    page.evaluate(f"document.querySelector('[data-nav=next]')")
    while active() < i: page.keyboard.press("ArrowRight"); page.wait_for_timeout(80)
    page.wait_for_timeout(400)
    page.click(".card.is-active .step >> nth=1"); page.wait_for_timeout(100)
    check("a practice step ticks", page.get_attribute(".card.is-active .step >> nth=1", "aria-pressed") == "true")
    page.reload(); page.wait_for_timeout(600)
    check("ticks are remembered", page.get_attribute(".card.is-active .step >> nth=1", "aria-pressed") == "true")
    # finish: trait card marks the lesson done
    while page.evaluate("document.querySelector('.card.is-active').dataset.type") != "trait": page.keyboard.press("ArrowRight"); page.wait_for_timeout(80)
    page.wait_for_timeout(300)
    page.keyboard.press("Escape"); page.wait_for_timeout(500)
    check("Esc closes the deck", page.evaluate("location.hash") == "#/" and page.evaluate("!!document.querySelector('.home')"))
    check("home shows the lesson as done", "read again" in page.inner_text('a[href="#/l/what-lasts"]').lower())
    check("returning focuses the lesson's tile", page.evaluate("document.activeElement?.dataset?.lesson") == "what-lasts")
    check("the trait fills in the you panel", "1 of 1" in page.inner_text(".tchip[data-full=true]"))
    # no horizontal page scroll on home or in a deck
    check("no horizontal scroll", page.evaluate("document.documentElement.scrollWidth <= innerWidth"))
    # live update: a newer app.json re-renders home
    data = json.load(open(os.path.join(dist, "app.json")))
    data["generatedAt"] = "2099-01-01T00:00:00Z"
    data["lessons"][0]["promise"] = "Freshly updated promise for the check."
    ctx.route(BASE + "app.json", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(data)))
    page.reload(); page.wait_for_timeout(900)
    check("a newer app.json re-renders home", "Freshly updated promise" in page.inner_text(".home"))
    bad = dict(data); bad["lessons"] = [dict(data["lessons"][0], promise="Win the prize now.")] + data["lessons"][1:]
    ctx.unroute(BASE + "app.json")
    ctx.route(BASE + "app.json", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(bad)))
    page.reload(); page.wait_for_timeout(900)
    check("an invalid app.json is ignored", "Win the prize" not in page.inner_text(".home"))
    check("no CSP violations", not csp, "; ".join(csp[:3]))
    check("no page errors", not errors, "; ".join(errors[:3]))
    # offline: the service worker serves the shell and app.json
    octx = b.new_context(viewport={"width": 390, "height": 844})
    op = octx.new_page()
    op.goto(BASE); op.wait_for_timeout(300)
    op.evaluate("navigator.serviceWorker.ready.then(() => true)")
    op.reload(); op.wait_for_timeout(500)
    keys = op.evaluate("caches.keys().then(async ks => Promise.all(ks.map(async k => (await (await caches.open(k)).keys()).map(r => new URL(r.url).pathname))))")
    flat = [p for ks in keys for p in ks]
    check("service worker precached the shell and app.json", "/app.json" in flat and "/index.html" in flat and any(p.endswith(".js") for p in flat), ", ".join(sorted(flat)))
    octx.set_offline(True)
    op.reload(); op.wait_for_timeout(700)
    check("works offline", op.evaluate("!!document.querySelector('.home .tile')"))
    op.evaluate("location.hash = '#/l/what-lasts'"); op.wait_for_timeout(500)
    check("lessons open offline", op.evaluate("!!document.querySelector('.deck .card.is-active')"))
    b.close()
srv.shutdown()
sys.exit(1 if fails else 0)
