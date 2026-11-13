// I2 — web Sign In With Farcaster. The real @farcaster/auth-client runs
// (channel, status, SIWE parsing, nonce and domain checks, signature recovery)
// against a fake relay behind `fetch` and a fake Optimism verifier (who owns
// which fid). The "client app" signs with throwaway keys generated in memory
// for each run; no key is stored anywhere and nothing touches the network.
// Every failure path is checked to store nothing and announce nothing.
import test from "node:test";
import assert from "node:assert/strict";
import * as realAuth from "@farcaster/auth-client";
import { createPublicClient, custom } from "viem";
import { optimism } from "viem/chains";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import * as id from "../src/identity/index.mjs";

const KEY = "capable.identity.v1";
const RELAY = "https://relay.farcaster.xyz";
const define = (name, value) => Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// The person: fid 6841, signs with their custody key. A stranger's key owns no fid.
const custody = privateKeyToAccount(generatePrivateKey());
const stranger = privateKeyToAccount(generatePrivateKey());
const FID = 6841;
const owners = new Map([[custody.address.toLowerCase(), BigInt(FID)]]);
const PROFILE = {
  username: "deodad",
  displayName: "Tony",
  pfpUrl: "https://i.imgur.com/dMoIan7.jpg",
  bio: "not stored",
  verifications: ["0x8fc5d6afe572fefc4ec153587b63ce543f6fa2ea", "7nYBm5qH6vq1v5Dk8jJ1Y5Wk7Mq9Lr3hYhGv2s4ZpQe1", "0x86924c37a93734e8611eb081238928a9d18a63c0"],
};

/** What the person's client does when they approve: build and sign the SIWF message. */
async function approve(params, { account = custody, fid = FID, nonce = params.nonce, domain = params.domain, uri = params.siweUri, resources } = {}) {
  const wallet = realAuth.createWalletClient({ relay: RELAY, ethereum: verifier() });
  const built = wallet.buildSignInMessage({ address: account.address, fid, uri, domain, nonce, ...(resources ? { resources } : {}) });
  assert.equal(built.isError, false, String(built.error));
  return { message: built.message, signature: await account.signMessage({ message: built.message }) };
}

let rpc;
/** The Optimism side: who owns which fid. The SIWE check's eth_call answers "not a contract signature", so EOA recovery decides. */
function verifier({ getFid } = {}) {
  return {
    getFid: getFid ?? (async (address) => owners.get(address.toLowerCase()) ?? 0n),
    isValidAuthAddress: async () => false,
    publicClient: createPublicClient({
      chain: optimism,
      transport: custom({
        async request({ method }) {
          rpc.push(method);
          if (method === "eth_call") return "0x" + "0".repeat(64);
          throw new Error(`unexpected rpc ${method}`);
        },
      }),
    }),
  };
}

/**
 * A fake relay. `pending` polls answer 202, then 200 completed with what
 * `complete(params)` returns (params = what the app sent to create the channel).
 * `link(token)` replaces the channel's deep link and nothing else, so the
 * channel still works: a sign-in refused over its link is refused for that alone.
 */
function relay({ pending = 2, complete, create, status, link } = {}) {
  const r = { calls: [], channel: null, polls: 0 };
  r.fetch = async (input, init = {}) => {
    const url = String(input);
    const method = init.method || "GET";
    r.calls.push({ url, method });
    if (!url.startsWith(`${RELAY}/`)) throw new Error(`unexpected network: ${url}`);
    if (url === `${RELAY}/v1/channel` && method === "POST") {
      const params = JSON.parse(init.body);
      if (create) return create(params);
      r.channel = { token: `tok-${params.nonce.slice(0, 6)}`, params };
      const deep = link ? link(r.channel.token) : `https://farcaster.xyz/~/siwf?channelToken=${r.channel.token}`;
      return json(201, { channelToken: r.channel.token, url: deep, nonce: params.nonce });
    }
    if (url === `${RELAY}/v1/channel/status` && method === "GET") {
      assert.equal(init.headers.Authorization, `Bearer ${r.channel.token}`);
      r.polls++;
      if (status) {
        const custom = await status(r.polls, r.channel);
        if (custom) return custom;
      }
      const base = { nonce: r.channel.params.nonce, url: "https://farcaster.xyz/~/siwf", signatureParams: r.channel.params, acceptAuthAddress: true, metadata: { ip: "", userAgent: "" } };
      if (r.polls <= pending) return json(202, { ...base, state: "pending" });
      const done = complete ? await complete(r.channel.params) : { ...PROFILE, fid: FID, custody: custody.address, ...(await approve(r.channel.params)) };
      return json(200, { ...base, state: "completed", ...done });
    }
    return json(404, { error: "not found" });
  };
  return r;
}

let seen; // what the module asked of the auth client
let changes;
let ls;
function setup(r, { authModule } = {}) {
  id._reset();
  id._setTiming({ pollMs: 5, timeoutMs: 2000, verifyMs: 2000 });
  rpc = [];
  ls = new Map();
  define("localStorage", { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => void ls.set(k, String(v)), removeItem: (k) => void ls.delete(k) });
  const win = new EventTarget();
  win.parent = win; // a top-level page: the web flow
  define("window", win);
  define("location", new URL("https://p-u-c.github.io/Capable/#/passport"));
  define("fetch", r.fetch);
  seen = { connector: [], relayCfg: [], verify: [] };
  id._setLoaders({
    authClient: async () =>
      authModule ?? {
        viemConnector: (args) => {
          seen.connector.push(args);
          return verifier(seen.getFid ? { getFid: seen.getFid } : {});
        },
        createAppClient: (cfg) => {
          seen.relayCfg.push({ relay: cfg.relay });
          const client = realAuth.createAppClient(cfg);
          const verify = client.verifySignInMessage;
          client.verifySignInMessage = (args) => {
            seen.verify.push({ nonce: args.nonce, domain: args.domain });
            return verify(args);
          };
          return client;
        },
      },
    miniapp: async () => {
      throw new Error("the Mini App SDK must not load on the web");
    },
  });
  changes = [];
  id.onChange((v) => changes.push(v));
}
test.after(() => {
  id._reset();
  for (const k of ["localStorage", "window", "location", "fetch"]) delete globalThis[k];
});

/** Run a failing sign-in and check that nothing was stored or announced. */
async function fails(code, r, opts = {}, setupOpts) {
  setup(r, setupOpts);
  const before = { fid: 1, source: "miniapp", signedInAt: "2026-01-01T00:00:00Z" };
  if (opts.existing) ls.set(KEY, JSON.stringify(before));
  const err = await id.signIn(opts).then(
    () => assert.fail(`expected ${code}`),
    (e) => e,
  );
  assert.ok(err instanceof id.IdentityError, String(err));
  assert.equal(err.code, code, err.message);
  assert.ok(id.ERROR_CODES.includes(err.code));
  assert.ok(err.message.length > 10);
  if (opts.existing) assert.equal(ls.get(KEY), JSON.stringify(before), "an earlier identity is left exactly as it was");
  else assert.equal(ls.has(KEY), false, "nothing stored");
  assert.deepEqual(changes, [], "nothing announced");
  return err;
}

test("signs in: channel for this page, deep link, poll, verify with the same nonce and domain, then store", { timeout: 10_000 }, async () => {
  const r = relay({ pending: 2 });
  setup(r);
  const urls = [];
  const me = await id.signIn({ onUrl: (u) => urls.push([u, r.polls]) });

  const sent = r.channel.params;
  assert.equal(sent.domain, "p-u-c.github.io");
  assert.equal(sent.siweUri, "https://p-u-c.github.io/Capable/");
  assert.match(sent.nonce, /^[A-Za-z0-9]{16,}$/);
  assert.deepEqual(urls, [[`https://farcaster.xyz/~/siwf?channelToken=${r.channel.token}`, 0]], "the https deep link, before polling");
  assert.equal(r.polls, 3, "polled until completed");
  assert.deepEqual(seen.relayCfg, [{ relay: "https://relay.farcaster.xyz" }]);
  assert.deepEqual(seen.connector, [{ rpcUrl: "https://mainnet.optimism.io" }]);
  assert.deepEqual(seen.verify, [{ nonce: sent.nonce, domain: "p-u-c.github.io" }], "verified with our nonce and domain");

  assert.deepEqual(
    { ...me, verifications: [...me.verifications], signedInAt: "t" },
    {
      fid: FID,
      username: "deodad",
      displayName: "Tony",
      pfpUrl: "https://i.imgur.com/dMoIan7.jpg",
      source: "siwf",
      custody: custody.address,
      verifications: ["0x8fc5d6afe572fefc4ec153587b63ce543f6fa2ea", "0x86924c37a93734e8611eb081238928a9d18a63c0"],
      signedInAt: "t",
    },
  );
  assert.ok(Math.abs(Date.parse(me.signedInAt) - Date.now()) < 5000);
  assert.deepEqual(JSON.parse(ls.get(KEY)), { ...me, verifications: [...me.verifications] });
  assert.deepEqual(id.current(), me);
  assert.deepEqual(changes, [me]);
  assert.ok(r.calls.every((c) => c.url.startsWith("https://relay.farcaster.xyz/v1/")), "only the relay");
  assert.ok(rpc.every((m) => m === "eth_call"), "only the (fake) signature check");
});

test("each sign-in uses a fresh crypto-random nonce", { timeout: 10_000 }, async () => {
  const nonces = new Set();
  for (let i = 0; i < 3; i++) {
    const r = relay({ pending: 0 });
    setup(r);
    await id.signIn();
    nonces.add(r.channel.params.nonce);
  }
  assert.equal(nonces.size, 3);
  const many = new Set(Array.from({ length: 500 }, () => id.makeNonce()));
  assert.equal(many.size, 500);
  for (const n of many) assert.match(n, /^[0-9A-Za-z]{24}$/);
});

const ALNUM = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
/**
 * Stand-in bytes for crypto.getRandomValues: the first fill is all 248–255
 * (each must be thrown away: 248 = 4 × 62, so keeping them would favour
 * "0"–"7"), later fills alternate a byte to throw away with 62 + k, which
 * must come out as ALNUM[k]. Only the first `fills` calls are faked.
 */
function fakeRandom(t, fills = 2) {
  const real = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
  const calls = [];
  let k = 0;
  t.mock.method(globalThis.crypto, "getRandomValues", (buf) => {
    if (calls.length >= fills) return real(buf);
    assert.ok(buf instanceof Uint8Array, "bytes, so the rejection threshold means what it says");
    calls.push(buf.length);
    for (let i = 0; i < buf.length; i++) buf[i] = calls.length === 1 ? 248 + (i % 8) : i % 2 ? 62 + (k++ % 62) : 250;
    return buf;
  });
  t.mock.method(Math, "random", () => assert.fail("Math.random must never feed a nonce"));
  return calls;
}

test("the nonce: crypto.getRandomValues is its only source, bytes 248–255 are thrown away (no modulo bias), 24 characters of [0-9A-Za-z]", (t) => {
  const calls = fakeRandom(t);
  const n = id.makeNonce();
  assert.equal(n, ALNUM.slice(0, 24), "a byte b < 248 becomes ALNUM[b % 62], and nothing else contributes");
  assert.equal(calls.length, 2, "the first fill was all rejects, so it asked again");
  t.mock.restoreAll();

  // The real source: long enough, the right alphabet, never repeating, and every character reachable.
  const seen = new Map();
  const all = new Set();
  for (let i = 0; i < 2000; i++) {
    const x = id.makeNonce();
    assert.ok(x.length >= 16, "at least 16 characters (it is 24)");
    assert.match(x, /^[0-9A-Za-z]{24}$/);
    all.add(x);
    for (const c of x) seen.set(c, (seen.get(c) ?? 0) + 1);
  }
  assert.equal(all.size, 2000, "no two nonces alike");
  assert.equal(seen.size, 62, "all 62 characters turn up");
  const mean = (2000 * 24) / 62;
  for (const [c, count] of seen) assert.ok(count > mean / 2 && count < mean * 2, `${c}: ${count} times, expected about ${mean.toFixed(0)}`);
});

test("sign-in sends the relay the nonce made from crypto.getRandomValues", { timeout: 10_000 }, async (t) => {
  const r = relay({ pending: 0 });
  setup(r);
  const calls = fakeRandom(t);
  const me = await id.signIn();
  t.mock.restoreAll();
  assert.equal(r.channel.params.nonce, ALNUM.slice(0, 24));
  assert.ok(calls.length >= 2);
  assert.equal(me.fid, FID, "and the message signed over it verifies");
});

test("timeout: nobody approves within the time limit → timeout", { timeout: 10_000 }, async () => {
  const r = relay({ pending: Infinity });
  setup(r);
  assert.equal(id.TIMING.timeoutMs, 5 * 60 * 1000, "five minutes in the app");
  id._setTiming({ pollMs: 5, timeoutMs: 120 });
  const t0 = Date.now();
  const err = await id.signIn().catch((e) => e);
  assert.equal(err.code, "timeout");
  assert.ok(Date.now() - t0 < 3000);
  assert.ok(r.polls > 2);
  assert.equal(ls.has(KEY), false);
  assert.deepEqual(changes, []);
});

test("timeout also bounds a relay that never answers", { timeout: 10_000 }, async () => {
  const r = relay({ status: () => new Promise(() => {}) });
  setup(r);
  id._setTiming({ pollMs: 5, timeoutMs: 80 });
  const err = await id.signIn().catch((e) => e);
  assert.equal(err.code, "timeout");
  assert.equal(ls.has(KEY), false);
});

test("cancel: an aborted signal before, during polling, or during verification → cancelled", { timeout: 10_000 }, async () => {
  const pre = new AbortController();
  pre.abort();
  const r0 = relay();
  await fails("cancelled", r0, { signal: pre.signal });
  assert.equal(r0.calls.length, 0, "nothing sent");

  const during = new AbortController();
  await fails("cancelled", relay({ pending: Infinity }), { signal: during.signal, onUrl: () => setTimeout(() => during.abort(), 20) });

  const late = new AbortController();
  const slow = relay({ pending: 0 });
  await fails("cancelled", slow, { signal: late.signal, existing: true }, {
    authModule: {
      viemConnector: () => verifier({ getFid: () => new Promise((ok) => setTimeout(() => ok(BigInt(FID)), 200)) }),
      createAppClient: (cfg) => {
        const c = realAuth.createAppClient(cfg);
        const v = c.verifySignInMessage;
        c.verifySignInMessage = (a) => (setTimeout(() => late.abort(), 10), v(a));
        return c;
      },
    },
  });

  await fails("cancelled", relay(), { onUrl: () => { throw new Error("could not draw the QR code"); } });
});

test("rejected: the request comes back without a signature, or the relay closes the channel", { timeout: 10_000 }, async () => {
  await fails("rejected", relay({ complete: async () => ({ fid: FID, ...PROFILE }) }));
  await fails("rejected", relay({ complete: async (p) => ({ fid: FID, message: (await approve(p)).message }) }));
  await fails("rejected", relay({ status: (n) => (n === 2 ? json(401, { error: "Unauthorized" }) : null) }), { existing: true });
  await fails("rejected", relay({ status: () => json(404, { error: "Not found" }) }));
  await fails("rejected", relay({ create: () => json(400, { error: "bad domain" }) }));
});

test("verify-failed: wrong nonce, wrong domain, wrong page's message, signer not the owner, relay names another fid, garbage", { timeout: 10_000 }, async () => {
  const signed = (opts) => relay({ complete: async (p) => ({ ...PROFILE, fid: opts.fid ?? FID, ...(await approve(p, opts)) }) });
  let err = await fails("verify-failed", signed({ nonce: "SomeOtherNonce12345" }));
  assert.match(err.message, /nonce/i);
  err = await fails("verify-failed", signed({ domain: "evil.example" }), { existing: true });
  assert.match(err.message, /domain/i);
  // Same domain and our nonce, but signed for another project's page on the shared github.io host (review V13).
  err = await fails("verify-failed", signed({ uri: "https://p-u-c.github.io/SomeOtherProject/" }));
  assert.match(err.message, /another page/);
  err = await fails("verify-failed", signed({ uri: "https://p-u-c.github.io/Capable/other" }));
  assert.match(err.message, /another page/);
  await fails("verify-failed", signed({ account: stranger })); // stranger owns no fid
  await fails("verify-failed", signed({ fid: 1 })); // custody key, but signs for someone else's fid
  await fails("verify-failed", relay({ complete: async (p) => ({ ...PROFILE, ...(await approve(p)), fid: 99999 }) })); // relay says another fid
  await fails("verify-failed", relay({ complete: async (p) => ({ ...PROFILE, fid: FID, message: (await approve(p)).message, signature: (await approve(p, { account: stranger })).signature }) }));
  await fails("verify-failed", relay({ complete: async (p) => ({ ...PROFILE, fid: FID, message: (await approve(p)).message, signature: "0xdeadbeef" }) }));
  await fails("verify-failed", relay({ complete: async () => ({ ...PROFILE, fid: FID, message: "hello", signature: "0x" + "11".repeat(65) }) }));
  await fails("verify-failed", relay({ complete: async () => ({ ...PROFILE, fid: FID, message: "x".repeat(9000), signature: "0x11" }) }));
  await fails("verify-failed", relay({ create: (p) => json(201, { channelToken: "t", url: "https://farcaster.xyz/~/siwf?channelToken=t", nonce: "relayPickedThis1234" }) }));
});

test("a properly signed message over 8 KB is refused for its size alone, before the signature check (review V-M06)", { timeout: 10_000 }, async () => {
  const resources = (n) => Array.from({ length: n }, (_, i) => `https://example.com/r/${i}/${"x".repeat(60)}`);
  const sized = (n, out) => relay({ pending: 0, complete: async (p) => { const a = await approve(p, { resources: resources(n) }); out.size = a.message.length; return { ...PROFILE, fid: FID, ...a }; } });
  const under = {};
  setup(sized(80, under));
  const me = await id.signIn();
  assert.equal(me.fid, FID, "the library takes a long resource list, so only the size can refuse the next one");
  assert.ok(under.size > 6000 && under.size <= 8192, `${under.size}`);

  const over = {};
  const err = await fails("verify-failed", sized(100, over));
  assert.ok(over.size > 8192 && over.size < 10_000, `${over.size}`);
  assert.match(err.message, /malformed/);
  assert.deepEqual(seen.verify, [], "never handed to the signature check");
});

test("verify-failed comes from our own checks too, not only the library's", { timeout: 10_000 }, async () => {
  // A verifier that says yes to anything: our nonce/domain/fid checks must still refuse.
  const yes = (data, extra = {}) => ({
    viemConnector: () => ({}),
    createAppClient: (cfg) => {
      const c = realAuth.createAppClient({ ...cfg, ethereum: verifier() });
      c.verifySignInMessage = async () => ({ isError: false, success: true, fid: FID, authMethod: "custody", data, ...extra });
      return c;
    },
  });
  const PAGE = "https://p-u-c.github.io/Capable/";
  const ok = relay({ pending: 0, complete: async () => ({ ...PROFILE, fid: FID, message: "m", signature: "0x11" }) });
  let err = await fails("verify-failed", ok, {}, { authModule: yes({ nonce: "notOurs123456789", domain: "p-u-c.github.io", uri: PAGE, address: custody.address }) });
  assert.match(err.message, /nonce/);
  const ok2 = relay({ pending: 0, complete: async () => ({ ...PROFILE, fid: FID, message: "m", signature: "0x11" }) });
  err = await fails("verify-failed", ok2, {}, { authModule: yesWithChannelNonce(ok2, "evil.example") });
  assert.match(err.message, /domain/);
  const ok3 = relay({ pending: 0, complete: async () => ({ ...PROFILE, fid: FID, message: "m", signature: "0x11" }) });
  err = await fails("verify-failed", ok3, {}, { authModule: yesWithChannelNonce(ok3, "p-u-c.github.io", { success: false }) });
  assert.match(err.message, /did not check out/);
  const ok4 = relay({ pending: 0, complete: async () => ({ ...PROFILE, fid: FID, message: "m", signature: "0x11" }) });
  err = await fails("verify-failed", ok4, {}, { authModule: yesWithChannelNonce(ok4, "p-u-c.github.io", { fid: 0 }) });
  assert.match(err.message, /no account/);
  const ok5 = relay({ pending: 0, complete: async () => ({ ...PROFILE, fid: FID, message: "m", signature: "0x11" }) });
  err = await fails("verify-failed", ok5, {}, { authModule: yesWithChannelNonce(ok5, "p-u-c.github.io", {}, "https://p-u-c.github.io/SomeOtherProject/") });
  assert.match(err.message, /another page/);

  // Control: the same yes-to-anything verifier with our nonce, domain and page signs in.
  const ok6 = relay({ pending: 0, complete: async () => ({ ...PROFILE, fid: FID, message: "m", signature: "0x11" }) });
  setup(ok6, { authModule: yesWithChannelNonce(ok6, "p-u-c.github.io") });
  assert.equal((await id.signIn()).fid, FID);

  function yesWithChannelNonce(r, domain, extra = {}, uri = PAGE) {
    return {
      viemConnector: () => ({}),
      createAppClient: (cfg) => {
        const c = realAuth.createAppClient({ ...cfg, ethereum: verifier() });
        c.verifySignInMessage = async (a) => ({ isError: false, success: true, fid: FID, authMethod: "custody", data: { nonce: r.channel.params.nonce, domain, uri, address: custody.address }, ...extra });
        return c;
      },
    };
  }
});

test("network: relay unreachable, too many failed polls, sign-in code not loading, Optimism unreachable", { timeout: 10_000 }, async () => {
  const down = relay();
  down.fetch = async () => {
    throw new TypeError("fetch failed");
  };
  await fails("network", down, { existing: true });

  await fails("network", relay({ status: () => Promise.reject(new TypeError("fetch failed")) }));
  await fails("network", relay({ status: () => new Response("<html>bad gateway</html>", { status: 502 }) }));
  const notHttps = await fails("network", relay({ link: (t) => `farcaster://connect?channelToken=${t}` })); // a working channel: only the link is wrong (more below)
  assert.match(notHttps.message, /no https link/);
  await fails("network", relay({ create: () => json(201, { url: "https://farcaster.xyz/~/siwf" }) }));
  await fails("network", relay({ create: () => json(503, { error: "down" }) }));

  setup(relay());
  id._setLoaders({ authClient: async () => { throw new TypeError("Failed to fetch dynamically imported module"); } });
  const err = await id.signIn().catch((e) => e);
  assert.equal(err.code, "network");
  assert.equal(ls.has(KEY), false);

  const offline = relay({ pending: 0 });
  await fails("network", offline, {}, {
    authModule: {
      viemConnector: () => verifier({ getFid: async () => { throw Object.assign(new Error("HTTP request failed."), { name: "HttpRequestError" }); } }),
      createAppClient: (cfg) => realAuth.createAppClient(cfg),
    },
  });
});

test("the deep link: a known client's sign-in page for this channel is shown, re-serialised", { timeout: 10_000 }, async () => {
  for (const [link, want] of [
    [(t) => `https://farcaster.xyz/~/siwf?channelToken=${t}`, (t) => `https://farcaster.xyz/~/siwf?channelToken=${t}`], // what the relay sends today
    [(t) => `https://FARCASTER.XYZ:443/~/siwf?channelToken=${t}&nonce=abc`, (t) => `https://farcaster.xyz/~/siwf?channelToken=${t}&nonce=abc`], // extra parameters are the relay's business
  ]) {
    const r = relay({ pending: 0, link });
    setup(r);
    const shown = [];
    const me = await id.signIn({ onUrl: (u) => shown.push(u) });
    assert.equal(me.fid, FID);
    assert.deepEqual(shown, [want(r.channel.token)]);
  }
  assert.deepEqual([...id.DEEP_LINK_HOSTS], ["farcaster.xyz"], "the compose client's host, and only it");
});

test("the deep link: any other link → network before it is shown or polled, and nothing stored (review V10, V-M63)", { timeout: 20_000 }, async () => {
  // Each relay below has a working channel (the test above signs in through the
  // same fake with a good link), so only the link check can refuse it.
  const bad = [
    (t) => `farcaster://connect?channelToken=${t}`, // the README's old protocol link
    (t) => `http://farcaster.xyz/~/siwf?channelToken=${t}`,
    () => "javascript:alert(1)//https://farcaster.xyz/~/siwf",
    () => "https://evil.example/phish?x=1", // the review's probe
    (t) => `https://evil.example/~/siwf?channelToken=${t}`,
    (t) => `https://farcaster.xyz.evil.example/~/siwf?channelToken=${t}`,
    (t) => `https://farcaster.xyz@evil.example/~/siwf?channelToken=${t}`,
    (t) => `https://evil.example@farcaster.xyz/~/siwf?channelToken=${t}`,
    (t) => `https://www.farcaster.xyz/~/siwf?channelToken=${t}`,
    (t) => `https://warpcast.com/~/siwf?channelToken=${t}`, // the relay's default before the rename; not shipped (docs/IDENTITY.md)
    (t) => `https://client.warpcast.com/~/siwf?channelToken=${t}`,
    (t) => `https://client.farcaster.xyz/~/siwf?channelToken=${t}`,
    (t) => `https://farcaster.xyz./~/siwf?channelToken=${t}`,
    (t) => `https://farcaster.xyz:8443/~/siwf?channelToken=${t}`,
    (t) => `https://farcaster.xyz/someone?channelToken=${t}`, // a page anyone can fill on the right host
    (t) => `https://farcaster.xyz/~/compose?text=claim&channelToken=${t}`,
    (t) => `https://farcaster.xyz/~/siwf/?channelToken=${t}`,
    (t) => `https://farcaster.xyz/~/siwf?channelToken=${t}#x`,
    () => "https://farcaster.xyz/~/siwf",
    () => "https://farcaster.xyz/~/siwf?channelToken=someoneElses",
    (t) => `https://farcaster.xyz/~/siwf?channelToken=${t}&channelToken=someoneElses`,
    (t) => `https://farcaster.xyz/~/siwf?channelToken=${t}&pad=${"a".repeat(1024)}`, // over 1024 characters
  ];
  for (const link of bad) {
    const r = relay({ pending: 0, link });
    const shown = [];
    const err = await fails("network", r, { onUrl: (u) => shown.push(u) });
    assert.match(err.message, /link/, `${link("TOKEN")}: ${err.message}`);
    assert.deepEqual(shown, [], `${link("TOKEN")} was never shown`);
    assert.equal(r.polls, 0, `${link("TOKEN")}: refused before polling`);
  }
});

test("the longest deep link accepted (1024 characters) still draws a QR code the app admits (review V21)", async () => {
  const { svgMarkup } = await import("../src/html.mjs");
  const head = "https://farcaster.xyz/~/siwf?channelToken=T&pad=";
  let seed = 7;
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-._~";
  let pad = "";
  while (head.length + pad.length < 1024) pad += chars[(seed = (seed * 1103515245 + 12345) % 2 ** 31) % chars.length];
  const { checkDeepLink } = await import("../src/identity/flows.mjs");
  assert.equal(checkDeepLink(head + pad, "T"), head + pad);
  assert.equal(checkDeepLink(head + pad + "a", "T"), null);
  assert.equal(checkDeepLink((head + pad).replace("farcaster.xyz/", "FARCASTER.XYZ:443/"), "T"), head + pad, "the length that counts is the link as shown");
  assert.equal(checkDeepLink("https://farcaster.xyz/~/siwf?channelToken=", ""), null, "no channel, no link");
  const svg = id.qrSvg(head + pad);
  assert.ok(svg.length < 64 * 1024, `${svg.length} characters of SVG`);
  assert.notEqual(String(svgMarkup(svg, "qr")), "", "admitted as markup, so the QR code is not blank");
});

test("network blips while waiting are tolerated: two failed polls, then approval", { timeout: 10_000 }, async () => {
  const r = relay({ pending: 1, status: (n) => (n === 2 || n === 3 ? Promise.reject(new TypeError("fetch failed")) : null) });
  setup(r);
  const me = await id.signIn();
  assert.equal(me.fid, FID);
  assert.equal(r.polls, 4);
});

test("an auth address (not the custody key) may sign; custody is then left out", { timeout: 10_000 }, async () => {
  const appKey = privateKeyToAccount(generatePrivateKey());
  const r = relay({ pending: 0, complete: async (p) => ({ ...PROFILE, fid: FID, ...(await approve(p, { account: appKey })) }) });
  setup(r, {
    authModule: {
      viemConnector: () => ({ ...verifier(), isValidAuthAddress: async (a, fid) => a.toLowerCase() === appKey.address.toLowerCase() && fid === BigInt(FID) }),
      createAppClient: (cfg) => realAuth.createAppClient(cfg),
    },
  });
  const me = await id.signIn();
  assert.equal(me.fid, FID);
  assert.equal(me.custody, undefined);
});

test("hostile profile data from the relay is dropped; the verified fid is kept", { timeout: 10_000 }, async () => {
  const r = relay({ pending: 0, complete: async (p) => ({ fid: FID, ...(await approve(p)), username: "x".repeat(10240), displayName: "a‮b", pfpUrl: "javascript:alert(1)", verifications: "0xabc", custody: "not checked" }) });
  setup(r);
  const me = await id.signIn();
  assert.deepEqual(Object.keys(me).sort(), ["custody", "fid", "signedInAt", "source"]);
  assert.equal(me.custody, custody.address, "custody is the verified signer, not the relay's claim");
});

test("a page without a web origin cannot sign in", { timeout: 10_000 }, async () => {
  setup(relay());
  define("location", { host: "", origin: "null", pathname: "/x" });
  const err = await id.signIn().catch((e) => e);
  assert.equal(err.code, "rejected");
  assert.equal(ls.has(KEY), false);
});
