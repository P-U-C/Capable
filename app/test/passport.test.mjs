// P1 (docs/READINESS-V3.md): the passport (#/passport) and the public
// passport (#/p/<address>), the "you" chip that opens it, the sign-in sheet,
// share and sign-out, and the Mini App boot path, driven through the fake DOM
// with mocked identity and stamps modules (no network, no SDK).
import test from "node:test";
import assert from "node:assert/strict";
import { fakeWindow, memStorage, settle, press, FakeEvent, canon } from "./dom.mjs";
import { fixture, visibleText, tags, attr } from "./helpers.mjs";
import { boot } from "../src/shell.mjs";
import { parseRoute } from "../src/router.mjs";
import { COPY } from "../src/copy.mjs";
import { renderHome } from "../src/home.mjs";
import { emptyState, recordVisit } from "../src/store.mjs";
import { brandLockup, portraitArt, stampTraitOf, stampMarkup } from "../src/art.mjs";
import { svgMarkup } from "../src/html.mjs";
import { preview } from "../src/stamps/index.mjs";
import { qrSvg } from "../src/identity/index.mjs";
import { citizenKey, placeholderHolder } from "../src/citizen.mjs";

const ADDR = "0x5E5f0a6E2b4c1d3F9a8B7c6D5e4F3a2B1c0D9e8F";
const PUB = "0x7a11ce0000000000000000000000000000c0ffee";
const CONTRACT = "0x00000000000000000000000000000000ca9ab1e5";
const ADA = Object.freeze({ fid: 3, username: "ada", displayName: "Ada Lovelace", pfpUrl: "https://pfp.example/ada.png", source: "siwf", verifications: [ADDR], signedInAt: "2026-11-12T10:00:00Z" });

/** The App with v3 trait fields (colours, emblems, stamp ids) and, optionally, a deployed contract. */
function appWith({ deployed = false } = {}) {
  const a = fixture();
  const meta = { sovereign: ["#18C8F0", 0], civil: ["#FF1FC8", 1], mobile: ["#5CF27E", 2], enduring: ["#FFE11A", 3] };
  a.traits = a.traits.map((t) => ({ ...t, color: meta[t.id][0], emblem: meta[t.id][1], stampId: meta[t.id][1] }));
  a.stamps = { chainId: 8453, address: deployed ? CONTRACT : null };
  return a;
}

/** A mocked IdentityAPI: records calls; signIn is scripted per test. */
function mockIdentity({ current = null, miniApp = false, signIn, wallet = null, order = [] } = {}) {
  let id = current;
  const subs = new Set();
  const calls = { ready: 0, signIn: [], share: [], signOut: 0, wallet: 0, order };
  const set = (next) => {
    id = next;
    for (const f of subs) f(id);
  };
  return {
    calls,
    set,
    isMiniApp: async () => miniApp,
    ready: async () => {
      calls.ready++;
      calls.order.push("ready");
    },
    current: () => id,
    signIn: (opts) => {
      calls.signIn.push(opts);
      calls.order.push("signIn");
      return signIn ? signIn(opts, set) : Promise.reject(Object.assign(new Error("no"), { code: "network" }));
    },
    signOut: () => {
      calls.signOut++;
      set(null);
    },
    onChange: (f) => (subs.add(f), () => subs.delete(f)),
    share: (text, url) => {
      calls.share.push({ text, url });
      return Promise.resolve();
    },
    wallet: async () => {
      calls.wallet++;
      return wallet;
    },
    qrSvg,
  };
}

/** A mocked StampsAPI: config from the App (like the real one), owned() scripted, the real preview(). */
function mockStamps({ owned = async () => ({ stamps: [] }) } = {}) {
  const calls = { owned: [], config: 0, mint: [] };
  return {
    calls,
    config(app) {
      calls.config++;
      const s = app?.stamps;
      return s && typeof s.address === "string" ? { chainId: s.chainId, address: s.address.toLowerCase() } : null;
    },
    owned: (address, opts) => {
      calls.owned.push(address);
      return owned(address, opts);
    },
    preview,
    mint: async (o) => {
      calls.mint.push(o);
      return { txHash: `0x${"ab".repeat(32)}`, explorerUrl: `https://basescan.org/tx/0x${"ab".repeat(32)}` };
    },
  };
}

function mount(hash, { storage = memStorage(), a = appWith(), identity = mockIdentity(), stamps = mockStamps(), frames = null } = {}) {
  const win = fakeWindow({ url: `https://app.example/Capable/${hash}`, storage });
  if (frames) win.requestAnimationFrame = (fn) => setTimeout(() => (frames.push("frame"), fn()), 0);
  const doc = win.document;
  const root = doc.createElement("div");
  root.setAttribute("id", "app");
  doc.body.appendChild(root);
  const data = doc.createElement("script");
  data.setAttribute("id", "app-data");
  data.textContent = JSON.stringify(a);
  doc.body.appendChild(data);
  const shell = boot({ win, storage, fetchImpl: async () => ({ ok: false, status: 404 }), serviceWorker: false, identity, stamps });
  return { win, doc, root, shell, identity, stamps, storage, app: a };
}

/** Progress with the first two ready lessons finished (Sovereign and Civil earned). */
function twoDone() {
  let s = emptyState();
  s = recordVisit(s, "own-your-exit", { key: "trait-0", index: 9, count: 10, finished: true });
  s = recordVisit(s, "friend-speech", { key: "trait-0", index: 9, count: 10, finished: true });
  const { legacy: _l, ...rest } = s;
  return memStorage({ "capable.progress@/Capable/": JSON.stringify({ v: 2, ...rest }) });
}

const click = (el) => el.dispatchEvent(new FakeEvent("click", { bubbles: true }));
const tile = (root, name) => [...root.querySelectorAll(".stampt")].find((li) => li.querySelector(".chip")?.textContent === name);

// ---- routes ------------------------------------------------------------------------

test("routes: #/passport, and #/p/<address> only for a well-formed address", () => {
  assert.deepEqual(parseRoute("#/passport"), { view: "passport" });
  assert.deepEqual(parseRoute(`#/p/${ADDR}`), { view: "public", address: ADDR.toLowerCase() });
  for (const bad of ["#/p/0x123", `#/p/${ADDR}00`, `#/p/${ADDR}/x`, "#/p/", `#/p/${ADDR.replace("0x", "0X")}`, "#/p/0xZZ5f0a6E2b4c1d3F9a8B7c6D5e4F3a2B1c0D9e8F", "#/passport/x"]) assert.deepEqual(parseRoute(bad), { view: "home" }, bad);
});

// ---- your passport -------------------------------------------------------------------

test("passport, signed out: a portrait from a local id kept in scoped storage, the citizen line, the seal filled with earned traits, each trait's stamp state, lessons done", async () => {
  const storage = twoDone();
  const m = mount("#/passport", { storage });
  assert.equal(m.doc.title, `${COPY.passportDoc} · capable`);
  assert.equal(m.doc.documentElement.dataset.view, "passport");
  const text = visibleText(m.root.innerHTML);
  assert.match(text, /Your passport/);
  assert.ok(text.includes(m.app.citizen.line));
  // the local id: made once, kept under the app's base path, and it seeds the portrait
  const saved = JSON.parse(storage.getItem(citizenKey("/Capable/")));
  assert.match(saved.id, /^[0-9a-f]{40}$/);
  const portrait = m.root.querySelector(".pp .photo");
  assert.ok(portrait.innerHTML.includes(canon(portraitArt(saved.id, { uid: "pp", title: COPY.portraitA11y }))), "the portrait is the art grammar's, seeded by the local id");
  assert.equal(portrait.querySelector("img"), null, "no picture when signed out");
  // the seal: Sovereign and Civil quarters
  assert.ok(m.root.querySelector(".pp__seal").innerHTML.includes(canon(brandLockup({ size: 56, filled: ["sovereign", "civil"] }))));
  assert.match(visibleText(m.root.querySelector(".pp__seal").innerHTML), /2\/4 traits/);
  // stamps: earned here (with the preview art), not yet
  assert.equal(tile(m.root, "Sovereign").dataset.state, "earned");
  assert.equal(tile(m.root, "Civil").dataset.state, "earned");
  assert.equal(tile(m.root, "Mobile").dataset.state, "none");
  assert.equal(tile(m.root, "Enduring").dataset.state, "none");
  const holder = placeholderHolder(saved.id);
  const sov = m.app.traits[0];
  const st = stampTraitOf(m.app, sov);
  assert.ok(tile(m.root, "Sovereign").innerHTML.includes(canon(stampMarkup(preview({ holder, stampId: st.stampId, tokenId: 0, trait: st })))), "the preview for the local stand-in holder, tokenId 0");
  assert.equal(tile(m.root, "Mobile").querySelector("svg"), null, "nothing drawn for a stamp not earned");
  assert.match(text, /2 of 3 lessons done/, "ready lessons only (the fixture's draft never counts)");
  // sign in and share; no sign out
  assert.equal(m.root.querySelector("[data-signin]").textContent, COPY.signIn);
  assert.equal(m.root.querySelector("[data-share]").textContent, COPY.shareLabel);
  assert.equal(m.root.querySelector("[data-signout]"), null);
  // the same id (and portrait) next time
  const again = mount("#/passport", { storage });
  assert.equal(JSON.parse(storage.getItem(citizenKey("/Capable/"))).id, saved.id);
  assert.equal(again.root.querySelector(".pp .photo").innerHTML, portrait.innerHTML);
});

test("passport, signed in: name, @handle on the provider, the picture over a portrait seeded by fid (the portrait shows when the picture fails), sign out", async () => {
  const identity = mockIdentity({ current: ADA });
  const m = mount("#/passport", { identity, storage: twoDone() });
  assert.equal(m.root.querySelector("#pp-name").textContent, "Ada Lovelace");
  assert.equal(m.root.querySelector(".pp__handle").textContent, COPY.handleLine("ada"));
  const photo = m.root.querySelector(".pp .photo");
  assert.ok(photo.innerHTML.includes(canon(portraitArt("fid:3", { uid: "pp", title: "" }))), "seeded fid:3");
  const img = photo.querySelector("img");
  assert.equal(img.getAttribute("src"), ADA.pfpUrl);
  assert.equal(img.getAttribute("referrerpolicy"), "no-referrer");
  img.dispatchEvent(new FakeEvent("error"));
  assert.equal(photo.querySelector("img"), null, "a picture that fails is removed");
  assert.ok(photo.querySelector("svg.portrait"), "and the portrait shows");
  assert.equal(m.root.querySelector("[data-signin]"), null);
  click(m.root.querySelector("[data-signout]"));
  assert.equal(identity.calls.signOut, 1);
  await settle();
  assert.match(m.root.querySelector("#pp-name").textContent, /Your passport/);
  assert.ok(m.root.querySelector("[data-signin]"));
});

test("passport: only an https picture, and every identity field is escaped", () => {
  const evil = { ...ADA, displayName: '<img src=x onerror=alert(1)>', pfpUrl: "http://pfp.example/a.png" };
  const m = mount("#/passport", { identity: mockIdentity({ current: evil }) });
  assert.equal(m.root.querySelector("img"), null);
  assert.equal(m.root.querySelector("#pp-name").textContent, evil.displayName, "shown as text");
});

test("passport: stamps on chain are read for the reader's known address, only when a contract is configured", async () => {
  const owned = async (a) => (a.toLowerCase() === ADDR.toLowerCase() ? { stamps: [{ tokenId: 57, stampId: 1 }] } : { stamps: [] });
  const off = mount("#/passport", { identity: mockIdentity({ current: ADA }), stamps: mockStamps({ owned }), storage: twoDone() });
  await settle();
  assert.deepEqual(off.stamps.calls.owned, [], "no contract: no read");
  const on = mount("#/passport", { identity: mockIdentity({ current: ADA }), stamps: mockStamps({ owned }), a: appWith({ deployed: true }) });
  await settle();
  assert.deepEqual(on.stamps.calls.owned, [ADDR]);
  const civil = tile(on.root, "Civil");
  assert.equal(civil.dataset.state, "minted");
  assert.equal(civil.querySelector(".stampt__state").textContent, COPY.stampState.minted);
  const st = stampTraitOf(on.app, on.app.traits[1]);
  assert.ok(civil.innerHTML.includes(canon(stampMarkup(preview({ holder: ADDR, stampId: 1, tokenId: 57, trait: st })))), "the on-chain art, reproduced");
  assert.equal(tile(on.root, "Sovereign").dataset.state, "none", "not earned here (no progress) and not on chain");
  assert.ok(on.root.querySelector(".pp__seal").innerHTML.includes(canon(brandLockup({ size: 56, filled: ["civil"] }))));
});

test("share: called straight from the tap, with the count and a link (the public passport when an address and a contract exist)", async () => {
  const identity = mockIdentity({ current: ADA });
  const m = mount("#/passport", { identity, storage: twoDone() });
  click(m.root.querySelector("[data-share]"));
  assert.deepEqual(identity.calls.share, [{ text: "I'm becoming capable: 2 of 4 traits.", url: "https://app.example/Capable/" }], "synchronously, no await before it");
  const id2 = mockIdentity({ current: ADA });
  const d = mount("#/passport", { identity: id2, storage: twoDone(), a: appWith({ deployed: true }) });
  click(d.root.querySelector("[data-share]"));
  assert.deepEqual(id2.calls.share, [{ text: "I'm becoming capable: 2 of 4 traits.", url: `https://app.example/Capable/#/p/${ADDR.toLowerCase()}` }]);
  // signed out, share still works (opens the compose page), with the app's link
  const id3 = mockIdentity();
  const s = mount("#/passport", { identity: id3 });
  click(s.root.querySelector("[data-share]"));
  assert.deepEqual(id3.calls.share, [{ text: "I'm becoming capable: 0 of 4 traits.", url: "https://app.example/Capable/" }]);
});

test("the you chip opens the passport; signed in it carries a 48px portrait or picture", async () => {
  const m = mount("#/", { storage: twoDone() });
  const chip = m.root.querySelector(".home__you");
  assert.equal(chip.getAttribute("href"), "#/passport");
  assert.equal(chip.querySelector(".photo"), null, "signed out: no face yet");
  m.win.location.hash = "#/passport";
  await settle();
  assert.ok(m.root.querySelector(".passport"));
  press(m.doc, "Escape");
  await settle();
  assert.ok(m.root.querySelector(".home"), "Esc (or the close button) goes back home");
  assert.equal(m.win.history.length, 2, "and back, not a new entry");
  const s = mount("#/", { identity: mockIdentity({ current: ADA }) });
  const avatar = s.root.querySelector(".home__you .photo");
  assert.ok(avatar.classList.contains("photo--chip"), "the 48px chip size");
  assert.equal(avatar.querySelector("img").getAttribute("src"), ADA.pfpUrl);
  assert.ok(avatar.querySelector("svg.portrait"));
  avatar.querySelector("img").dispatchEvent(new FakeEvent("error"));
  assert.equal(avatar.querySelector("img"), null);
});

test("signing in or out elsewhere (another tab) redraws home's chip and the passport", async () => {
  const identity = mockIdentity();
  const m = mount("#/", { identity });
  assert.equal(m.root.querySelector(".home__you .photo"), null);
  identity.set(ADA);
  assert.ok(m.root.querySelector(".home__you .photo"));
  m.win.location.hash = "#/passport";
  await settle();
  identity.set(null);
  assert.match(m.root.querySelector("#pp-name").textContent, /Your passport/);
});

// ---- the sign-in sheet -------------------------------------------------------------------

const URL_ = "https://farcaster.xyz/~/siwf?channelToken=e3b0c442-98fc";

/** signIn that hands out the link, then waits for the test to settle it (or the signal to abort). */
function scripted() {
  const ctl = {};
  const signIn = (opts, set) =>
    new Promise((resolve, reject) => {
      ctl.opts = opts;
      ctl.resolve = (id = ADA) => {
        set(id);
        resolve(id);
      };
      ctl.reject = (code) => reject(Object.assign(new Error(code), { code }));
      opts.signal.addEventListener("abort", () => reject(Object.assign(new Error("cancelled"), { code: "cancelled" })));
    });
  return { ctl, signIn };
}

test("sign-in sheet: waiting, then the QR code and an 'open on this phone' link for the deep link; the page behind is inert", async () => {
  const { ctl, signIn } = scripted();
  const m = mount("#/passport", { identity: mockIdentity({ signIn }) });
  const btn = m.root.querySelector("[data-signin]");
  click(btn);
  await settle();
  const sheet = m.root.querySelector(".signin");
  assert.equal(sheet.getAttribute("role"), "dialog");
  assert.equal(sheet.getAttribute("aria-modal"), "true");
  assert.equal(sheet.dataset.phase, "waiting");
  assert.equal(sheet.querySelector(".signin__title").textContent, COPY.signInTitle);
  assert.equal(sheet.querySelector(".signin__explain").textContent, COPY.signInScan);
  assert.equal(m.root.querySelector(".passport").hasAttribute("inert"), true);
  assert.equal(typeof ctl.opts.onUrl, "function");
  assert.ok(ctl.opts.signal instanceof AbortSignal);
  ctl.opts.onUrl(URL_);
  assert.equal(sheet.dataset.phase, "code");
  const qr = sheet.querySelector(".signin__qr svg");
  assert.ok(qr, "the QR code is drawn inline");
  assert.equal(sheet.querySelector(".signin__qr").innerHTML, canon(svgMarkup(qrSvg(URL_), "qr")), "identity.qrSvg of the deep link");
  const open = sheet.querySelector("a.signin__open");
  assert.equal(open.getAttribute("href"), URL_);
  assert.equal(open.getAttribute("target"), "_blank");
  assert.equal(open.getAttribute("rel"), "noopener noreferrer");
  assert.equal(open.textContent, COPY.signInOpenHere);
  // approved: the sheet closes and the passport carries the name
  ctl.resolve();
  await settle();
  assert.equal(m.root.querySelector(".signin"), null);
  assert.equal(m.root.querySelector("#pp-name").textContent, "Ada Lovelace");
  assert.equal(m.root.querySelector(".passport").hasAttribute("inert"), false);
});

test("sign-in sheet: Cancel and Esc abort the sign-in and close the sheet; focus returns to the button", async () => {
  for (const how of ["cancel", "escape"]) {
    const { ctl, signIn } = scripted();
    const m = mount("#/passport", { identity: mockIdentity({ signIn }) });
    click(m.root.querySelector("[data-signin]"));
    await settle();
    ctl.opts.onUrl(URL_);
    if (how === "cancel") click(m.root.querySelector("[data-signin-cancel]"));
    else press(m.doc, "Escape");
    assert.equal(ctl.opts.signal.aborted, true, how);
    await settle();
    assert.equal(m.root.querySelector(".signin"), null, how);
    assert.ok(m.root.querySelector(".passport"), `${how}: still on the passport`);
    assert.equal(m.doc.activeElement, m.root.querySelector("[data-signin]"), how);
    assert.equal(m.identity.current(), null);
  }
});

test("sign-in sheet: each failure has its own copy, and Try again starts a fresh sign-in", async () => {
  for (const code of ["timeout", "cancelled", "rejected", "verify-failed", "network"]) {
    const { ctl, signIn } = scripted();
    const identity = mockIdentity({ signIn });
    const m = mount("#/passport", { identity });
    click(m.root.querySelector("[data-signin]"));
    await settle();
    ctl.opts.onUrl(URL_);
    ctl.reject(code);
    await settle();
    const sheet = m.root.querySelector(".signin");
    assert.equal(sheet.dataset.phase, "error", code);
    assert.equal(sheet.querySelector(".signin__error").textContent, COPY.signInError[code], code);
    assert.equal(sheet.querySelector(".signin__error").getAttribute("role"), "alert");
    assert.equal(sheet.querySelector(".signin__qr"), null, "the stale code is gone");
    click(sheet.querySelector("[data-signin-retry]"));
    await settle();
    assert.equal(identity.calls.signIn.length, 2, `${code}: a fresh attempt`);
    assert.equal(m.root.querySelector(".signin").dataset.phase, "waiting");
    assert.notEqual(identity.calls.signIn[1].signal, identity.calls.signIn[0].signal);
  }
  // anything without a known code reads as a network failure
  const m = mount("#/passport", { identity: mockIdentity({ signIn: () => Promise.reject(new Error("boom")) }) });
  click(m.root.querySelector("[data-signin]"));
  await settle();
  assert.equal(m.root.querySelector(".signin__error").textContent, COPY.signInError.network);
});

test("leaving the passport while signing in aborts it", async () => {
  const { ctl, signIn } = scripted();
  const m = mount("#/passport", { identity: mockIdentity({ signIn }) });
  click(m.root.querySelector("[data-signin]"));
  await settle();
  m.win.location.hash = "#/";
  await settle();
  assert.equal(ctl.opts.signal.aborted, true);
  assert.equal(m.root.querySelector(".signin"), null);
});

// ---- inside a host client --------------------------------------------------------------

test("Mini App boot: ready() after the first paint, then sign in from the host's context with no prompt", async () => {
  const order = [];
  const identity = mockIdentity({ miniApp: true, order, signIn: (opts, set) => (set(ADA), Promise.resolve(ADA)) });
  const m = mount("#/", { identity, frames: order });
  assert.ok(m.root.querySelector(".home"), "home is rendered first");
  for (let i = 0; i < 10; i++) await new Promise((r) => queueMicrotask(r));
  assert.equal(identity.calls.ready, 0, "not before a frame has been painted");
  assert.equal(await m.shell.miniapp, true);
  assert.ok(order.indexOf("frame") >= 0 && order.indexOf("frame") < order.indexOf("ready"), `a frame, then ready: ${order}`);
  assert.deepEqual(order.filter((x) => x !== "frame"), ["ready", "signIn"]);
  assert.equal(identity.calls.signIn[0], undefined, "no onUrl, no sheet: the host's user");
  assert.equal(m.doc.documentElement.dataset.host, "miniapp");
  assert.ok(m.root.querySelector(".home__you .photo"), "the chip shows the person");
  // the passport's sign-in button, inside a host, asks the host again (no sheet)
  identity.set(null);
  m.win.location.hash = "#/passport";
  await settle();
  click(m.root.querySelector("[data-signin]"));
  await settle();
  assert.equal(m.root.querySelector(".signin"), null);
  assert.equal(identity.calls.signIn.length, 2);
  assert.equal(identity.calls.signIn[1], undefined);
});

test("on the web nothing is called at boot: no ready(), no sign-in, no wallet", async () => {
  const identity = mockIdentity();
  const m = mount("#/", { identity });
  assert.equal(await m.shell.miniapp, false);
  await settle();
  assert.deepEqual(identity.calls.order, []);
  assert.equal(identity.calls.wallet, 0);
  assert.equal(m.doc.documentElement.dataset.host, undefined);
});

test("a host that fails to give a user leaves the app signed out and working", async () => {
  const identity = mockIdentity({ miniApp: true, signIn: () => Promise.reject(Object.assign(new Error("x"), { code: "verify-failed" })) });
  const m = mount("#/", { identity });
  assert.equal(await m.shell.miniapp, true);
  assert.equal(identity.current(), null);
  assert.ok(m.root.querySelector(".home"));
});

// ---- the public passport --------------------------------------------------------------

test("public passport: read-only, a portrait seeded by the address, no name, the address's stamps from chain", async () => {
  let resolve;
  const owned = () => new Promise((r) => (resolve = r));
  const stamps = mockStamps({ owned });
  const m = mount(`#/p/${PUB}`, { stamps, a: appWith({ deployed: true }) });
  assert.equal(m.doc.title, `${COPY.publicDoc} · capable`);
  assert.equal(m.root.querySelector(".passport").dataset.status, "loading");
  assert.match(visibleText(m.root.innerHTML), new RegExp(COPY.publicLoading));
  await settle();
  assert.deepEqual(stamps.calls.owned, [PUB]);
  assert.equal(m.root.querySelector(".passport").dataset.status, "loading", "until the chain answers");
  resolve({ stamps: [{ tokenId: 14, stampId: 0 }, { tokenId: 203, stampId: 2 }] });
  await settle();
  assert.equal(m.root.querySelector(".passport").dataset.status, "ok");
  assert.equal(m.root.querySelector("#pp-name").textContent, COPY.publicName, "no name: the chain does not say who they are");
  assert.equal(m.root.querySelector(".pp__handle").textContent, "0x7a11…ffee");
  assert.ok(m.root.querySelector(".pp .photo").innerHTML.includes(canon(portraitArt(PUB, { uid: "pub", title: COPY.publicA11y }))));
  assert.equal(tile(m.root, "Sovereign").dataset.state, "minted");
  assert.equal(tile(m.root, "Mobile").dataset.state, "minted");
  assert.equal(tile(m.root, "Civil").dataset.state, "none");
  const st = stampTraitOf(m.app, m.app.traits[2]);
  assert.ok(tile(m.root, "Mobile").innerHTML.includes(canon(stampMarkup(preview({ holder: PUB, stampId: 2, tokenId: 203, trait: st })))));
  assert.ok(m.root.querySelector(".pp__seal").innerHTML.includes(canon(brandLockup({ size: 56, filled: ["sovereign", "mobile"] }))));
  for (const sel of ["[data-signin]", "[data-share]", "[data-signout]", "img"]) assert.equal(m.root.querySelector(sel), null, `read-only: no ${sel}`);
});

test("public passport: no stamps, the RPC down (with retry), no contract configured", async () => {
  const none = mount(`#/p/${PUB}`, { stamps: mockStamps({ owned: async () => ({ stamps: [] }) }), a: appWith({ deployed: true }) });
  await settle();
  assert.equal(none.root.querySelector(".pp__note").textContent, COPY.publicNone);
  let fail = true;
  const flaky = mockStamps({ owned: async () => (fail ? { stamps: [], error: "the network answered HTTP 503" } : { stamps: [{ tokenId: 1, stampId: 3 }] }) });
  const down = mount(`#/p/${PUB}`, { stamps: flaky, a: appWith({ deployed: true }) });
  await settle();
  assert.equal(down.root.querySelector(".passport").dataset.status, "error");
  assert.equal(down.root.querySelector(".pp__note").textContent, COPY.publicError);
  fail = false;
  click(down.root.querySelector("[data-retry]"));
  await settle();
  assert.equal(down.root.querySelector(".passport").dataset.status, "ok");
  assert.equal(tile(down.root, "Enduring").dataset.state, "minted");
  const throws = mount(`#/p/${PUB}`, { stamps: mockStamps({ owned: async () => Promise.reject(new Error("x")) }), a: appWith({ deployed: true }) });
  await settle();
  assert.equal(throws.root.querySelector(".passport").dataset.status, "error", "a throwing read is an error, not a crash");
  const off = mount(`#/p/${PUB}`, { stamps: mockStamps() });
  await settle();
  assert.equal(off.root.querySelector(".passport").dataset.status, "off");
  assert.equal(off.root.querySelector(".pp__note").textContent, COPY.publicOff);
  assert.deepEqual(off.stamps.calls.owned, [], "no contract: nothing is read");
});

test("a bad public address goes home", async () => {
  const m = mount("#/p/0x1234");
  assert.ok(m.root.querySelector(".home"));
});

// ---- the header logo ------------------------------------------------------------------

test("the header logo is the seal lockup, its ring filled with the traits earned (drafts never fill it); the first run shows the empty ring", () => {
  const app = appWith();
  const svgOf = (m) => m.match(/<span class="home__logo"[^>]*>([\s\S]*?<\/svg>)<\/span>/)[1];
  const first = String(renderHome(app, emptyState()));
  assert.match(first, /<span class="home__logo" data-filled="">/);
  assert.equal(svgOf(first), String(brandLockup({ size: 44, filled: [] })), "first run: the empty ring");
  let s = recordVisit(emptyState(), "own-your-exit", { key: "trait-0", index: 9, count: 10, finished: true });
  s = recordVisit(s, "friend-speech", { key: "trait-0", index: 9, count: 10, finished: true });
  const two = String(renderHome(app, s));
  assert.match(two, /data-filled="sovereign civil"/);
  assert.equal(svgOf(two), String(brandLockup({ size: 44, filled: ["sovereign", "civil"] })));
  assert.notEqual(svgOf(two), svgOf(first));
  assert.notEqual(svgOf(two), String(brandLockup({ size: 44 })), "not the full ring");
  // the fixture's draft (Mobile) finished: still not earned
  const draft = String(renderHome(app, recordVisit(emptyState(), "new-topic", { key: "trait-0", index: 3, count: 4, finished: true })));
  assert.match(draft, /data-filled=""/);
  for (const t of tags(first, "svg").filter((x) => /class="lockup"/.test(x))) assert.equal(attr(t, "role"), "img");
});
