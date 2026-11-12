// I1 — Mini App mode with a mocked SDK: detection (≤ 1.5 s, false on any
// error, the SDK never loaded on a top-level page), ready(), the host's
// context user as the identity (no prompt, no network), the host wallet, the
// host compose sheet; and the web fallbacks for share and wallet.
import test from "node:test";
import assert from "node:assert/strict";
import * as id from "../src/identity/index.mjs";

const define = (name, value) => Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });

function memoryStorage() {
  const m = new Map();
  return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => void m.set(k, String(v)), removeItem: (k) => void m.delete(k) };
}

/** A window: top-level (parent === itself) or framed (inside a host's iframe). */
function fakeWindow({ framed = false } = {}) {
  const w = new EventTarget();
  w.parent = framed ? new EventTarget() : w;
  w.opened = [];
  w.open = (...args) => {
    w.opened.push(args);
    return null;
  };
  return w;
}

const USER = { fid: 6841, username: "deodad", displayName: "Tony D'Addeo", pfpUrl: "https://i.imgur.com/dMoIan7.jpg", location: { placeId: "x", description: "y" } };

function fakeSdk({ inMiniApp = true, context = { user: USER, client: { clientFid: 9152, added: false } }, provider = { request: async () => "0x1" }, hang = {} } = {}) {
  const calls = { isInMiniApp: 0, ready: 0, compose: [], getEthereumProvider: 0, signIn: 0, context: 0 };
  const never = new Promise(() => {});
  const sdk = {
    async isInMiniApp() {
      calls.isInMiniApp++;
      if (hang.detect) return never;
      if (inMiniApp instanceof Error) throw inMiniApp;
      return inMiniApp;
    },
    get context() {
      calls.context++;
      return hang.context ? never : Promise.resolve(context);
    },
    actions: {
      async ready() {
        calls.ready++;
        if (hang.ready) return never;
      },
      async composeCast(opts) {
        calls.compose.push(opts);
        return { cast: null };
      },
      async signIn() {
        calls.signIn++;
        throw new Error("signIn must not be called: no prompt in Mini App mode");
      },
    },
    wallet: {
      async getEthereumProvider() {
        calls.getEthereumProvider++;
        return provider;
      },
    },
  };
  return { sdk, calls };
}

let win;
let ls;
let fetches;
let loads;
function setup({ framed = true, sdk } = {}) {
  id._reset();
  win = fakeWindow({ framed });
  define("window", win);
  ls = memoryStorage();
  define("localStorage", ls);
  fetches = [];
  define("fetch", async (url) => {
    fetches.push(String(url));
    throw new Error("no network in Mini App tests");
  });
  loads = { miniapp: 0, authClient: 0 };
  id._setLoaders({
    miniapp: async () => {
      loads.miniapp++;
      if (!sdk) throw new Error("chunk failed to load");
      return { sdk };
    },
    authClient: async () => {
      loads.authClient++;
      throw new Error("the web sign-in must not load in a Mini App");
    },
  });
}
test.after(() => {
  id._reset();
  for (const k of ["window", "localStorage", "fetch"]) delete globalThis[k];
});

test("isMiniApp: a top-level page is not a Mini App and the SDK is never loaded", { timeout: 10_000 }, async () => {
  const { sdk, calls } = fakeSdk();
  setup({ framed: false, sdk });
  assert.equal(await id.isMiniApp(), false);
  await id.ready();
  assert.equal(loads.miniapp, 0, "no SDK chunk on the plain web");
  assert.equal(calls.isInMiniApp, 0);
  delete globalThis.window; // Node / server rendering
  assert.equal(await id.isMiniApp(), false);
});

test("isMiniApp: in a frame the SDK's detection decides, and a yes is remembered", { timeout: 10_000 }, async () => {
  const { sdk, calls } = fakeSdk();
  setup({ sdk });
  assert.equal(await id.isMiniApp(), true);
  assert.equal(await id.isMiniApp(), true);
  assert.equal(calls.isInMiniApp, 1, "asked once");
  assert.equal(loads.miniapp, 1);
  const no = fakeSdk({ inMiniApp: false });
  setup({ sdk: no.sdk });
  assert.equal(await id.isMiniApp(), false);
  const rn = fakeSdk();
  setup({ framed: false, sdk: rn.sdk });
  win.ReactNativeWebView = { postMessage() {} }; // a mobile host's WebView is not an iframe
  assert.equal(await id.isMiniApp(), true);
});

test("isMiniApp: false, never a throw, when the SDK rejects or fails to load", { timeout: 10_000 }, async () => {
  setup({ sdk: fakeSdk({ inMiniApp: new Error("host gone") }).sdk });
  assert.equal(await id.isMiniApp(), false);
  setup({ sdk: null });
  assert.equal(await id.isMiniApp(), false);
  setup({ sdk: { isInMiniApp: "not a function" } });
  assert.equal(await id.isMiniApp(), false);
  setup({ sdk: fakeSdk().sdk });
  Object.defineProperty(win, "parent", {
    get() {
      throw new Error("cross-origin");
    },
  });
  assert.equal(await id.isMiniApp(), true, "an unreadable parent still asks the SDK");
});

test("isMiniApp: resolves false within 1.5 s when the host never answers", { timeout: 10_000 }, async () => {
  setup({ sdk: fakeSdk({ hang: { detect: true } }).sdk });
  assert.equal(id.TIMING.detectMs, 1500);
  const t0 = Date.now();
  assert.equal(await id.isMiniApp(), false);
  const took = Date.now() - t0;
  assert.ok(took >= 1400 && took < 2500, `took ${took} ms`); // upper bound loose for loaded CI machines
});

test("ready(): calls sdk.actions.ready() once inside a host; a no-op outside; never throws or hangs", { timeout: 10_000 }, async () => {
  const { sdk, calls } = fakeSdk();
  setup({ sdk });
  await id.ready();
  assert.equal(calls.ready, 1);
  const web = fakeSdk({ inMiniApp: false });
  setup({ sdk: web.sdk });
  await id.ready();
  assert.equal(web.calls.ready, 0);
  const broken = fakeSdk();
  broken.sdk.actions.ready = async () => {
    throw new Error("host error");
  };
  setup({ sdk: broken.sdk });
  await assert.doesNotReject(id.ready());
  const slow = fakeSdk({ hang: { ready: true } });
  setup({ sdk: slow.sdk });
  id._setTiming({ hostMs: 30 });
  await id.ready(); // returns although the host never answers
  assert.equal(slow.calls.ready, 1);
});

test("signIn(): the host's context user becomes the identity: no prompt, no network, stored, announced", { timeout: 10_000 }, async () => {
  const { sdk, calls } = fakeSdk();
  setup({ sdk });
  const seen = [];
  id.onChange((v) => seen.push(v));
  let urls = 0;
  const me = await id.signIn({ onUrl: () => urls++ });
  assert.deepEqual(Object.keys(me).sort(), ["displayName", "fid", "pfpUrl", "signedInAt", "source", "username"]);
  assert.equal(me.fid, 6841);
  assert.equal(me.username, "deodad");
  assert.equal(me.displayName, "Tony D'Addeo");
  assert.equal(me.pfpUrl, "https://i.imgur.com/dMoIan7.jpg");
  assert.equal(me.source, "miniapp");
  assert.ok(Math.abs(Date.parse(me.signedInAt) - Date.now()) < 5000);
  assert.equal(calls.signIn, 0, "no sign-in prompt");
  assert.equal(urls, 0, "no deep link inside a host");
  assert.deepEqual(fetches, [], "no network");
  assert.equal(loads.authClient, 0, "the web sign-in code is not loaded");
  assert.deepEqual(id.current(), me);
  assert.deepEqual(JSON.parse(ls.getItem("capable.identity.v1")), { ...me });
  assert.deepEqual(seen, [me]);
});

test("signIn(): hostile context fields are dropped, the account is kept", { timeout: 10_000 }, async () => {
  const { sdk } = fakeSdk({ context: { user: { fid: 77, username: "Not Valid!", displayName: "admin‮gnp.exe", pfpUrl: "javascript:alert(1)" } } });
  setup({ sdk });
  const me = await id.signIn();
  assert.deepEqual({ ...me, signedInAt: "t" }, { fid: 77, source: "miniapp", signedInAt: "t" });
});

test("signIn(): no valid user from the host → verify-failed, nothing stored", { timeout: 10_000 }, async () => {
  for (const context of [{}, { user: null }, { user: { fid: 0 } }, { user: { fid: "6841" } }, { user: { fid: -3, username: "x" } }, null, "user"]) {
    const { sdk } = fakeSdk({ context });
    setup({ sdk });
    const seen = [];
    id.onChange((v) => seen.push(v));
    await assert.rejects(id.signIn(), (e) => e instanceof id.IdentityError && e.code === "verify-failed", JSON.stringify(context));
    assert.equal(ls.getItem("capable.identity.v1"), null);
    assert.deepEqual(seen, []);
  }
});

test("signIn(): cancel through the signal → cancelled, nothing stored", { timeout: 10_000 }, async () => {
  const pre = new AbortController();
  pre.abort();
  setup({ sdk: fakeSdk().sdk });
  await assert.rejects(id.signIn({ signal: pre.signal }), { code: "cancelled" });
  const { sdk } = fakeSdk({ hang: { context: true } });
  setup({ sdk });
  const ac = new AbortController();
  const p = id.signIn({ signal: ac.signal });
  setTimeout(() => ac.abort(), 20);
  await assert.rejects(p, { code: "cancelled", name: "IdentityError" });
  assert.equal(ls.getItem("capable.identity.v1"), null);
  assert.equal(id.current(), null);
});

test("wallet(): the host's provider inside a host; else EIP-6963, else window.ethereum, else null", { timeout: 10_000 }, async () => {
  const host = { request: async () => ["0xabc"] };
  const a = fakeSdk({ provider: host });
  setup({ sdk: a.sdk });
  assert.equal(await id.wallet(), host);
  assert.equal(a.calls.getEthereumProvider, 1);

  const none = fakeSdk({ provider: null }); // a host without a wallet capability
  setup({ sdk: none.sdk });
  const announced = { request: async () => null };
  win.addEventListener("eip6963:requestProvider", () => {
    win.dispatchEvent(Object.assign(new Event("eip6963:announceProvider"), { detail: { info: { name: "w" }, provider: announced } }));
  });
  assert.equal(await id.wallet(), announced, "a host without a wallet falls back to announced wallets");
});

test("share(): the host's compose sheet with the text and the link; never window.open; never posts", { timeout: 10_000 }, async () => {
  const { sdk, calls } = fakeSdk();
  setup({ sdk });
  await id.share("I finished a lesson", "https://p-u-c.github.io/Capable/#/passport");
  assert.deepEqual(calls.compose, [{ text: "I finished a lesson", embeds: ["https://p-u-c.github.io/Capable/#/passport"] }]);
  await id.share("no link", "javascript:alert(1)");
  assert.deepEqual(calls.compose[1], { text: "no link", embeds: [] }, "a non-https link is left out");
  assert.deepEqual(win.opened, []);
  assert.deepEqual(fetches, []);
});

// ---- the same calls on the plain web ----

test("web share(): opens the compose URL in a new tab, synchronously, noopener, encoded", { timeout: 10_000 }, async () => {
  const { sdk } = fakeSdk();
  setup({ framed: false, sdk });
  const p = id.share("Stamped: SOVEREIGN & more #1 ?=", "https://p-u-c.github.io/Capable/#/p/0xabc");
  assert.equal(win.opened.length, 1, "opened before any await, inside the tap's user gesture");
  await p;
  const [url, target, features] = win.opened[0];
  assert.equal(url, "https://farcaster.xyz/~/compose?text=Stamped%3A%20SOVEREIGN%20%26%20more%20%231%20%3F%3D&embeds[]=https%3A%2F%2Fp-u-c.github.io%2FCapable%2F%23%2Fp%2F0xabc");
  assert.equal(target, "_blank");
  assert.match(features, /noopener/);
  assert.equal(loads.miniapp, 0);
  assert.deepEqual(fetches, [], "never posts");
  id.share("x", "data:text/html,hi");
  assert.equal(win.opened[1][0], "https://farcaster.xyz/~/compose?text=x", "bad links are dropped");
  assert.equal(id.composeUrl("a b", "https://e.example/"), "https://farcaster.xyz/~/compose?text=a%20b&embeds[]=https%3A%2F%2Fe.example%2F");
});

test("web wallet(): the first EIP-6963 announcement wins; then window.ethereum; then null after 300 ms", { timeout: 10_000 }, async () => {
  setup({ framed: false, sdk: fakeSdk().sdk });
  const first = { request: async () => 1 };
  const second = { request: async () => 2 };
  const requests = [];
  const answer = () => {
    requests.push(1);
    for (const provider of [first, second]) win.dispatchEvent(Object.assign(new Event("eip6963:announceProvider"), { detail: Object.freeze({ info: { uuid: "u", name: "n", icon: "data:,", rdns: "x" }, provider }) }));
  };
  win.addEventListener("eip6963:requestProvider", answer);
  assert.equal(await id.wallet(), first);
  assert.equal(requests.length, 1);
  win.removeEventListener("eip6963:requestProvider", answer);

  const legacy = { request: async () => 3 };
  win.ethereum = legacy;
  assert.equal(await id.wallet(), legacy, "window.ethereum when nobody announces");

  win.ethereum = { notAProvider: true };
  const t0 = Date.now();
  assert.equal(await id.wallet(), null);
  const took = Date.now() - t0;
  assert.ok(took >= 280 && took < 2000, `waited ${took} ms`);
  assert.equal(loads.miniapp, 0, "no SDK on the plain web");

  // a late announcement within the window still counts; garbage is ignored
  delete win.ethereum;
  win.addEventListener("eip6963:requestProvider", () => {
    win.dispatchEvent(Object.assign(new Event("eip6963:announceProvider"), { detail: { provider: { request: "nope" } } }));
    setTimeout(() => win.dispatchEvent(Object.assign(new Event("eip6963:announceProvider"), { detail: { provider: second } })), 50);
  });
  assert.equal(await id.wallet(), second);
});

test("the module exposes exactly the contract's IdentityAPI", { timeout: 10_000 }, () => {
  assert.deepEqual(Object.keys(id.identity).sort(), ["current", "isMiniApp", "onChange", "ready", "share", "signIn", "signOut", "wallet"]);
  for (const f of Object.values(id.identity)) assert.equal(typeof f, "function");
});
