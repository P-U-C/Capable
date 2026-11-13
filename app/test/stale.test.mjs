// Review V7: after a deploy, an open page still runs the old code, and its
// lazy chunks (sign-in, the wallet and chain code, hls.js) 404. When one of
// those entry points fails, the shell asks whether the deployed app is still
// the one this page runs (the live sw.js lists the first-paint bundle); if not,
// it says "<app> was updated — reload to continue" with a Reload button, and
// the reload resumes the deck at the saved card.
import test from "node:test";
import assert from "node:assert/strict";
import { fakeWindow, memStorage, settle, FakeEvent } from "./dom.mjs";
import { fixture, visibleText } from "./helpers.mjs";
import { boot } from "../src/shell.mjs";
import { COPY } from "../src/copy.mjs";
import { createUpdateCheck, isChunkError, pageEntry } from "../src/stale.mjs";
import { createStamps, preview } from "../src/stamps/index.mjs";
import { qrSvg } from "../src/identity/index.mjs";

const ENTRY = "app.OLD12345.js";
const swText = (entry) => `// capable service worker 0e55fd21bc\nconst SHELL = ["./","./${entry}","./chunk.NL35BLF6.js"];\n`;
const CONTRACT = "0x00000000000000000000000000000000ca9ab1e5";
const ACCOUNT = "0x5e5f0a6e2b4c1d3f9a8b7c6d5e4f3a2b1c0d9e8f";

/** fetch for the update check: the live sw.js names `live`; records every call. */
function swFetch(live, calls = []) {
  const f = async (url, init) => {
    calls.push({ url, init });
    if (live === null) throw new TypeError("Failed to fetch");
    return { ok: true, text: async () => swText(live) };
  };
  f.calls = calls;
  return f;
}

const chunk404 = (url = "https://app.example/Capable/flows.ABCDEF12.js") => new TypeError(`Failed to fetch dynamically imported module: ${url}`);

test("isChunkError knows each browser's words for a failed dynamic import, here or in a cause", () => {
  assert.equal(isChunkError(chunk404()), true, "Chromium");
  assert.equal(isChunkError(new TypeError("error loading dynamically imported module: https://x/hls.A1B2C3D4.js")), true, "Firefox");
  assert.equal(isChunkError(new TypeError("Importing a module script failed.")), true, "Safari");
  const wrapped = Object.assign(new Error("could not load the stamp code"), { code: "offline", cause: chunk404() });
  assert.equal(isChunkError(wrapped), true, "wrapped by the stamps or identity module");
  assert.equal(isChunkError(new Error("User rejected the request.")), false);
  assert.equal(isChunkError(null), false);
});

test("the update check reads the live sw.js past every cache: stale when it no longer lists this page's bundle; offline or unknown says no", async () => {
  const win = fakeWindow();
  const s = win.document.createElement("script");
  s.setAttribute("type", "module");
  s.setAttribute("src", ENTRY);
  win.document.body.appendChild(s);
  assert.equal(pageEntry(win.document), ENTRY);
  assert.equal(pageEntry(fakeWindow().document), null, "no bundle script (dev, tests): unknown");

  const same = swFetch(ENTRY);
  const a = createUpdateCheck({ doc: win.document, fetchImpl: same });
  assert.equal(await a.check(), false, "the deployed app is this one");
  assert.equal(same.calls[0].url, "./sw.js");
  assert.equal(same.calls[0].init.cache, "no-store", "past the HTTP cache (the service worker never stores sw.js)");
  assert.equal(await a.check(), false);
  assert.equal(same.calls.length, 1, "a 'no' is remembered for a while: a run of failures costs one fetch");

  let t = 0;
  const newer = swFetch("app.NEW98765.js");
  const b = createUpdateCheck({ doc: win.document, fetchImpl: newer, now: () => t });
  assert.equal(await b.check(), true, "the live worker lists another bundle: this page is out of date");
  assert.equal(b.stale, true);
  t = 10 ** 9;
  assert.equal(await b.check(), true);
  assert.equal(newer.calls.length, 1, "stale stays stale");

  assert.equal(await createUpdateCheck({ doc: win.document, fetchImpl: swFetch(null) }).check(), false, "offline: can't tell, so no");
  const html404 = async () => ({ ok: true, text: async () => "<!doctype html><title>404</title>" });
  assert.equal(await createUpdateCheck({ doc: win.document, fetchImpl: html404 }).check(), false, "not a service worker: no");
  assert.equal(await createUpdateCheck({ doc: win.document, fetchImpl: async () => ({ ok: false, status: 404 }) }).check(), false);
  const none = swFetch("app.NEW98765.js");
  assert.equal(await createUpdateCheck({ doc: fakeWindow().document, fetchImpl: none }).check(), false, "this page's bundle unknown: no");
  assert.equal(none.calls.length, 0);
  const c = createUpdateCheck({ doc: win.document, fetchImpl: same });
  c.mark(); // a new service worker took this page over
  assert.equal(await c.check(), true);
});

function appWith({ deployed = true } = {}) {
  const a = fixture();
  const meta = { sovereign: ["#18C8F0", 0], civil: ["#FF1FC8", 1], mobile: ["#5CF27E", 2], enduring: ["#FFE11A", 3] };
  a.traits = a.traits.map((t) => ({ ...t, color: meta[t.id][0], emblem: meta[t.id][1], stampId: meta[t.id][1] }));
  a.stamps = { chainId: 8453, address: deployed ? CONTRACT : null };
  return a;
}

const wallet = { request: async ({ method }) => (method === "eth_accounts" ? [ACCOUNT] : method === "eth_chainId" ? "0x2105" : null) };

function mockIdentity({ signIn } = {}) {
  return {
    isMiniApp: async () => false,
    ready: async () => {},
    current: () => null,
    signIn: signIn || (() => Promise.reject(Object.assign(new Error("network"), { code: "network" }))),
    signOut() {},
    onChange: () => () => {},
    share: async () => {},
    wallet: async () => wallet,
    qrSvg,
  };
}

/** Stamps whose wallet and chain code (the codec chunk) is gone: check() can't read, mint() can't load. */
function staleStamps() {
  const real = createStamps({ fetch: async () => Promise.reject(new Error("tests never touch the network")) }); // config() only
  const offline = Object.assign(new Error("could not load the stamp code; check the connection and try again"), { name: "StampsError", code: "offline", cause: chunk404("https://app.example/Capable/codec.QWERTY12.js") });
  return {
    config: real.config,
    preview,
    owned: async () => ({ stamps: [], error: offline.message }),
    check: async () => ({ open: true, held: false }), // the read path works here; the mint's chunk is what's gone
    mint: async () => Promise.reject(offline),
    receipt: async () => ({ status: "pending" }),
  };
}

/** Boot the app in a fake window at `hash`, with the update check pointed at a live sw.js that names `live`. */
function bootAt(hash, { storage = memStorage(), live = "app.NEW98765.js", identity = mockIdentity(), stamps = staleStamps(), loadHls, nativeHls = true } = {}) {
  const win = fakeWindow({ url: `https://app.example/Capable/${hash}`, storage, nativeHls });
  const reloads = [];
  win.location.reload = () => reloads.push(win.location.href);
  const doc = win.document;
  const s = doc.createElement("script");
  s.setAttribute("type", "module");
  s.setAttribute("src", ENTRY);
  doc.body.appendChild(s);
  const root = doc.createElement("div");
  root.setAttribute("id", "app");
  doc.body.appendChild(root);
  const data = doc.createElement("script");
  data.setAttribute("id", "app-data");
  data.textContent = JSON.stringify(appWith());
  doc.body.appendChild(data);
  const fetchUpdate = swFetch(live);
  const shell = boot({ win, storage, fetchImpl: async () => ({ ok: false, status: 404 }), serviceWorker: false, identity, stamps, loadHls, updates: createUpdateCheck({ doc, fetchImpl: fetchUpdate }) });
  return { win, doc, root, shell, reloads, storage, fetchUpdate };
}

const click = (el) => el.dispatchEvent(new FakeEvent("click", { bubbles: true }));
const until = async (fn, n = 200) => {
  for (let i = 0; i < n && !fn(); i++) await settle();
};

test("mint after a deploy: the stamp code 404s → 'capable was updated — reload to continue'; Reload keeps the deck at the trait card", async () => {
  const m = bootAt("#/l/own-your-exit");
  const deck = m.shell.view;
  const traitAt = Number(m.root.querySelector('.card[data-type="trait"]').dataset.i);
  deck.go(traitAt);
  await until(() => deck.stamp.state.phase === "mint");
  assert.equal(m.doc.querySelector(".update"), null, "nothing to say before anything fails");
  click(m.root.querySelector("[data-mint]"));
  await until(() => m.doc.querySelector(".update"));
  const notice = m.doc.querySelector(".update");
  assert.ok(notice, "the notice");
  assert.equal(notice.parentNode, m.doc.body, "outside the view, so re-renders keep it");
  assert.equal(notice.querySelector("[role=alert] .update__text").textContent, COPY.appUpdated("capable"));
  assert.equal(COPY.appUpdated("capable"), "capable was updated — reload to continue.");
  const reload = notice.querySelector("button[data-reload]");
  assert.equal(reload.textContent, COPY.reload);
  assert.equal(m.fetchUpdate.calls.length, 1, "one look at the live sw.js");
  click(reload);
  assert.deepEqual(m.reloads, ["https://app.example/Capable/#/l/own-your-exit"], "a reload of the same route");
  // the reload: same storage, same URL → the deck opens on the trait card, where the reader was
  const again = bootAt("#/l/own-your-exit", { storage: m.storage, live: ENTRY });
  assert.equal(again.shell.view.index, traitAt, "the deck position survives the reload");
  assert.equal(again.doc.querySelector(".update"), null);
});

test("sign-in after a deploy: the sign-in code 404s → the sheet closes for the update notice", async () => {
  const signIn = () => Promise.reject(Object.assign(new Error("Sign-in could not reach the service: the sign-in code did not load."), { name: "IdentityError", code: "network", cause: chunk404() }));
  const m = bootAt("#/passport", { identity: mockIdentity({ signIn }) });
  click(m.root.querySelector("[data-signin]"));
  await until(() => m.doc.querySelector(".update"));
  assert.ok(m.doc.querySelector(".update"));
  assert.equal(m.root.querySelector(".signin"), null, "the sheet's network error would be wrong: it closes");
  assert.equal(m.doc.documentElement.classList.contains("has-signin"), false);
  click(m.doc.querySelector("[data-reload]"));
  assert.deepEqual(m.reloads, ["https://app.example/Capable/#/passport"]);
});

test("video after a deploy: hls.js 404s → the notice (and the frame still offers the original)", async () => {
  const loadHls = () => Promise.reject(chunk404("https://app.example/Capable/hls.L3ORWDAK.js"));
  const m = bootAt("#/l/friend-speech", { loadHls, nativeHls: false });
  const lead = Number(m.root.querySelector('.card[data-type="lead"]').dataset.i);
  m.shell.view.go(lead);
  await until(() => m.doc.querySelector(".update"));
  assert.ok(m.doc.querySelector(".update"));
  assert.ok(m.root.querySelector(".card.is-active .vframe.is-error"), "the frame falls back as before");
});

test("not an update (the live app is this one, or offline): no notice, the usual error stays", async () => {
  for (const live of [ENTRY, null]) {
    const m = bootAt("#/l/own-your-exit", { live });
    const deck = m.shell.view;
    deck.go(Number(m.root.querySelector('.card[data-type="trait"]').dataset.i));
    await until(() => deck.stamp.state.phase === "mint");
    click(m.root.querySelector("[data-mint]"));
    await until(() => deck.stamp.state.phase === "error");
    await settle();
    assert.equal(m.doc.querySelector(".update"), null, String(live));
    assert.ok(visibleText(m.root.querySelector(".card.is-active [data-stamp-act]").innerHTML).includes(COPY.mintError.offline));
    assert.ok(m.root.querySelector(".card.is-active [data-mint]"), "Try again, as before");
  }
});
