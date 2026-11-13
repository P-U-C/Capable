// I1, against the real SDK: @farcaster/miniapp-sdk 0.4.0 is loaded through the
// module's own lazy path and talks to a simulated host over its real wire
// (comlink on postMessage between this "iframe" and its parent). Proves the
// module uses the SDK as the SDK actually works: detection through the host's
// context, ready(), the context user, composeCast and the host's EIP-1193
// provider. No network.
import test from "node:test";
import assert from "node:assert/strict";
import { expose } from "comlink/dist/esm/comlink.mjs";

const define = (name, value) => Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });

// The page lives in an iframe: window.parent is the host. The SDK computes its
// endpoint when it is first imported, so the globals exist before that.
const page = new EventTarget();
const hostListeners = new Set();
const HOST_ORIGIN = "https://farcaster.xyz";
page.parent = {
  postMessage(data) {
    const ev = { data: structuredClone(data), origin: "https://p-u-c.github.io" };
    setTimeout(() => hostListeners.forEach((l) => l(ev)), 0);
  },
};
define("window", page);
define("addEventListener", page.addEventListener.bind(page));
define("removeEventListener", page.removeEventListener.bind(page));
const mem = new Map();
define("localStorage", { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => void mem.set(k, String(v)), removeItem: (k) => void mem.delete(k) });
const fetched = [];
define("fetch", async (u) => {
  fetched.push(String(u));
  throw new Error("no network");
});

const calls = { ready: [], compose: [], rpc: [], signIn: 0 };
const host = {
  context: { user: { fid: 3621, username: "horsefacts.eth", displayName: "horsefacts", pfpUrl: "https://i.imgur.com/mEd8pBk.png" }, client: { clientFid: 9152, added: false } },
  ready(opts) {
    calls.ready.push(opts ?? null);
  },
  composeCast(opts) {
    calls.compose.push(opts);
    return { cast: null };
  },
  signIn() {
    calls.signIn++;
    return { error: { type: "rejected_by_user" } };
  },
  getCapabilities() {
    return ["actions.ready", "actions.composeCast", "wallet.getEthereumProvider"];
  },
  ethProviderRequestV2(req) {
    calls.rpc.push(req.method);
    return { jsonrpc: "2.0", id: req.id, result: req.method === "eth_chainId" ? "0x2105" : null };
  },
};
expose(
  host,
  {
    postMessage(data) {
      const ev = new MessageEvent("message", { data: structuredClone(data), origin: HOST_ORIGIN });
      setTimeout(() => page.dispatchEvent(ev), 0);
    },
    addEventListener: (_t, l) => hostListeners.add(l),
    removeEventListener: (_t, l) => hostListeners.delete(l),
  },
  ["*"],
);

const id = await import("../src/identity/index.mjs");
test.after(() => {
  id._reset();
  for (const k of ["window", "addEventListener", "removeEventListener", "localStorage", "fetch"]) delete globalThis[k];
});

test("the real SDK, a simulated host: detect, ready, context user, compose, host wallet", { timeout: 10_000 }, async () => {
  id._reset(); // the module's own loaders: the real SDK through ./lazy-miniapp.mjs
  assert.equal(await id.isMiniApp(), true);

  await id.ready();
  assert.equal(calls.ready.length, 1, "sdk.actions.ready() reached the host");

  const seen = [];
  id.onChange((v) => seen.push(v?.fid ?? null));
  const me = await id.signIn();
  assert.deepEqual({ ...me, signedInAt: "t" }, { fid: 3621, username: "horsefacts.eth", displayName: "horsefacts", pfpUrl: "https://i.imgur.com/mEd8pBk.png", source: "miniapp", signedInAt: "t" });
  assert.equal(calls.signIn, 0, "the host's sign-in prompt is never used");
  assert.deepEqual(seen, [3621]);
  assert.deepEqual(JSON.parse(mem.get("capable.identity.v1")).fid, 3621);

  await id.share("Stamped: CIVIL", "https://p-u-c.github.io/Capable/#/passport");
  assert.deepEqual(calls.compose, [{ text: "Stamped: CIVIL", embeds: ["https://p-u-c.github.io/Capable/#/passport"] }]);

  const provider = await id.wallet();
  assert.equal(typeof provider?.request, "function");
  assert.equal(await provider.request({ method: "eth_chainId" }), "0x2105", "requests go to the host's wallet");
  assert.deepEqual(calls.rpc, ["eth_chainId"]);

  id.signOut();
  assert.equal(id.current(), null);
  assert.deepEqual(fetched, [], "no network");
});
