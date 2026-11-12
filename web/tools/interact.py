#!/usr/bin/env python3
"""Local interaction check of web/dist/index.html in headless Chrome.

  python3 web/tools/interact.py [--file web/dist/index.html]

Drives the real page: Begin, depth keys, arrow keys, citation popover, path
switch, strand filter, mark as read, read-on-scroll, a fake artifact overlay,
and a sandbox where localStorage throws. Prints PASS/FAIL per check.
"""
import argparse, json, pathlib, sys
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[1]
ap = argparse.ArgumentParser()
ap.add_argument("--file", default=str(ROOT / "dist" / "index.html"))
a = ap.parse_args()
URL = pathlib.Path(a.file).resolve().as_uri()
results = []

def check(name, ok, detail=""):
    results.append(ok)
    print(("PASS " if ok else "FAIL ") + name + (f" — {detail}" if detail and not ok else ""))

FAKE_OVERLAY = """
(() => {
  const H = (n) => '0x' + n.toString(16).padStart(40, '0');
  const sub = { hash: H(0xabc001), fid: 4242, postedAt: '2026-11-12T18:00:00Z', chapter: 'what-lasts', kind: 'video',
    gloss: 'A late entry on the communes.', embeds: ['https://stream.farcaster.xyz/v1/video/z.m3u8'], url: 'https://farcaster.xyz/~/conversations/' + H(0xabc001) };
  const bad = { ...sub, hash: 'nope' };
  const draft = { id: 'fresh-pick', number: 8, kind: 'chapter', status: 'draft', title: 'A Fresh Pick', kicker: 'New pick · just dropped',
    line: 'Something new just dropped.', minute: 'Words.', essay: [{ type: 'p', text: 'Draft.' }], objections: [], terms: [],
    thread: 'This pick just dropped.', strands: [], connections: [] };
  const col = { submissions: [[sub.hash, sub], ['nope', bad]], chapters: [['fresh-pick', draft]], people: [['4242', { fid: 4242, username: 'latecomer' }]] };
  const db = {
    collection: (n) => ({ get: async () => ({ docs: (col[n] || []).map(([id, v]) => ({ id, exists: true, data: () => v })) }) }),
    doc: () => ({ get: async () => ({ exists: true, data: () => ({ refreshedAt: '2026-11-12T18:30:00Z' }) }) }),
  };
  window.__overlayAsked = 0;
  window.claude = { use: (name) => { window.__overlayAsked++; return new Promise((r) => setTimeout(() => r(name === 'db' ? db : null), 400)); } };
})();
"""

with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    ctx = b.new_context(viewport={"width": 390, "height": 844})
    ctx.route("**/*", lambda r: r.continue_() if r.request.url.startswith("file:") else r.abort())
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" and "ERR_FAILED" not in m.text else None)
    page.goto(URL)
    page.wait_for_selector(".cover")
    check("cover renders", page.locator("h1.cover-title").count() == 1)
    check("footer notice", "unofficial · reads public farcaster data" in page.inner_text("footer").lower())

    first = page.get_attribute("a.btn--primary", "href")
    page.click("a.btn--primary")
    page.wait_for_selector("article.idea")
    check("Begin opens the first idea on the path", page.get_attribute("article.idea", "data-id") == first.lstrip("#"), first)
    check("title follows the idea", page.title().endswith("· Primer"), page.title())

    page.keyboard.press("3")
    page.wait_for_timeout(400)
    check("key 3 sets Essay depth", page.get_attribute("article.idea", "data-depth") == "3")
    check("essay visible at depth 3", page.locator("#s-essay").is_visible())
    check("voices hidden at depth 3", not page.locator("#s-voices").is_visible())
    page.keyboard.press("5")
    page.wait_for_timeout(400)
    check("key 5 shows voices", page.locator("#s-voices").is_visible())
    stored = json.loads(page.evaluate("localStorage.getItem('primer:v1')"))
    check("depth remembered", stored["depth"] == 5, stored)

    cur = page.get_attribute("article.idea", "data-id")
    page.keyboard.press("ArrowRight")
    page.wait_for_timeout(200)
    nxt = page.get_attribute("article.idea", "data-id")
    check("→ moves to the next idea", nxt != cur, f"{cur} -> {nxt}")
    check("depth carried across ideas", page.get_attribute("article.idea", "data-depth") == "5")
    page.keyboard.press("ArrowLeft")
    page.wait_for_timeout(200)
    check("← moves back", page.get_attribute("article.idea", "data-id") == cur)

    # citation popover
    page.goto(URL + "#exit-essay")
    page.wait_for_selector("article.idea")
    chip = page.locator("#s-essay button.chip").first
    if chip.count():
        chip.click()
        page.wait_for_timeout(100)
        check("chip opens the voice popover", page.locator("#pop").is_visible() and page.locator("#pop .voice").count() == 1)
        page.keyboard.press("Escape")
        check("Escape closes the popover", not page.locator("#pop").is_visible())
        check("focus returns to the chip", page.evaluate("document.activeElement.classList.contains('chip')"))
    else:
        check("fixture has a chip in the essay", False)

    # deep link depth override does not overwrite the stored depth
    page.evaluate("localStorage.setItem('primer:v1', JSON.stringify({reads: [], depth: 1, path: 'editors-path', last: null}))")
    page.goto(URL + "#exit-voices")
    page.reload()
    page.wait_for_selector("article.idea")
    check("#id-voices opens at voices depth", page.get_attribute("article.idea", "data-depth") == "5")
    check("deep link leaves the stored depth alone", json.loads(page.evaluate("localStorage.getItem('primer:v1')"))["depth"] == 1)

    # mark as read, then read-on-scroll
    page.click("button[data-act='read']")
    page.wait_for_timeout(100)
    check("Mark as read toggles", page.locator("button[data-act='unread']").count() == 1)
    check("read stored", "exit" in json.loads(page.evaluate("localStorage.getItem('primer:v1')"))["reads"])
    page.goto(URL + "#friend-speech")
    page.wait_for_selector("article.idea[data-id='friend-speech']")
    page.evaluate("document.getElementById('s-end').scrollIntoView()")
    page.wait_for_timeout(1700)
    check("scrolling to the end pieces marks the idea read", "friend-speech" in json.loads(page.evaluate("localStorage.getItem('primer:v1')"))["reads"])

    # cover: path switch and strand filter
    page.goto(URL + "#cover")
    page.wait_for_selector(".index")
    order = lambda: page.eval_on_selector_all(".index .row-title", "els => els.map(e => e.getAttribute('href'))")
    before = order()
    page.click("button[data-path='published']")
    after = order()
    check("path switch reorders the index", before != after and sorted(before) == sorted(after))
    page.click(".map .band-btn[data-strand='trust']")
    page.wait_for_timeout(300)
    rows = order()
    check("choosing a band filters the index", 0 < len(rows) < len(before), rows)
    page.click(".chips button[data-strand='']")
    check("All strands restores the index", len(order()) == len(before))
    check("cover shows read progress", "read across" in page.inner_text(".fig-stats").lower())

    # 320px: no horizontal page scroll on any view
    page.set_viewport_size({"width": 320, "height": 640})
    for r in ["cover", "exit", "exit-voices", "glossary", "credits", "about"]:
        page.goto(URL + "#" + r)
        page.wait_for_timeout(150)
        ov = page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
        check(f"no horizontal scroll at 320px on #{r}", ov <= 0, ov)
    check("no page errors", not errors, errors)
    ctx.close()

    # the artifact overlay
    ctx = b.new_context(viewport={"width": 390, "height": 844})
    ctx.route("**/*", lambda r: r.continue_() if r.request.url.startswith("file:") else r.abort())
    ctx.add_init_script(FAKE_OVERLAY)
    page = ctx.new_page()
    page.goto(URL + "#cover")
    page.wait_for_selector(".cover")
    page.evaluate("window.scrollTo(0, 600)")
    snap = page.inner_text("footer")
    check("snapshot renders before the overlay arrives", "new since snapshot" not in snap.lower())
    page.wait_for_function("document.querySelector('footer').textContent.includes('new since snapshot')", timeout=5000)
    foot = page.text_content("footer")
    check("overlay applied: footer counts new items", "2 new since snapshot" in foot, foot)
    check("overlay refresh time shown", "12 Nov, 18:30 UTC" in foot, foot)
    check("overlay keeps the scroll position", abs(page.evaluate("window.scrollY") - 600) < 5)
    check("new draft appears unplaced", page.locator(".group--unplaced a[href='#fresh-pick']").count() == 1)
    check("db asked once", page.evaluate("window.__overlayAsked") == 1)
    page.goto(URL + "#what-lasts-voices")
    page.wait_for_selector("article.idea")
    page.wait_for_function("document.body.innerText.includes('latecomer')", timeout=5000)
    check("new voice rendered with its person", page.locator("text=@latecomer").count() >= 1)
    page.goto(URL + "#about")
    page.wait_for_function("document.body.innerText.includes('left out')", timeout=5000)
    check("invalid overlay doc counted on About", "1 left out" in page.inner_text("main"))
    ctx.close()

    # storage that throws (sandboxed or private mode)
    ctx = b.new_context(viewport={"width": 390, "height": 844})
    ctx.route("**/*", lambda r: r.continue_() if r.request.url.startswith("file:") else r.abort())
    ctx.add_init_script("Object.defineProperty(window, 'localStorage', { get() { throw new Error('denied'); } });")
    page = ctx.new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto(URL + "#exit")
    page.wait_for_selector("article.idea")
    page.keyboard.press("4")
    page.click("button[data-act='read']")
    check("works when localStorage throws", not errs and page.locator("button[data-act='unread']").count() == 1, errs)
    ctx.close()
    b.close()

print(f"{sum(results)}/{len(results)} checks passed")
sys.exit(0 if all(results) else 1)
