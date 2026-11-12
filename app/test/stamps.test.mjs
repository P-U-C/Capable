// S3: the stamps module (contract/citizen.d.ts StampsAPI). No network: a mocked
// EIP-1193 wallet and a mocked fetch. Chain truth comes from chain/fixtures/rehearsal.json,
// written by `cd chain && npm run rehearse` from a real mint on a local anvil.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decodeFunctionData, encodePacked, keccak256 as viemKeccak } from "viem";
import { build } from "esbuild";
import { badgeSvg } from "../../contract/badge-art.mjs";
import * as defaultApi from "../src/stamps/index.mjs";
import { CHAINS, addChainParams, createStamps, stampSeed, stampTrait } from "../src/stamps/index.mjs";
import { STAMPS_ABI } from "../src/stamps/abi.mjs";
import { keccak256, toHex } from "../src/stamps/keccak.mjs";
import { APP_DIR, ROOT, fixture } from "./helpers.mjs";

const REHEARSAL = JSON.parse(readFileSync(join(ROOT, "chain/fixtures/rehearsal.json"), "utf8"));
const CONTRACT = REHEARSAL.contract;
const appWith = (stamps) => ({ ...fixture(), stamps });
const BASE_APP = appWith({ chainId: 8453, address: CONTRACT });
const HASH = "0x" + "ab".repeat(32);
const HOLDER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

/** A deterministic PRNG for test inputs. */
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ───────────────────────── keccak and seed ─────────────────────────

test("keccak256 (sync, no deps) equals viem's on every length 0–420 and 1,000 random messages", () => {
  const r = prng(42);
  const bytes = (n) => Uint8Array.from({ length: n }, () => Math.floor(r() * 256));
  for (let n = 0; n <= 420; n++) {
    const b = bytes(n);
    assert.equal(toHex(keccak256(b)), viemKeccak(b), `length ${n}`);
  }
  for (let k = 0; k < 1000; k++) {
    const b = bytes(Math.floor(r() * 700));
    assert.equal(toHex(keccak256(b)), viemKeccak(b));
  }
  assert.equal(toHex(keccak256(new Uint8Array())), "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470");
});

test("stampSeed = keccak256(abi.encodePacked(holder, uint8 stampId, uint256 tokenId)), checked against viem and the chain", () => {
  const r = prng(7);
  for (let k = 0; k < 1000; k++) {
    const holder = "0x" + Array.from({ length: 20 }, () => Math.floor(r() * 256).toString(16).padStart(2, "0")).join("");
    const stampId = Math.floor(r() * 256);
    const tokenId = k % 10 === 0 ? [0, 1, 255, 256, 65535, 999_999_999, Number.MAX_SAFE_INTEGER][k % 7] : Math.floor(r() * 1e9);
    assert.equal(stampSeed(holder, stampId, tokenId), viemKeccak(encodePacked(["address", "uint8", "uint256"], [holder, stampId, BigInt(tokenId)])));
  }
  for (const s of REHEARSAL.stamps) assert.equal(stampSeed(s.holder, s.stampId, s.tokenId), s.seed, "seedOf() on the local chain");
  assert.equal(stampSeed(HOLDER.toLowerCase(), 0, 1), stampSeed(HOLDER, 0, 1), "checksum case does not matter");
  assert.throws(() => stampSeed("0x1234", 0, 1));
  assert.throws(() => stampSeed(HOLDER, 256, 1));
  assert.throws(() => stampSeed(HOLDER, 0, -1));
});

// ───────────────────────── config ─────────────────────────

test("config: from app.stamps; null when not deployed or not valid (fail closed)", () => {
  const s = createStamps();
  assert.equal(s.config(fixture()), null, "no stamps block");
  assert.equal(s.config(appWith({ chainId: 8453, address: null })), null, "the shipped state: not deployed");
  assert.equal(s.config(appWith(null)), null);
  assert.equal(s.config(null), null);
  for (const address of ["0x123", "5FbDB2315678afecb367f032d93F642f64180aa3", "0x" + "0".repeat(40), "0x" + "g".repeat(40), ` ${CONTRACT}`, 42]) {
    assert.equal(s.config(appWith({ chainId: 8453, address })), null, String(address));
  }
  assert.equal(s.config(appWith({ chainId: 1, address: CONTRACT })), null, "only Base (and Base Sepolia for a dry run)");
  assert.equal(s.config(appWith({ chainId: "8453", address: CONTRACT })), null);
  assert.deepEqual(s.config(BASE_APP), { chainId: 8453, address: CONTRACT.toLowerCase() });
  assert.deepEqual(s.config(appWith({ chainId: 84532, address: CONTRACT })), { chainId: 84532, address: CONTRACT.toLowerCase() });
  const shipped = JSON.parse(readFileSync(join(ROOT, "content/app.meta.json"), "utf8"));
  assert.equal(s.config({ stamps: shipped.stamps }), null, "content/app.meta.json ships with address null");
  assert.equal(typeof defaultApi.config, "function");
  for (const k of ["config", "owned", "preview", "mint"]) assert.equal(typeof defaultApi[k], "function", k);
});

// ───────────────────────── preview ─────────────────────────

test("preview() equals tokenURI's SVG for stamps minted on a local chain (chain/fixtures/rehearsal.json)", () => {
  const s = createStamps();
  assert.equal(REHEARSAL.stamps.length, 3);
  for (const m of REHEARSAL.stamps) {
    const svg = s.preview({ holder: m.holder, stampId: m.stampId, tokenId: m.tokenId, trait: m.trait });
    const json = JSON.parse(Buffer.from(m.tokenURI.replace("data:application/json;base64,", ""), "base64").toString("utf8"));
    const onChain = Buffer.from(json.image.replace("data:image/svg+xml;base64,", ""), "base64").toString("utf8");
    assert.equal(svg, onChain, `token ${m.tokenId}`);
    assert.equal(svg, m.svg);
  }
});

test("preview() takes the app's trait as stampTrait() maps it, and refuses bad input", () => {
  const s = createStamps();
  const traits = JSON.parse(readFileSync(join(ROOT, "content/app.meta.json"), "utf8")).traits;
  const m = REHEARSAL.stamps[0];
  const appTrait = traits.find((t) => t.stampId === m.stampId);
  assert.deepEqual(stampTrait(appTrait), m.trait);
  assert.equal(s.preview({ holder: m.holder, stampId: m.stampId, tokenId: m.tokenId, trait: stampTrait(appTrait) }), m.svg);
  assert.equal(s.preview({ holder: m.holder, stampId: m.stampId, tokenId: m.tokenId, trait: appTrait }), m.svg, "a 'Sovereign' name is printed in capitals");
  assert.equal(
    s.preview({ holder: HOLDER, stampId: 3, tokenId: 0, trait: m.trait }),
    badgeSvg({ seed: viemKeccak(encodePacked(["address", "uint8", "uint256"], [HOLDER, 3, 0n])), ...m.trait, serial: 0 }),
  );
  assert.throws(() => s.preview({ holder: "nope", stampId: 0, tokenId: 1, trait: m.trait }));
  assert.throws(() => s.preview({ holder: HOLDER, stampId: 0, tokenId: 1e9, trait: m.trait }), /tokenId/);
  assert.throws(() => s.preview({ holder: HOLDER, stampId: 0, tokenId: 1, trait: { ...m.trait, color: "red" } }));
  assert.throws(() => s.preview({ holder: HOLDER, stampId: 0, tokenId: 1, trait: { ...m.trait, name: "<script>" } }));
});

// ───────────────────────── owned ─────────────────────────

/** A fetch that answers eth_call from the rehearsal's recorded answers (real chain bytes). */
function replayFetch(log = []) {
  return async (url, init) => {
    const req = JSON.parse(init.body);
    log.push({ url, init, req });
    assert.equal(init.method, "POST");
    assert.equal(req.jsonrpc, "2.0");
    assert.equal(req.method, "eth_call");
    assert.equal(req.params[1], "latest");
    assert.equal(req.params[0].to, CONTRACT.toLowerCase());
    const hit = REHEARSAL.calls.find((c) => c.data === req.params[0].data);
    assert.ok(hit, `unrecorded call ${req.params[0].data}`);
    return { ok: true, status: 200, json: async () => ({ jsonrpc: "2.0", id: req.id, result: hit.result }) };
  };
}

test("owned(): reads tokensOf + stampOf over JSON-RPC (real answers from the local chain), sorted by tokenId", async () => {
  const log = [];
  const s = createStamps({ rpcUrl: "https://rpc.test/", fetch: replayFetch(log) });
  s.config(BASE_APP);
  assert.deepEqual(await s.owned(HOLDER), { stamps: [{ tokenId: 1, stampId: 0 }, { tokenId: 2, stampId: 2 }] });
  assert.deepEqual(await s.owned("0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"), { stamps: [{ tokenId: 3, stampId: 3 }] });
  assert.deepEqual(await s.owned("0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65"), { stamps: [] });
  assert.ok(log.every((l) => l.url === "https://rpc.test/"));
  assert.equal(log[0].init.credentials, "omit");
  assert.ok(log.every((l) => !("from" in l.req.params[0])), "a read never names a sender");
});

test("owned(): uses the public Base RPC by default, and the app passed in opts", async () => {
  const urls = [];
  const s = createStamps({ fetch: async (url, init) => (urls.push(url), replayFetch()(url, init)) });
  assert.deepEqual(await s.owned(HOLDER), { stamps: [], error: "stamps are not on chain yet" }, "before config(): nothing to read");
  assert.equal(urls.length, 0);
  assert.equal((await s.owned(HOLDER, { app: BASE_APP })).stamps.length, 2);
  assert.ok(urls.every((u) => u === CHAINS[8453].rpc && u === "https://mainnet.base.org"));
});

test("owned(): never throws; [] with a reason on every failure", async () => {
  const answer = (body, { ok = true, status = 200 } = {}) => async () => ({ ok, status, json: async () => body });
  const cases = [
    ["HTTP 500", answer({}, { ok: false, status: 500 }), /HTTP 500/],
    ["RPC error", answer({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: "boom" } }), /refused/],
    ["no contract", answer({ jsonrpc: "2.0", id: 1, result: "0x" }), /no stamps contract/],
    ["not hex", answer({ jsonrpc: "2.0", id: 1, result: "<html>" }), /no data/],
    ["garbage", answer({ jsonrpc: "2.0", id: 1, result: "0x1234" }), /./],
    ["offline", async () => { throw new TypeError("fetch failed"); }, /fetch failed/],
    ["bad json", async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("Unexpected token"); } }), /Unexpected token/],
  ];
  for (const [label, f, reason] of cases) {
    const s = createStamps({ fetch: f });
    s.config(BASE_APP);
    const r = await s.owned(HOLDER);
    assert.deepEqual(r.stamps, [], label);
    assert.match(r.error, reason, label);
  }
  const s = createStamps({ fetch: async () => assert.fail("no request for a bad address") });
  s.config(BASE_APP);
  assert.deepEqual(await s.owned("0xnope"), { stamps: [], error: "not an address" });
  // an absurd answer (a token id beyond the contract's cap) is rejected, not shown
  const huge = "0x" + [32n, 1n, 10n ** 12n].map((n) => n.toString(16).padStart(64, "0")).join("");
  const s2 = createStamps({ fetch: answer({ jsonrpc: "2.0", id: 1, result: huge }) });
  s2.config(BASE_APP);
  assert.match((await s2.owned(HOLDER)).error, /unexpected/);
});

// ───────────────────────── mint ─────────────────────────

/** A scripted EIP-1193 wallet. `on[method]` answers (value, or a function of params); records every call. */
function wallet(on = {}) {
  const calls = [];
  let chain = on.chainId ?? "0x2105";
  return {
    calls,
    methods: () => calls.map((c) => c.method),
    async request({ method, params }) {
      calls.push({ method, params });
      const h = on[method];
      if (typeof h === "function") return h(params, { setChain: (c) => (chain = c) });
      if (h instanceof Error || (h && typeof h === "object" && "code" in h && !Array.isArray(h))) throw h;
      if (h !== undefined) return h;
      if (method === "eth_chainId") return chain;
      if (method === "wallet_switchEthereumChain") return (chain = params[0].chainId), null;
      if (method === "wallet_addEthereumChain") return (chain = params[0].chainId), null;
      if (method === "eth_requestAccounts") return [HOLDER];
      if (method === "eth_sendTransaction") return HASH;
      throw Object.assign(new Error(`unexpected ${method}`), { code: 4200 });
    },
  };
}
const rpcError = (code, message = "x", extra = {}) => Object.assign(new Error(message), { code, ...extra });

test("mint(): already on Base → request accounts → ONE eth_sendTransaction of mint(stampId) → tx hash + Basescan link", async () => {
  const s = createStamps();
  const w = wallet();
  const r = await s.mint({ provider: w, stampId: 0, app: BASE_APP });
  assert.deepEqual(r, { txHash: HASH, explorerUrl: `https://basescan.org/tx/${HASH}` });
  assert.deepEqual(w.methods(), ["eth_chainId", "eth_requestAccounts", "eth_sendTransaction"]);
  const [tx] = w.calls[2].params;
  assert.deepEqual(Object.keys(tx).sort(), ["data", "from", "to"]);
  assert.equal(tx.from, HOLDER);
  assert.equal(tx.to, CONTRACT.toLowerCase());
  assert.equal(tx.data, REHEARSAL.stamps[0].mintData, "the exact calldata the local chain accepted");
  assert.deepEqual(decodeFunctionData({ abi: STAMPS_ABI, data: tx.data }), { functionName: "mint", args: [0] });
  const r2 = await s.mint({ provider: wallet(), stampId: 2, app: BASE_APP });
  assert.equal(r2.txHash, HASH);
});

test("mint(): on another chain → wallet_switchEthereumChain(0x2105) → confirm → accounts → send", async () => {
  const w = wallet({ chainId: "0x1" });
  await createStamps().mint({ provider: w, stampId: 3, app: BASE_APP });
  assert.deepEqual(w.methods(), ["eth_chainId", "wallet_switchEthereumChain", "eth_chainId", "eth_requestAccounts", "eth_sendTransaction"]);
  assert.deepEqual(w.calls[1].params, [{ chainId: "0x2105" }]);
  assert.equal(w.calls[4].params[0].data, REHEARSAL.stamps[2].mintData);
});

test("mint(): Base unknown to the wallet (4902, also nested as MetaMask mobile does) → wallet_addEthereumChain with Base's parameters", async () => {
  for (const err of [rpcError(4902), rpcError(-32603, "internal", { data: { originalError: { code: 4902 } } })]) {
    const w = wallet({ chainId: "0x1", wallet_switchEthereumChain: err, wallet_addEthereumChain: (p, ctl) => (ctl.setChain(p[0].chainId), null) });
    const r = await createStamps().mint({ provider: w, stampId: 1, app: BASE_APP });
    assert.equal(r.txHash, HASH);
    assert.deepEqual(w.methods(), ["eth_chainId", "wallet_switchEthereumChain", "wallet_addEthereumChain", "eth_chainId", "eth_chainId", "eth_requestAccounts", "eth_sendTransaction"]);
    assert.deepEqual(w.calls[2].params, [
      { chainId: "0x2105", chainName: "Base", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: ["https://mainnet.base.org"], blockExplorerUrls: ["https://basescan.org"] },
    ]);
  }
  // a wallet that adds the chain but does not switch to it gets one more switch request
  const w = wallet({ chainId: "0x1", wallet_switchEthereumChain: (() => { let n = 0; return (p, ctl) => { if (n++ === 0) throw rpcError(4902); ctl.setChain(p[0].chainId); return null; }; })(), wallet_addEthereumChain: null });
  await createStamps().mint({ provider: w, stampId: 1, app: BASE_APP });
  assert.deepEqual(w.methods(), ["eth_chainId", "wallet_switchEthereumChain", "wallet_addEthereumChain", "eth_chainId", "wallet_switchEthereumChain", "eth_chainId", "eth_requestAccounts", "eth_sendTransaction"]);
});

test("mint(): the person saying no (4001) at any step → Error code 'rejected', and nothing is sent after it", async () => {
  const steps = {
    wallet_switchEthereumChain: ["eth_chainId", "wallet_switchEthereumChain"],
    wallet_addEthereumChain: ["eth_chainId", "wallet_switchEthereumChain", "wallet_addEthereumChain"],
    eth_requestAccounts: ["eth_chainId", "wallet_switchEthereumChain", "eth_chainId", "eth_requestAccounts"],
    eth_sendTransaction: ["eth_chainId", "wallet_switchEthereumChain", "eth_chainId", "eth_requestAccounts", "eth_sendTransaction"],
  };
  for (const [step, expected] of Object.entries(steps)) {
    const on = { chainId: "0x1", [step]: rpcError(4001, "User rejected the request.") };
    if (step === "wallet_addEthereumChain") on.wallet_switchEthereumChain = rpcError(4902);
    const w = wallet(on);
    await assert.rejects(createStamps().mint({ provider: w, stampId: 0, app: BASE_APP }), (e) => e.code === "rejected", step);
    assert.deepEqual(w.methods(), expected, step);
  }
});

test("mint(): never resends: a failed or duplicate request sends exactly one transaction", async () => {
  // the wallet errors after (maybe) broadcasting: no retry, a clear code
  const w = wallet({ eth_sendTransaction: rpcError(-32603, "request timed out") });
  const s = createStamps();
  await assert.rejects(s.mint({ provider: w, stampId: 0, app: BASE_APP }), (e) => e.code === "wallet" && /timed out/.test(e.message));
  assert.equal(w.methods().filter((m) => m === "eth_sendTransaction").length, 1);

  // a double tap while the first is open gets the same promise, not a second send
  let release;
  const slow = wallet({ eth_sendTransaction: () => new Promise((res) => (release = () => res(HASH))) });
  const a = s.mint({ provider: slow, stampId: 1, app: BASE_APP });
  const b = s.mint({ provider: slow, stampId: 1, app: BASE_APP });
  assert.equal(a, b);
  await new Promise((r) => setTimeout(r, 20));
  release();
  assert.deepEqual(await a, await b);
  assert.equal(slow.methods().filter((m) => m === "eth_sendTransaction").length, 1);

  // a wallet that answers with something other than a hash: an error, not a retry
  const odd = wallet({ eth_sendTransaction: "ok!" });
  await assert.rejects(s.mint({ provider: odd, stampId: 2, app: BASE_APP }), (e) => e.code === "wallet");
  assert.equal(odd.methods().filter((m) => m === "eth_sendTransaction").length, 1);
});

test("mint(): refuses before touching the wallet when not configured, no wallet, a bad stampId, or offline", async () => {
  const w = wallet();
  const s = createStamps();
  await assert.rejects(s.mint({ provider: w, stampId: 0, app: fixture() }), (e) => e.code === "not-configured");
  await assert.rejects(s.mint({ provider: w, stampId: 0, app: appWith({ chainId: 8453, address: null }) }), (e) => e.code === "not-configured");
  await assert.rejects(s.mint({ provider: null, stampId: 0, app: BASE_APP }), (e) => e.code === "no-wallet");
  for (const stampId of [-1, 256, 1.5, "0", null]) await assert.rejects(s.mint({ provider: w, stampId, app: BASE_APP }), (e) => e.code === "bad-stamp", String(stampId));
  const offline = createStamps({ loadCodec: () => Promise.reject(new TypeError("Failed to fetch dynamically imported module")) });
  await assert.rejects(offline.mint({ provider: w, stampId: 0, app: BASE_APP }), (e) => e.code === "offline");
  assert.equal(w.calls.length, 0);
});

test("mint(): a wallet that will not reach Base → 'wrong-chain', and no transaction", async () => {
  const unsupported = wallet({ chainId: "0x1", wallet_switchEthereumChain: rpcError(4200, "unsupported method") });
  await assert.rejects(createStamps().mint({ provider: unsupported, stampId: 0, app: BASE_APP }), (e) => e.code === "wrong-chain");
  assert.ok(!unsupported.methods().includes("eth_sendTransaction"));
  const stuck = wallet({ chainId: "0x1", wallet_switchEthereumChain: null }); // says yes, stays on chain 1
  await assert.rejects(createStamps().mint({ provider: stuck, stampId: 0, app: BASE_APP }), (e) => e.code === "wrong-chain");
  assert.ok(!stuck.methods().includes("eth_sendTransaction"));
  const noAccount = wallet({ eth_requestAccounts: [] });
  await assert.rejects(createStamps().mint({ provider: noAccount, stampId: 0, app: BASE_APP }), (e) => e.code === "no-account");
  assert.ok(!noAccount.methods().includes("eth_sendTransaction"));
});

test("mint(): Base Sepolia (the owner's dry run) uses 0x14a34 and sepolia.basescan.org", async () => {
  const w = wallet({ chainId: "0x2105" });
  const r = await createStamps().mint({ provider: w, stampId: 0, app: appWith({ chainId: 84532, address: CONTRACT }) });
  assert.equal(r.explorerUrl, `https://sepolia.basescan.org/tx/${HASH}`);
  assert.deepEqual(w.calls[1].params, [{ chainId: "0x14a34" }]);
  assert.deepEqual(addChainParams(CHAINS[84532]).rpcUrls, ["https://sepolia.base.org"]);
});

// ───────────────────────── lazy loading ─────────────────────────

test("viem loads only on owned()/mint(): config() and preview() never load the codec; it loads once", async () => {
  let loads = 0;
  const s = createStamps({ fetch: replayFetch(), loadCodec: () => (loads++, import("../src/stamps/codec.mjs")) });
  s.config(BASE_APP);
  s.preview({ ...REHEARSAL.stamps[0], trait: REHEARSAL.stamps[0].trait });
  assert.equal(loads, 0);
  await s.owned(HOLDER);
  await s.mint({ provider: wallet(), stampId: 0, app: BASE_APP });
  assert.equal(loads, 1);
  const src = readFileSync(join(APP_DIR, "src/stamps/index.mjs"), "utf8");
  assert.doesNotMatch(src, /from\s+["']viem/, "index.mjs has no static viem import");
  assert.deepEqual([...src.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]), ["./codec.mjs"]);
});

test("bundled with code splitting, viem stays out of the entry chunk", async () => {
  const r = await build({
    entryPoints: [join(APP_DIR, "src/stamps/index.mjs")],
    bundle: true,
    splitting: true,
    format: "esm",
    platform: "browser",
    minify: true,
    write: false,
    outdir: "/virtual",
    logLevel: "silent",
  });
  const entry = r.outputFiles.find((f) => f.path.endsWith("/index.js"));
  const chunks = r.outputFiles.filter((f) => f !== entry);
  assert.ok(entry, "entry chunk");
  assert.ok(entry.contents.length < 16 * 1024, `entry ${entry.contents.length} bytes`);
  assert.doesNotMatch(entry.text, /encodeFunctionData|AbiEncodingLengthMismatchError/, "no viem in the entry");
  assert.ok(chunks.some((c) => /AbiEncodingLengthMismatchError|abi/i.test(c.text)), "viem is in a lazy chunk");
  const lazy = chunks.reduce((n, c) => n + c.contents.length, 0);
  assert.ok(lazy < 200 * 1024, `lazy chunks ${lazy} bytes`);
});
