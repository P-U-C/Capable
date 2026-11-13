// S3: the stamps module (contract/citizen.d.ts StampsAPI). No network: a mocked
// EIP-1193 wallet and a mocked fetch. Chain truth comes from chain/fixtures/rehearsal.json,
// written by `cd chain && npm run rehearse` from real mints (and two real reverts) on a
// local anvil: the eth_call answers and the transaction receipts are replayed byte for byte.
// chain/test/app.test.mjs runs the same module against the live local contract.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decodeFunctionData, encodeAbiParameters, encodeFunctionResult, encodePacked, keccak256 as viemKeccak, pad, toEventSelector, toHex as viemToHex } from "viem";
import { build } from "esbuild";
import { badgeSvg } from "../../contract/badge-art.mjs";
import * as defaultApi from "../src/stamps/index.mjs";
import { CHAINS, TOPICS, addChainParams, createStamps, stampSeed, stampTrait } from "../src/stamps/index.mjs";
import { STAMPS_ABI } from "../src/stamps/abi.mjs";
import { keccak256, toHex } from "../src/stamps/keccak.mjs";
import { APP_DIR, ROOT, fixture } from "./helpers.mjs";

const REHEARSAL = JSON.parse(readFileSync(join(ROOT, "chain/fixtures/rehearsal.json"), "utf8"));
const CONTRACT = REHEARSAL.contract;
const appWith = (stamps) => ({ ...fixture(), stamps });
const BASE_APP = appWith({ chainId: 8453, address: CONTRACT });
const HASH = "0x" + "ab".repeat(32);
const HOLDER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"; // anvil #1: holds stamps 0 and 2 in the rehearsal
const OTHER = "0x90F79bf6EB2c4f870365E785982E1f101E93b906"; // anvil #3: holds nothing
const RECEIPTS = REHEARSAL.receipts;
const MINTED = RECEIPTS.filter((r) => r.label === "minted");

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
  assert.deepEqual(
    s.config({ stamps: shipped.stamps }),
    { chainId: shipped.stamps.chainId, address: shipped.stamps.address.toLowerCase() },
    "content/app.meta.json ships a valid live contract config",
  );
  assert.equal(typeof defaultApi.config, "function");
  for (const k of ["config", "owned", "preview", "check", "mint", "receipt"]) assert.equal(typeof defaultApi[k], "function", k);
  for (const k of ["config", "owned", "preview", "check", "mint", "receipt"]) assert.equal(typeof defaultApi.default[k], "function", `default.${k}`);
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

/**
 * A fetch that answers from the rehearsal's recordings (real chain bytes): eth_call by calldata, and
 * eth_getTransactionReceipt by hash (null, as a node says for a tx it has not mined, for any other hash).
 */
function replayFetch(log = [], { receipts = RECEIPTS } = {}) {
  return async (url, init) => {
    const req = JSON.parse(init.body);
    log.push({ url, init, req });
    assert.equal(init.method, "POST");
    assert.equal(init.credentials, "omit");
    assert.equal(req.jsonrpc, "2.0");
    if (req.method === "eth_getTransactionReceipt") {
      assert.equal(req.params.length, 1);
      const hit = receipts.find((r) => r.txHash.toLowerCase() === String(req.params[0]).toLowerCase());
      return { ok: true, status: 200, json: async () => ({ jsonrpc: "2.0", id: req.id, result: hit ? structuredClone(hit.result) : null }) };
    }
    assert.equal(req.method, "eth_call");
    assert.equal(req.params[1], "latest");
    assert.equal(req.params[0].to, CONTRACT.toLowerCase());
    const hit = REHEARSAL.calls.find((c) => c.data === req.params[0].data);
    assert.ok(hit, `unrecorded call ${req.params[0].data}`);
    return { ok: true, status: 200, json: async () => ({ jsonrpc: "2.0", id: req.id, result: hit.result }) };
  };
}

/**
 * A fetch that plays the contract for check() and mint(): traits open unless listed in `closed`, stamps held as
 * "<address>:<stampId>" in `held`. Answers are ABI-encoded by viem from the app's own ABI slice.
 */
function chainFetch({ closed = [], held = [], log = [] } = {}) {
  const heldSet = new Set(held.map((h) => h.toLowerCase()));
  return async (url, init) => {
    const req = JSON.parse(init.body);
    log.push(req);
    assert.equal(req.method, "eth_call");
    const { functionName, args } = decodeFunctionData({ abi: STAMPS_ABI, data: req.params[0].data });
    let result;
    if (functionName === "traitOf") {
      if (args[0] > 3) return { ok: true, status: 200, json: async () => ({ jsonrpc: "2.0", id: req.id, error: { code: 3, message: "execution reverted" } }) };
      result = encodeFunctionResult({ abi: STAMPS_ABI, functionName, result: ["SOVEREIGN", "#18C8F0", 0, !closed.includes(args[0])] });
    } else if (functionName === "hasStamp") {
      result = encodeFunctionResult({ abi: STAMPS_ABI, functionName, result: heldSet.has(`${args[0].toLowerCase()}:${args[1]}`) });
    } else assert.fail(`unexpected read ${functionName}`);
    return { ok: true, status: 200, json: async () => ({ jsonrpc: "2.0", id: req.id, result }) };
  };
}
/** The reads a chainFetch saw, decoded: [functionName, ...args]. */
const reads = (log) => log.map((r) => decodeFunctionData({ abi: STAMPS_ABI, data: r.params[0].data })).map((d) => [d.functionName, ...d.args.map((a) => (typeof a === "string" ? a.toLowerCase() : a))]);

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

/** A fetch that answers tokensOf with `ids` (or raw hex) and stampOf(id) with `stampOf(id)` (a number or raw hex); counts requests. */
function ownedFetch({ ids, stampOf = (id) => Number(id) - 1 }) {
  const f = async (url, init) => {
    f.calls++;
    const req = JSON.parse(init.body);
    const { functionName, args } = decodeFunctionData({ abi: STAMPS_ABI, data: req.params[0].data });
    let result;
    if (functionName === "tokensOf") result = typeof ids === "string" ? ids : encodeAbiParameters([{ type: "uint256[]" }], [ids]);
    else if (functionName === "stampOf") {
      const v = stampOf(args[0]);
      result = typeof v === "string" ? v : viemToHex(BigInt(v), { size: 32 });
    } else assert.fail(functionName);
    return { ok: true, status: 200, json: async () => ({ jsonrpc: "2.0", id: req.id, result }) };
  };
  f.calls = 0;
  return f;
}
const ownedWith = async (opts) => {
  const f = ownedFetch(opts);
  const s = createStamps({ fetch: f });
  return { r: await s.owned(HOLDER, { app: BASE_APP }), calls: f.calls };
};
const range = (n, from = 1) => Array.from({ length: n }, (_, i) => BigInt(i + from));

test("owned(): tokensOf is capped at 256 ids (one per trait, at most 256 traits) and checked BEFORE any stampOf fan-out (review V-M16, V20)", async () => {
  const full = await ownedWith({ ids: range(256) });
  assert.equal(full.r.error, undefined);
  assert.equal(full.r.stamps.length, 256, "256 is the most a holder can have, and is accepted");
  assert.deepEqual(full.r.stamps.at(-1), { tokenId: 256, stampId: 255 });
  assert.equal(full.calls, 257);
  for (const ids of [range(257), range(10_000)]) {
    const over = await ownedWith({ ids });
    assert.deepEqual(over.r, { stamps: [], error: "unexpected answer from the contract" }, `${ids.length} ids`);
    assert.equal(over.calls, 1, "no stampOf call for an answer the contract cannot give");
  }
  // a bad id anywhere stops the read before the fan-out, too (V-M17)
  for (const bad of [0n, 1_000_000_000n, 2n ** 256n - 1n]) {
    const r = await ownedWith({ ids: [1n, bad] });
    assert.match(r.r.error, /unexpected/, String(bad));
    assert.equal(r.calls, 1);
  }
  // the contract never lists an id twice: a repeat is a broken or hostile answer
  const dup = await ownedWith({ ids: [5n, 5n, 5n] });
  assert.match(dup.r.error, /unexpected/);
  assert.equal(dup.calls, 1);
  // an answer longer than tokensOf at its cap is not decoded at all
  const huge = "0x" + "0".repeat(62) + "20" + (300).toString(16).padStart(64, "0") + "00".repeat(32 * 300);
  const big = await ownedWith({ ids: huge });
  assert.match(big.r.error, /unexpected/);
  // a declared length far beyond the data (the reviewer's probe): an error, never a hang or a throw
  const lie = await ownedWith({ ids: "0x" + "0".repeat(62) + "20" + "f".repeat(64) });
  assert.deepEqual(lie.r.stamps, []);
  assert.ok(lie.r.error);
});

test("owned(): stampOf answers outside 0..255 (a dirty uint8 word) and repeated stamps are refused (review V-M18)", async () => {
  // through the real codec: a dirty word, or trailing bytes, is not the canonical answer the contract gives
  for (const v of [256, 300, 65535, "0x" + "f".repeat(64), "0x01" + "0".repeat(62), "0x" + "1".padStart(64, "0") + "00"]) {
    const r = await ownedWith({ ids: [7n], stampOf: () => v });
    assert.deepEqual(r.r, { stamps: [], error: "unexpected answer from the contract" }, String(v));
  }
  // and index.mjs does not trust its decoder: a lax one (plain viem decodes 256 from a uint8 slot) is still caught
  const real = await import("../src/stamps/codec.mjs");
  for (const bad of [256, 300, -1, 1.5, NaN, "1", null, 2n]) {
    const lax = { encode: real.encode, decode: (fn, data) => (fn === "stampOf" ? bad : real.decode(fn, data)) };
    const s = createStamps({ fetch: ownedFetch({ ids: [7n] }), loadCodec: async () => lax });
    assert.deepEqual(await s.owned(HOLDER, { app: BASE_APP }), { stamps: [], error: "unexpected answer from the contract" }, String(bad));
  }
  const edge = await ownedWith({ ids: [7n, 9n], stampOf: (id) => (id === 7n ? 255 : 0) });
  assert.deepEqual(edge.r, { stamps: [{ tokenId: 7, stampId: 255 }, { tokenId: 9, stampId: 0 }] }, "0 and 255 are fine");
  const twice = await ownedWith({ ids: [7n, 9n], stampOf: () => 2 });
  assert.match(twice.r.error, /unexpected/, "one stamp per trait: two tokens of trait 2 is not an answer the contract gives");
});

test("owned()/check(): index.mjs does not trust its decoder: an oversized answer never reaches it, and non-boolean open/held are refused", async () => {
  const real = await import("../src/stamps/codec.mjs");
  const decoded = [];
  const spy = { encode: real.encode, decode: (fn, data) => (decoded.push(fn), real.decode(fn, data)) };
  const blob = "0x" + "0".repeat(62) + "20" + (400).toString(16).padStart(64, "0") + range(400).map((n) => n.toString(16).padStart(64, "0")).join("");
  const s = createStamps({ fetch: ownedFetch({ ids: blob }), loadCodec: async () => spy });
  assert.deepEqual(await s.owned(HOLDER, { app: BASE_APP }), { stamps: [], error: "unexpected answer from the contract" });
  assert.deepEqual(decoded, [], "longer than tokensOf can ever be: not decoded at all");
  for (const [fn, bad] of [["traitOf", ["X", "#000000", 0, "true"]], ["traitOf", ["X", "#000000", 0]], ["traitOf", "open"], ["hasStamp", 1], ["hasStamp", "false"], ["hasStamp", undefined]]) {
    const lax = { encode: real.encode, decode: (f, data) => (f === fn ? bad : real.decode(f, data)) };
    const r = await createStamps({ fetch: chainFetch(), loadCodec: async () => lax }).check({ app: BASE_APP, holder: HOLDER, stampId: 0 });
    assert.deepEqual(r, { open: false, held: false, error: "unexpected answer from the contract" }, `${fn} → ${JSON.stringify(bad)}`);
  }
});

test("owned(): a mixed-case address with a bad checksum is read (lower-cased for the encoder), not refused", async () => {
  const s = createStamps({ fetch: replayFetch() });
  assert.deepEqual(await s.owned("0x70997970c51812DC3A010C7d01b50e0d17dc79c8", { app: BASE_APP }), { stamps: [{ tokenId: 1, stampId: 0 }, { tokenId: 2, stampId: 2 }] });
});

test("codec.decode(): every real answer from the local chain decodes; anything but the canonical encoding is refused", async () => {
  const { decode } = await import("../src/stamps/codec.mjs");
  for (const c of REHEARSAL.calls) assert.doesNotThrow(() => decode(c.functionName, c.result), c.functionName);
  assert.deepEqual(decode("traitOf", REHEARSAL.calls.find((c) => c.functionName === "traitOf" && c.args[0] === "1").result), ["CIVIL", "#FF1FC8", 1, false]);
  const w = (n) => BigInt(n).toString(16).padStart(64, "0");
  const refused = [
    ["hasStamp", "0x" + w(2)], // a bool that is 2
    ["hasStamp", "0x" + w(1) + w(0)], // trailing word
    ["stampOf", "0x" + w(256)], // a uint8 with a dirty high byte
    ["stampOf", "0x" + w(1).slice(0, 62)], // short
    ["tokensOf", "0x" + w(0x40) + w(0) + w(1) + w(5)], // a valid but non-canonical offset
    ["tokensOf", "0x" + w(0x20) + w(1)], // a length with no element
    ["tokensOf", "0x" + w(0x20) + w(2n ** 64n)], // an absurd length
    ["traitOf", REHEARSAL.calls.find((c) => c.functionName === "traitOf").result + "00"],
  ];
  for (const [fn, data] of refused) assert.throws(() => decode(fn, data), /unexpected answer from the contract/, `${fn} ${data.slice(0, 80)}`);
});

// ───────────────────────── check ─────────────────────────

test("check(): traitOf(stampId).open and hasStamp(holder, stampId), from real local-chain answers (trait 1 closed by the owner)", async () => {
  const log = [];
  const s = createStamps({ rpcUrl: "https://rpc.test/", fetch: replayFetch(log) });
  assert.deepEqual(await s.check({ app: BASE_APP, holder: HOLDER, stampId: 0 }), { open: true, held: true });
  assert.deepEqual(await s.check({ app: BASE_APP, holder: HOLDER, stampId: 1 }), { open: false, held: false });
  assert.deepEqual(await s.check({ app: BASE_APP, holder: HOLDER.toLowerCase(), stampId: 1 }), { open: false, held: false });
  assert.equal(log.length, 6, "two reads each");
  assert.ok(log.every((l) => l.req.method === "eth_call" && !("from" in l.req.params[0])), "read-only: a read never names a sender");
  assert.deepEqual([...new Set(log.map((l) => decodeFunctionData({ abi: STAMPS_ABI, data: l.req.params[0].data }).functionName))].sort(), ["hasStamp", "traitOf"]);
  // the shipped default reads the public Base RPC
  const urls = [];
  await createStamps({ fetch: (u, i) => (urls.push(u), replayFetch()(u, i)) }).check({ app: BASE_APP, holder: HOLDER, stampId: 0 });
  assert.deepEqual(urls, ["https://mainnet.base.org", "https://mainnet.base.org"]);
});

test("check(): never throws; on any failure { open: false, held: false, error } so no mint is offered", async () => {
  const no = (r, label) => {
    assert.equal(r.open, false, label);
    assert.equal(r.held, false, label);
    assert.equal(typeof r.error, "string", label);
    assert.ok(r.error.length > 0, label);
  };
  const nothing = createStamps({ fetch: async () => assert.fail("no request for bad input") });
  no(await nothing.check({ app: fixture(), holder: HOLDER, stampId: 0 }), "not configured");
  no(await nothing.check({ app: BASE_APP, holder: "0x1234", stampId: 0 }), "bad holder");
  no(await nothing.check({ app: BASE_APP, holder: HOLDER, stampId: 256 }), "bad stampId");
  no(await nothing.check({ app: BASE_APP, holder: HOLDER, stampId: "0" }), "string stampId");
  no(await nothing.check(), "no options");
  const answer = (body, { ok = true, status = 200 } = {}) => async () => ({ ok, status, json: async () => body });
  const word = (hex) => "0x" + hex.padStart(64, "0");
  const cases = [
    ["HTTP 429", answer({}, { ok: false, status: 429 }), /HTTP 429/],
    ["revert (unknown trait)", answer({ jsonrpc: "2.0", id: 1, error: { code: 3, message: "execution reverted", data: "0x" } }), /refused the read \(3\)$/],
    ["a hostile error code is not echoed", answer({ jsonrpc: "2.0", id: 1, error: { code: "<b>x</b>", message: "<b>x</b>" } }), /refused the read \(error\)$/],
    ["no contract", answer({ jsonrpc: "2.0", id: 1, result: "0x" }), /no stamps contract/],
    ["no result", answer({ jsonrpc: "2.0", id: 1 }), /no data/],
    ["number", answer({ jsonrpc: "2.0", id: 1, result: 7 }), /no data/],
    ["html", answer({ jsonrpc: "2.0", id: 1, result: "<html>" }), /no data/],
    ["garbage", answer({ jsonrpc: "2.0", id: 1, result: "0x1234" }), /./],
    ["a bool word that is 2", answer({ jsonrpc: "2.0", id: 1, result: word("2") }), /./],
    ["offline", async () => { throw new TypeError("fetch failed"); }, /fetch failed/],
  ];
  for (const [label, f, reason] of cases) {
    const r = await createStamps({ fetch: f }).check({ app: BASE_APP, holder: HOLDER, stampId: 0 });
    no(r, label);
    assert.match(r.error, reason, label);
  }
  // one good read and one bad: still no
  const half = async (url, init) => {
    const req = JSON.parse(init.body);
    const { functionName } = decodeFunctionData({ abi: STAMPS_ABI, data: req.params[0].data });
    if (functionName === "traitOf") return chainFetch()(url, init);
    return { ok: false, status: 500 };
  };
  no(await createStamps({ fetch: half }).check({ app: BASE_APP, holder: HOLDER, stampId: 0 }), "hasStamp failed");
  // a traitOf answer that is valid ABI but says open = true for a held stamp is reported as such, not guessed
  assert.deepEqual(await createStamps({ fetch: chainFetch({ held: [`${HOLDER}:0`] }) }).check({ app: BASE_APP, holder: HOLDER, stampId: 0 }), { open: true, held: true });
  // offline code: an error, not a throw
  const offline = createStamps({ loadCodec: () => Promise.reject(new TypeError("Failed to fetch dynamically imported module")) });
  no(await offline.check({ app: BASE_APP, holder: HOLDER, stampId: 0 }), "codec failed to load");
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

test("mint(): already on Base → request accounts → re-check for that account → ONE eth_sendTransaction of mint(stampId), pinned to chain 0x2105 → tx hash, Basescan link, sender", async () => {
  const log = [];
  const s = createStamps({ fetch: chainFetch({ log }) });
  const w = wallet();
  const r = await s.mint({ provider: w, stampId: 0, app: BASE_APP });
  assert.deepEqual(r, { txHash: HASH, explorerUrl: `https://basescan.org/tx/${HASH}`, from: HOLDER });
  assert.deepEqual(w.methods(), ["eth_chainId", "eth_requestAccounts", "eth_sendTransaction"]);
  const [tx] = w.calls[2].params;
  assert.deepEqual(Object.keys(tx).sort(), ["chainId", "data", "from", "to"], "no value, no gas: only what the wallet must not choose");
  assert.equal(tx.chainId, "0x2105", "V11: a wallet now on another network refuses the send");
  assert.equal(tx.from, HOLDER);
  assert.equal(tx.to, CONTRACT.toLowerCase());
  assert.equal(tx.data, REHEARSAL.stamps[0].mintData, "the exact calldata the local chain accepted");
  assert.deepEqual(decodeFunctionData({ abi: STAMPS_ABI, data: tx.data }), { functionName: "mint", args: [0] });
  assert.deepEqual(reads(log).sort(), [["hasStamp", HOLDER.toLowerCase(), 0], ["traitOf", 0]], "the trait and the sending account, read before the send");
  const r2 = await s.mint({ provider: wallet(), stampId: 2, app: BASE_APP });
  assert.equal(r2.txHash, HASH);
});

test("mint(): refuses a closed trait ('closed') and a stamp the sending account holds ('held') before anything is sent (review V1)", async () => {
  const cases = [
    [{ closed: [1] }, 1, "closed", /not open/],
    [{ held: [`${HOLDER}:2`] }, 2, "held", /already holds/],
    [{ closed: [3], held: [`${HOLDER}:3`] }, 3, "held", /already holds/], // both: "held" says more
  ];
  for (const [state, stampId, code, message] of cases) {
    const w = wallet();
    await assert.rejects(createStamps({ fetch: chainFetch(state) }).mint({ provider: w, stampId, app: BASE_APP }), (e) => e.name === "StampsError" && e.code === code && message.test(e.message), code);
    assert.deepEqual(w.methods(), ["eth_chainId", "eth_requestAccounts"], `${code}: no send`);
  }
  // after a switch too: the check runs after the chain and the account are settled
  const w = wallet({ chainId: "0x1" });
  await assert.rejects(createStamps({ fetch: chainFetch({ closed: [0] }) }).mint({ provider: w, stampId: 0, app: BASE_APP }), (e) => e.code === "closed");
  assert.deepEqual(w.methods(), ["eth_chainId", "wallet_switchEthereumChain", "eth_chainId", "eth_requestAccounts"]);
});

test("mint(): the re-check is for the account the wallet will send from, not one seen earlier", async () => {
  const state = { held: [`${HOLDER}:0`] };
  // the card may have looked at OTHER (eth_accounts), but the wallet sends from HOLDER, who holds it
  await assert.rejects(createStamps({ fetch: chainFetch(state) }).mint({ provider: wallet(), stampId: 0, app: BASE_APP }), (e) => e.code === "held");
  // and the other way round: HOLDER's stamp does not stop OTHER
  const log = [];
  const w = wallet({ eth_requestAccounts: [OTHER] });
  const r = await createStamps({ fetch: chainFetch({ ...state, log }) }).mint({ provider: w, stampId: 0, app: BASE_APP });
  assert.equal(r.from, OTHER);
  assert.equal(w.calls.at(-1).params[0].from, OTHER);
  assert.ok(reads(log).some((x) => x[0] === "hasStamp" && x[1] === OTHER.toLowerCase()));
  // a wallet that shares a mixed-case address with a bad checksum still gets a real check (no encoder error)
  const odd = "0x70997970c51812DC3A010C7d01b50e0d17dc79c8";
  await assert.rejects(createStamps({ fetch: chainFetch(state) }).mint({ provider: wallet({ eth_requestAccounts: [odd] }), stampId: 0, app: BASE_APP }), (e) => e.code === "held");
});

test("mint(): when the re-check cannot be read, the send still goes ahead (the offer needed a good check(); the wallet simulates; receipt() reports a revert)", async () => {
  const failures = [
    async () => ({ ok: false, status: 429 }), // the public RPC rate-limits
    async () => { throw new TypeError("fetch failed"); }, // offline for a moment
    async () => ({ ok: true, status: 200, json: async () => ({ jsonrpc: "2.0", id: 1, result: "0x" }) }), // a node that is behind
  ];
  for (const f of failures) {
    const w = wallet();
    const r = await createStamps({ fetch: f }).mint({ provider: w, stampId: 0, app: BASE_APP });
    assert.equal(r.txHash, HASH);
    assert.equal(w.methods().filter((m) => m === "eth_sendTransaction").length, 1);
  }
});

test("mint(): on another chain → wallet_switchEthereumChain(0x2105) → confirm → accounts → send", async () => {
  const w = wallet({ chainId: "0x1" });
  await createStamps({ fetch: chainFetch() }).mint({ provider: w, stampId: 3, app: BASE_APP });
  assert.deepEqual(w.methods(), ["eth_chainId", "wallet_switchEthereumChain", "eth_chainId", "eth_requestAccounts", "eth_sendTransaction"]);
  assert.deepEqual(w.calls[1].params, [{ chainId: "0x2105" }]);
  assert.equal(w.calls[4].params[0].data, REHEARSAL.stamps[2].mintData);
});

test("mint(): Base unknown to the wallet (4902, also nested as MetaMask mobile does) → wallet_addEthereumChain with Base's parameters", async () => {
  for (const err of [rpcError(4902), rpcError(-32603, "internal", { data: { originalError: { code: 4902 } } })]) {
    const w = wallet({ chainId: "0x1", wallet_switchEthereumChain: err, wallet_addEthereumChain: (p, ctl) => (ctl.setChain(p[0].chainId), null) });
    const r = await createStamps({ fetch: chainFetch() }).mint({ provider: w, stampId: 1, app: BASE_APP });
    assert.equal(r.txHash, HASH);
    assert.deepEqual(w.methods(), ["eth_chainId", "wallet_switchEthereumChain", "wallet_addEthereumChain", "eth_chainId", "eth_chainId", "eth_requestAccounts", "eth_sendTransaction"]);
    assert.deepEqual(w.calls[2].params, [
      { chainId: "0x2105", chainName: "Base", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: ["https://mainnet.base.org"], blockExplorerUrls: ["https://basescan.org"] },
    ]);
  }
  // a wallet that adds the chain but does not switch to it gets one more switch request
  const w = wallet({ chainId: "0x1", wallet_switchEthereumChain: (() => { let n = 0; return (p, ctl) => { if (n++ === 0) throw rpcError(4902); ctl.setChain(p[0].chainId); return null; }; })(), wallet_addEthereumChain: null });
  await createStamps({ fetch: chainFetch() }).mint({ provider: w, stampId: 1, app: BASE_APP });
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
    await assert.rejects(createStamps({ fetch: chainFetch() }).mint({ provider: w, stampId: 0, app: BASE_APP }), (e) => e.code === "rejected", step);
    assert.deepEqual(w.methods(), expected, step);
  }
});

test("mint(): never resends: a failed or duplicate request sends exactly one transaction", async () => {
  // the wallet errors after (maybe) broadcasting: no retry, a clear code
  const w = wallet({ eth_sendTransaction: rpcError(-32603, "request timed out") });
  const s = createStamps({ fetch: chainFetch() });
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
  await assert.rejects(createStamps({ fetch: chainFetch() }).mint({ provider: unsupported, stampId: 0, app: BASE_APP }), (e) => e.code === "wrong-chain");
  assert.ok(!unsupported.methods().includes("eth_sendTransaction"));
  const stuck = wallet({ chainId: "0x1", wallet_switchEthereumChain: null }); // says yes, stays on chain 1
  await assert.rejects(createStamps({ fetch: chainFetch() }).mint({ provider: stuck, stampId: 0, app: BASE_APP }), (e) => e.code === "wrong-chain");
  assert.ok(!stuck.methods().includes("eth_sendTransaction"));
  const noAccount = wallet({ eth_requestAccounts: [] });
  await assert.rejects(createStamps({ fetch: chainFetch() }).mint({ provider: noAccount, stampId: 0, app: BASE_APP }), (e) => e.code === "no-account");
  assert.ok(!noAccount.methods().includes("eth_sendTransaction"));
});

test("mint(): Base Sepolia (the owner's dry run) uses 0x14a34 and sepolia.basescan.org", async () => {
  const w = wallet({ chainId: "0x2105" });
  const urls = [];
  const r = await createStamps({ fetch: (url, init) => (urls.push(url), chainFetch()(url, init)) }).mint({ provider: w, stampId: 0, app: appWith({ chainId: 84532, address: CONTRACT }) });
  assert.equal(r.explorerUrl, `https://sepolia.basescan.org/tx/${HASH}`);
  assert.deepEqual(w.calls[1].params, [{ chainId: "0x14a34" }]);
  assert.equal(w.calls.at(-1).params[0].chainId, "0x14a34", "pinned to Sepolia");
  assert.ok(urls.length && urls.every((u) => u === "https://sepolia.base.org"), "and checked on Sepolia");
  assert.deepEqual(addChainParams(CHAINS[84532]).rpcUrls, ["https://sepolia.base.org"]);
});

// ───────────────────────── receipt ─────────────────────────

/** A recorded receipt, changed by `edit(result)`, served for its hash. */
function edited(rec, edit) {
  const result = structuredClone(rec.result);
  edit(result);
  return [{ ...rec, result }];
}
const receiptOf = (receipts, opts = {}) => createStamps({ fetch: replayFetch([], { receipts }) }).receipt({ app: BASE_APP, txHash: receipts[0].txHash, ...opts });

test("receipt(): the recorded local-chain mints → success with the tokenId from this contract's Stamped log", async () => {
  const log = [];
  const s = createStamps({ fetch: replayFetch(log) });
  assert.equal(MINTED.length, 3);
  for (const m of MINTED) {
    assert.deepEqual(await s.receipt({ app: BASE_APP, txHash: m.txHash }), { status: "success", tokenId: m.tokenId }, `#${m.tokenId}`);
    assert.deepEqual(await s.receipt({ app: BASE_APP, txHash: m.txHash, holder: m.holder }), { status: "success", tokenId: m.tokenId });
    assert.deepEqual(await s.receipt({ app: BASE_APP, txHash: m.txHash.toUpperCase().replace("0X", "0x") }), { status: "success", tokenId: m.tokenId }, "hash case does not matter");
  }
  assert.deepEqual(log[0].req.params, [MINTED[0].txHash]);
  assert.equal(log[0].req.method, "eth_getTransactionReceipt");
  assert.equal(log[0].url, "https://mainnet.base.org");
});

test("receipt(): the recorded reverts (a closed trait sent anyway, a held stamp minted again) → reverted", async () => {
  const s = createStamps({ fetch: replayFetch() });
  for (const label of ["closed", "held"]) {
    const rec = RECEIPTS.find((r) => r.label === label);
    assert.equal(rec.result.status, "0x0");
    assert.deepEqual(await s.receipt({ app: BASE_APP, txHash: rec.txHash }), { status: "reverted" }, label);
  }
});

test("receipt(): not mined yet (null) → pending, with no error", async () => {
  const s = createStamps({ fetch: replayFetch() });
  assert.deepEqual(await s.receipt({ app: BASE_APP, txHash: HASH }), { status: "pending" });
});

test("receipt(): only this contract's own logs count; forged, removed, malformed or someone else's logs never make a success", async () => {
  const m = MINTED[0];
  const fake = "0x" + "fe".repeat(20);
  const holderTopic = pad(HOLDER.toLowerCase(), { size: 32 });
  const stamped = (tokenId, address = CONTRACT.toLowerCase(), holder = holderTopic, stampId = 0) => ({ address, topics: [TOPICS.Stamped, holder, viemToHex(stampId, { size: 32 }), viemToHex(tokenId, { size: 32 })], data: "0x", removed: false });
  // another contract emits the same events (a lookalike): ignored, so nothing was minted here
  const elsewhere = await receiptOf(edited(m, (r) => r.logs.forEach((l) => (l.address = fake))));
  assert.equal(elsewhere.status, "reverted");
  assert.match(elsewhere.error, /minted no stamp/);
  // a forged Stamped from another address, listed first, cannot change the tokenId
  assert.deepEqual(await receiptOf(edited(m, (r) => r.logs.unshift(stamped(77, fake)))), { status: "success", tokenId: 1 });
  // the address check is case-insensitive (nodes return lower case; some return checksums)
  assert.deepEqual(await receiptOf(edited(m, (r) => r.logs.forEach((l) => (l.address = CONTRACT)))), { status: "success", tokenId: 1 });
  // a removed (reorged-out) log is not a mint
  assert.equal((await receiptOf(edited(m, (r) => r.logs.forEach((l) => (l.removed = true))))).status, "reverted");
  // a Stamped for someone else is not this sender's stamp
  const other = await receiptOf(edited(m, (r) => (r.logs = [stamped(1, CONTRACT.toLowerCase(), pad(OTHER.toLowerCase(), { size: 32 }))])));
  assert.equal(other.status, "reverted");
  // tokenIds outside 1..999,999,999, a stampId over 255, or a dirty address topic are not believed
  for (const bad of [stamped(0), stamped(1_000_000_000), stamped(1, undefined, undefined, 256), stamped(1, undefined, "0x01" + holderTopic.slice(4))]) {
    assert.equal((await receiptOf(edited(m, (r) => (r.logs = [bad])))).status, "reverted", JSON.stringify(bad.topics));
  }
  // the Transfer from 0x0 is the fallback when there is no Stamped log; a Transfer between holders is not a mint
  const transferOnly = edited(m, (r) => (r.logs = r.logs.filter((l) => l.topics[0] === TOPICS.Transfer)));
  assert.equal(transferOnly[0].result.logs.length, 1);
  assert.deepEqual(await receiptOf(transferOnly), { status: "success", tokenId: 1 });
  const moved = edited(m, (r) => (r.logs = [{ ...r.logs[0], topics: [TOPICS.Transfer, pad(OTHER.toLowerCase(), { size: 32 }), holderTopic, r.logs[0].topics[3]] }]));
  assert.equal((await receiptOf(moved)).status, "reverted");
  // junk in the logs array is skipped, not thrown on
  assert.deepEqual(await receiptOf(edited(m, (r) => r.logs.unshift(null, 7, "x", { address: 5 }, { address: CONTRACT, topics: "no" }, { address: CONTRACT, topics: [TOPICS.Stamped] }))), { status: "success", tokenId: 1 });
});

test("receipt(): `holder` finds a stamp minted through another contract (a smart-contract wallet's bundle), and is never fooled by the tx sender", async () => {
  const m = MINTED[0];
  const bundler = "0x" + "b0".repeat(20);
  const viaBundler = edited(m, (r) => ((r.from = bundler), (r.to = "0x" + "e4".repeat(20))));
  const blind = await receiptOf(viaBundler);
  assert.equal(blind.status, "reverted", "without the holder, the sender (the bundler) has no stamp here");
  assert.deepEqual(await receiptOf(viaBundler, { holder: HOLDER }), { status: "success", tokenId: 1 });
  assert.deepEqual(await receiptOf(viaBundler, { holder: HOLDER.toLowerCase() }), { status: "success", tokenId: 1 });
  assert.equal((await receiptOf(viaBundler, { holder: OTHER })).status, "reverted");
});

test("receipt(): never throws; a failed or untrustworthy read is pending with a reason (poll again)", async () => {
  const m = MINTED[0];
  const pending = (r, reason, label) => {
    assert.equal(r.status, "pending", label);
    assert.match(r.error, reason, label);
    assert.equal(r.tokenId, undefined, label);
  };
  const nothing = createStamps({ fetch: async () => assert.fail("no request for bad input") });
  pending(await nothing.receipt({ app: fixture(), txHash: m.txHash }), /not on chain/, "not configured");
  pending(await nothing.receipt({ app: BASE_APP, txHash: "0x1234" }), /not a transaction hash/, "short hash");
  pending(await nothing.receipt({ app: BASE_APP, txHash: 42 }), /not a transaction hash/, "number");
  pending(await nothing.receipt({ app: BASE_APP, txHash: m.txHash, holder: "me" }), /not an address/, "bad holder");
  pending(await nothing.receipt(), /not on chain/, "no options");
  const answer = (body, { ok = true, status = 200 } = {}) => async () => ({ ok, status, json: async () => body });
  const cases = [
    ["HTTP 503", answer({}, { ok: false, status: 503 }), /HTTP 503/],
    ["RPC error", answer({ jsonrpc: "2.0", id: 1, error: { code: -32005, message: "limit" } }), /refused the read \(-32005\)$/],
    ["no result", answer({ jsonrpc: "2.0", id: 1 }), /no data/],
    ["a string", answer({ jsonrpc: "2.0", id: 1, result: "0x1" }), /no receipt/],
    ["an array", answer({ jsonrpc: "2.0", id: 1, result: [m.result] }), /no receipt/],
    ["offline", async () => { throw new TypeError("fetch failed"); }, /fetch failed/],
    ["bad json", async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("Unexpected token <"); } }), /Unexpected token/],
  ];
  for (const [label, f, reason] of cases) pending(await createStamps({ fetch: f }).receipt({ app: BASE_APP, txHash: m.txHash }), reason, label);
  const changed = [
    ["another tx's receipt", (r) => (r.transactionHash = HASH), /another transaction/],
    ["no hash", (r) => delete r.transactionHash, /another transaction/],
    ["no status", (r) => delete r.status, /no status/],
    ["odd status", (r) => (r.status = "0x2"), /no status/],
    ["no sender", (r) => delete r.from, /no sender/],
    ["no logs", (r) => delete r.logs, /no logs/],
  ];
  for (const [label, edit, reason] of changed) pending(await receiptOf(edited(m, edit)), reason, label);
  // a revert stays a revert whatever its logs say (a reverted tx has none)
  assert.deepEqual(await receiptOf(edited(m, (r) => (r.status = "0x0"))), { status: "reverted" });
});

test("TOPICS are keccak256 of the event signatures (chain/test/build.test.mjs checks them against the compiled ABI)", () => {
  assert.equal(TOPICS.Stamped, toEventSelector("event Stamped(address indexed holder, uint8 indexed stampId, uint256 indexed tokenId)"));
  assert.equal(TOPICS.Transfer, toEventSelector("event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)"));
  assert.equal(TOPICS.Stamped, toHex(keccak256(new TextEncoder().encode("Stamped(address,uint8,uint256)"))));
  for (const m of MINTED) assert.deepEqual(m.result.logs.map((l) => l.topics[0]).filter((t) => Object.values(TOPICS).includes(t)), [TOPICS.Transfer, TOPICS.Stamped], "as the chain emitted them");
});

// ───────────────────────── lazy loading ─────────────────────────

test("viem loads only on owned()/check()/mint(): config(), preview() and receipt() never load the codec; it loads once", async () => {
  let loads = 0;
  const s = createStamps({ fetch: replayFetch(), loadCodec: () => (loads++, import("../src/stamps/codec.mjs")) });
  await s.receipt({ app: BASE_APP, txHash: MINTED[0].txHash });
  assert.equal(loads, 0, "receipt() decodes its logs by hand: no viem");
  s.config(BASE_APP);
  s.preview({ ...REHEARSAL.stamps[0], trait: REHEARSAL.stamps[0].trait });
  assert.equal(loads, 0);
  await s.owned(HOLDER);
  await s.check({ app: BASE_APP, holder: HOLDER, stampId: 0 });
  await createStamps({ fetch: chainFetch(), loadCodec: () => (loads++, import("../src/stamps/codec.mjs")) }).mint({ provider: wallet(), stampId: 0, app: BASE_APP });
  assert.equal(loads, 2, "once per instance");
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
