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

The "v3b" shots (--section v3b runs only those) are the citizens pass: the seal
in the header (first run, both options; after two traits), the trait card's
stamp (no wallet; a mocked wallet with stamps configured: mint, the wallet
step, sent, rejected), the passport signed out and signed in (a mocked
identity whose picture fails to load), a public passport with two stamps (a
mocked Base RPC), the sign-in sheet with its QR code (a mocked relay), a
draft lesson's generated scene, and the favicon at 16/32 px in a mock tab
strip. Nothing leaves the machine: the relay, the RPC and the picture host
are answered here or refused.
"""
import argparse
import functools
import http.server
import json
import mimetypes
import os
import re
import subprocess
import sys
import threading
import time

from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument("--dist", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--assets", default="/tmp/capable-assets")
ap.add_argument("--only", default="")
ap.add_argument("--section", default="", help="run only this section (v3b)")
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


# ---- v3b: citizens -----------------------------------------------------------------

ART = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "art", "index.mjs")
# the header seal with the full ring, for the first-run comparison shot (the app ships the empty ring)
FULL_LOCKUP = subprocess.run(["node", "--input-type=module", "-e", f"import {{ seal }} from {json.dumps(ART)}; process.stdout.write(seal({{ mode: 'lockup', size: 44 }}));"], capture_output=True, text=True).stdout

ADDR_A = "0x5e5f0a6e2b4c1d3f9a8b7c6d5e4f3a2b1c0d9e8f"  # a mocked reader's verified address
ADDR_PUB = "0x7a11ce0000000000000000000000000000c0ffee"  # a public passport with two stamps
CONTRACT = "0x00000000000000000000000000000000ca9ab1e5"
SEL_TOKENS, SEL_STAMP = "0x5a3f2672", "0x527cbaf7"
OWNED = {ADDR_PUB.lower(): [(14, 0), (203, 2)], ADDR_A.lower(): [(57, 1)]}  # tokenId, stampId
IDENTITY = {"fid": 3, "username": "ada", "displayName": "Ada Lovelace", "pfpUrl": "https://pfp.example/ada.png", "source": "siwf", "verifications": [ADDR_A], "signedInAt": "2026-11-12T10:00:00Z"}
TWO_DONE = {"v": 2, "at": {}, "furthest": {}, "done": {}, "ticks": {}, "sound": False}

WALLET_JS = """
(() => {
  const w = window.__wallet = { calls: [], chain: '0x1', mode: 'ok', account: '%s', release: null };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  window.ethereum = { request: async ({ method }) => {
    w.calls.push(method);
    if (method === 'eth_chainId') return w.chain;
    if (method === 'wallet_switchEthereumChain') { await sleep(250); w.chain = '0x2105'; return null; }
    if (method === 'eth_accounts') return [];
    if (method === 'eth_requestAccounts') return [w.account];
    if (method === 'eth_sendTransaction') {
      if (w.mode === 'reject') { await sleep(200); const e = new Error('User rejected the request.'); e.code = 4001; throw e; }
      await new Promise((r) => (w.release = r));
      return '0x' + '7c'.repeat(32);
    }
    throw new Error('unsupported ' + method);
  } };
})();
""" % ADDR_A


def word(n):
    return format(n, "064x")


def rpc_reply(route):
    req = route.request
    if req.method == "OPTIONS":
        return route.fulfill(status=204, headers={"access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "POST"})
    body = json.loads(req.post_data or "{}")
    data = body["params"][0]["data"]
    if data.startswith(SEL_TOKENS):
        holder = "0x" + data[-40:]
        ids = [t for t, _ in OWNED.get(holder.lower(), [])]
        result = "0x" + word(32) + word(len(ids)) + "".join(word(t) for t in ids)
    else:
        tid = int(data[-64:], 16)
        sid = next((s for pairs in OWNED.values() for t, s in pairs if t == tid), 0)
        result = "0x" + word(sid)
    return route.fulfill(status=200, content_type="application/json", headers={"access-control-allow-origin": "*"}, body=json.dumps({"jsonrpc": "2.0", "id": body.get("id"), "result": result}))


def relay_reply(route):
    req = route.request
    cors = {"access-control-allow-origin": "*", "access-control-allow-headers": "content-type, authorization", "access-control-allow-methods": "GET, POST"}
    if req.method == "OPTIONS":
        return route.fulfill(status=204, headers=cors)
    if req.url.endswith("/v1/channel") and req.method == "POST":
        nonce = json.loads(req.post_data or "{}").get("nonce", "")
        return route.fulfill(status=201, content_type="application/json", headers=cors, body=json.dumps({"channelToken": "e3b0c442-98fc-1c14-9afb-f4c8996fb924", "url": "https://farcaster.xyz/~/siwf?channelToken=e3b0c442-98fc-1c14-9afb-f4c8996fb924", "nonce": nonce}))
    return route.fulfill(status=202, content_type="application/json", headers=cors, body=json.dumps({"state": "pending", "nonce": ""}))


def with_stamps(route):
    """index.html and app.json as if the owner had deployed: stamps.address set."""
    res = route.fetch()
    text = res.text().replace('"stamps":{"chainId":8453,"address":null}', '"stamps":{"chainId":8453,"address":"%s"}' % CONTRACT)
    route.fulfill(response=res, body=text)


def v3b_page(browser, w=390, h=844, storage=None, identity=None, wallet=False, stamps=False, rpc=True, reduced=False):
    ctx = browser.new_context(viewport={"width": w, "height": h}, device_scale_factor=2, is_mobile=w < 600, has_touch=w < 600, service_workers="block", reduced_motion="reduce" if reduced else "no-preference")
    ctx.route("**/*", route)
    ctx.route("https://pfp.example/**", lambda r: r.abort())
    if rpc:
        ctx.route("https://mainnet.base.org/**", rpc_reply)
        ctx.route("https://mainnet.base.org", rpc_reply)
    ctx.route("https://relay.farcaster.xyz/**", relay_reply)
    if stamps:
        ctx.route(re.compile(re.escape(BASE) + r"(\?.*)?(#.*)?$"), with_stamps)
        ctx.route(BASE + "app.json*", with_stamps)
    init = ""
    if storage:
        init += "try{localStorage.setItem('capable.progress@/', %s)}catch(e){}" % json.dumps(json.dumps(storage))
    if identity:
        init += "try{localStorage.setItem('capable.identity.v1', %s)}catch(e){}" % json.dumps(json.dumps(identity))
    if wallet:
        init += WALLET_JS
    if init:
        ctx.add_init_script(init)
    page = ctx.new_page()
    page.on("console", lambda m: report["console"].append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
    page.on("pageerror", lambda e: report["errors"].append(str(e)))
    return ctx, page


def trait_card(page, lesson):
    page.evaluate(f"location.hash='#/l/{lesson}'")
    settle(page, 700)
    goto_card(page, "trait")
    page.wait_for_timeout(900)


def v3b(browser):
    first, second = LESSONS[0], LESSONS[1]
    done2 = {**TWO_DONE, "done": {first: True, second: True}, "furthest": {first: 1, second: 1}}
    for w, h in ((390, 844), (320, 568)):
        tag = f"{w}x{h}"
        # 1. home, first run: the empty ring (the shipped choice), then the full ring for comparison
        ctx, page = v3b_page(browser, w, h)
        page.goto(BASE)
        settle(page, 900)
        shot(page, f"v3b-01-home-firstrun-empty-{tag}")
        report["checks"][f"v3b_logo_filled_firstrun_{tag}"] = page.evaluate("document.querySelector('.home__logo').dataset.filled")
        if FULL_LOCKUP:
            page.evaluate("(s) => { const l = document.querySelector('.home__logo'); l.innerHTML = s; l.firstElementChild.setAttribute('class', 'lockup'); }", FULL_LOCKUP)
            page.wait_for_timeout(100)
            shot(page, f"v3b-01b-home-firstrun-full-{tag}")
        ctx.close()
        # 2. home after two traits: the ring fills cyan and magenta
        ctx, page = v3b_page(browser, w, h, storage=done2)
        page.goto(BASE)
        settle(page, 900)
        shot(page, f"v3b-02-home-two-traits-{tag}")
        report["checks"][f"v3b_logo_filled_two_{tag}"] = page.evaluate("document.querySelector('.home__logo').dataset.filled")
        ctx.close()
        # 3. the trait card, no wallet, stamps not deployed: saved to your passport
        ctx, page = v3b_page(browser, w, h)
        page.goto(BASE)
        settle(page, 600)
        trait_card(page, first)
        shot(page, f"v3b-03-trait-stamp-nowallet-{tag}")
        report["checks"][f"v3b_trait_act_{tag}"] = page.evaluate("document.querySelector('.card.is-active [data-stamp-act]').innerText")
        ctx.close()
    # the stamp mid-press (the thud), for the record
    ctx, page = v3b_page(browser)
    page.goto(BASE + f"#/l/{LESSONS[2]}")
    settle(page, 700)
    goto_card(page, "deeper")
    page.keyboard.press("ArrowLeft")
    page.wait_for_timeout(140)
    shot(page, "v3b-03b-trait-stamp-pressing-390x844")
    page.wait_for_timeout(900)
    shot(page, "v3b-03c-trait-stamp-pressed-enduring-390x844")
    ctx.close()

    # 4-5. a wallet and a deployed contract: mint → switch → confirm → sent; and rejected
    ctx, page = v3b_page(browser, wallet=True, stamps=True)
    page.goto(BASE)
    settle(page, 600)
    trait_card(page, first)
    page.wait_for_timeout(600)
    shot(page, "v3b-04-trait-mint-button-390x844")
    report["checks"]["v3b_mint_button"] = page.evaluate("!!document.querySelector('.card.is-active [data-mint]')")
    page.click(".card.is-active [data-mint]")
    page.wait_for_timeout(120)
    shot(page, "v3b-05a-mint-switching-390x844")
    page.wait_for_timeout(700)
    shot(page, "v3b-05b-mint-confirm-in-wallet-390x844")
    report["checks"]["v3b_mint_calls"] = page.evaluate("window.__wallet.calls")
    page.evaluate("window.__wallet.release()")
    page.wait_for_timeout(500)
    shot(page, "v3b-05c-mint-sent-390x844")
    report["checks"]["v3b_mint_sent_link"] = page.evaluate("document.querySelector('.card.is-active .trait__link')?.href")
    ctx.close()
    ctx, page = v3b_page(browser, wallet=True, stamps=True)
    page.goto(BASE)
    settle(page, 600)
    trait_card(page, second)
    page.wait_for_timeout(600)
    page.evaluate("window.__wallet.mode = 'reject'")
    page.click(".card.is-active [data-mint]")
    page.wait_for_timeout(1200)
    shot(page, "v3b-05d-mint-rejected-390x844")
    ctx.close()
    ctx, page = v3b_page(browser, 320, 568, wallet=True, stamps=True)
    page.goto(BASE)
    settle(page, 600)
    trait_card(page, LESSONS[3])
    page.wait_for_timeout(600)
    shot(page, "v3b-04b-trait-mint-button-320x568")
    report["checks"]["v3b_mint_320_fit"] = page.evaluate("(()=>{const b=document.querySelector('.card.is-active .card__body');return {scrolls:b.scrollHeight>b.clientHeight+1, fit:document.querySelector('.card.is-active').dataset.fit||''}})()")
    ctx.close()

    # 6. passport, signed out
    for w, h in ((390, 844), (320, 568)):
        tag = f"{w}x{h}"
        ctx, page = v3b_page(browser, w, h, storage=done2)
        page.goto(BASE + "#/passport")
        settle(page, 900)
        shot(page, f"v3b-06-passport-signedout-{tag}")
        page.evaluate("scrollTo(0, document.documentElement.scrollHeight)")
        page.wait_for_timeout(200)
        shot(page, f"v3b-06b-passport-signedout-bottom-{tag}")
        ctx.close()
    # 7. passport, signed in (mocked identity; the picture fails, so the portrait shows), one stamp on chain
    ctx, page = v3b_page(browser, storage=done2, identity=IDENTITY, stamps=True)
    page.goto(BASE + "#/passport")
    settle(page, 1200)
    shot(page, "v3b-07-passport-signedin-390x844")
    report["checks"]["v3b_passport_pfp_removed"] = page.evaluate("!document.querySelector('.pp img')")
    page.evaluate("scrollTo(0, document.documentElement.scrollHeight)")
    page.wait_for_timeout(200)
    shot(page, "v3b-07b-passport-signedin-bottom-390x844")
    page.goto(BASE + "#/")
    settle(page, 800)
    shot(page, "v3b-07c-home-signedin-chip-390x844")
    ctx.close()
    # 8. a public passport with two stamps (mocked Base RPC), and with the RPC down
    ctx, page = v3b_page(browser, stamps=True)
    page.goto(BASE + f"#/p/{ADDR_PUB}")
    settle(page, 1200)
    shot(page, "v3b-08-public-passport-two-stamps-390x844")
    report["checks"]["v3b_public_status"] = page.evaluate("document.querySelector('.passport').dataset.status")
    page.evaluate("scrollTo(0, document.documentElement.scrollHeight)")
    page.wait_for_timeout(200)
    shot(page, "v3b-08b-public-passport-bottom-390x844")
    ctx.close()
    ctx, page = v3b_page(browser, stamps=True, rpc=False)
    ctx.route("https://mainnet.base.org/**", lambda r: r.abort())
    ctx.route("https://mainnet.base.org", lambda r: r.abort())
    page.goto(BASE + f"#/p/{ADDR_PUB}")
    settle(page, 1500)
    shot(page, "v3b-08c-public-passport-rpc-down-390x844")
    ctx.close()
    ctx, page = v3b_page(browser)
    page.goto(BASE + f"#/p/{ADDR_PUB}")
    settle(page, 900)
    shot(page, "v3b-08d-public-passport-not-deployed-390x844")
    ctx.close()
    # 9. the sign-in sheet with its QR code (mocked relay: the channel stays pending)
    for w, h in ((390, 844), (320, 568)):
        tag = f"{w}x{h}"
        ctx, page = v3b_page(browser, w, h, storage=done2)
        page.goto(BASE + "#/passport")
        settle(page, 800)
        page.click("[data-signin]")
        page.wait_for_selector(".signin[data-phase='code']", timeout=15000)
        page.wait_for_timeout(400)
        shot(page, f"v3b-09-signin-sheet-qr-{tag}")
        report["checks"][f"v3b_signin_phase_{tag}"] = page.evaluate("document.querySelector('.signin').dataset.phase")
        page.click("[data-signin-cancel]")
        page.wait_for_timeout(200)
        report["checks"][f"v3b_signin_closed_{tag}"] = page.evaluate("!document.querySelector('.signin')")
        ctx.close()
    # 10. a draft lesson's cover: no hand-drawn scene, so the art grammar draws one
    drafts = [l["id"] for l in APP["lessons"] if l.get("status") == "draft"]
    if drafts:
        ctx, page = v3b_page(browser)
        page.goto(BASE + f"#/l/{drafts[0]}")
        settle(page, 900)
        shot(page, "v3b-10-draft-cover-generated-scene-390x844")
        page.goto(BASE)
        settle(page, 700)
        page.evaluate(f"document.querySelector('.tile[data-lesson=\"{drafts[0]}\"]').scrollIntoView({{block:'center'}})")
        page.wait_for_timeout(300)
        shot(page, "v3b-10b-draft-tile-generated-scene-390x844")
        ctx.close()
    # 11. the favicon at 16 and 32 px in a mock tab strip (1x and 2x)
    icons = {k: v for k, v in ((f.split(".")[0], f) for f in os.listdir(args.dist) if re.match(r"^favicon(-16|-32)?\.[0-9a-f]{10}\.(png|svg)$", f))}
    tabs = "".join(
        f'<div class="tab{" on" if i == 0 else ""}"><img src="{BASE}{icons[k]}" width="16" height="16"><span>{t}</span><b>×</b></div>'
        for i, (k, t) in enumerate((("favicon", "capable"), ("favicon-16", "capable · 16 px png"), ("favicon-32", "Own Your Exit · capable")))
    )
    html = f"""<html><body style="margin:0;background:#dee1e6;font:12px system-ui">
<div style="display:flex;gap:2px;padding:8px 8px 0">{tabs}<div class="tab ghost"><span>other site</span></div></div>
<div style="background:#fff;height:44px;border-top:1px solid #c4c7cc"></div>
<div style="display:flex;gap:24px;align-items:end;padding:18px;background:#fff">
<img src="{BASE}{icons['favicon-16']}" width="16" height="16"><img src="{BASE}{icons['favicon-32']}" width="32" height="32"><img src="{BASE}{icons['favicon']}" width="16" height="16"><img src="{BASE}{icons['favicon']}" width="32" height="32"><img src="{BASE}{icons['favicon']}" width="64" height="64">
<span style="color:#555">16 png · 32 png · svg at 16 / 32 / 64</span></div>
<style>.tab{{display:flex;align-items:center;gap:8px;width:200px;height:34px;padding:0 10px;background:#cfd2d7;border-radius:8px 8px 0 0;color:#333}}.tab.on{{background:#fff}}.tab span{{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}}.tab b{{font-weight:400;color:#666}}.ghost{{width:120px}}</style></body></html>"""
    for dsf in (1, 2):
        ctx = browser.new_context(viewport={"width": 760, "height": 200}, device_scale_factor=dsf)
        page = ctx.new_page()
        page.set_content(html)
        page.wait_for_timeout(400)
        shot(page, f"v3b-11-favicon-tabs-{dsf}x")
        ctx.close()


V3B_ONLY = args.section == "v3b"

with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--autoplay-policy=no-user-gesture-required"])
    v3b(browser)
    if V3B_ONLY:
        browser.close()
        server.shutdown()
        print(json.dumps(report, indent=1))
        sys.exit(0)

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
