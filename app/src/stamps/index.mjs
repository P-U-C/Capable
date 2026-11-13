// Stamps: soulbound badges on Base (contract/citizen.d.ts → StampsAPI; docs/STAMPS.md).
//
//   config(app)   → { chainId, address } from app.stamps, or null (not deployed: stamps stay local)
//   owned(addr)   → the address's stamps, read through a public JSON-RPC (no wallet)
//   preview(…)    → the exact SVG the contract draws for (holder, stampId, tokenId), offline
//   check(…)      → is the trait open on chain, and does the holder already hold it (review V1)
//   mint(…)       → switch/add the chain, re-check for the sending account, send mint(stampId) once
//                   with an explicit chainId (V11), return the tx hash and the sender
//   receipt(…)    → pending | success (+ the minted tokenId, from this contract's own log) | reverted
//
// First paint loads only this file, ./keccak.mjs and contract/badge-art.mjs. viem
// (ABI encode/decode) arrives with ./codec.mjs on the first owned(), check() or
// mint(); receipt() decodes its two event logs by hand and never needs it.
// Nothing here posts anything, holds a key, or sends a transaction by itself:
// mint() asks the person's own wallet, which asks the person.
import { badgeSvg } from "../../../contract/badge-art.mjs";
import { keccak256, toHex } from "./keccak.mjs";

/** Chains the app can mint on. Base is the one; Base Sepolia is for the owner's dry run. */
export const CHAINS = {
  8453: {
    chainId: 8453,
    hex: "0x2105",
    name: "Base",
    rpc: "https://mainnet.base.org",
    explorer: "https://basescan.org",
  },
  84532: {
    chainId: 84532,
    hex: "0x14a34",
    name: "Base Sepolia",
    rpc: "https://sepolia.base.org",
    explorer: "https://sepolia.basescan.org",
  },
};

/** EIP-3085 parameters for wallet_addEthereumChain. */
export const addChainParams = (chain) => ({
  chainId: chain.hex,
  chainName: chain.name,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: [chain.rpc],
  blockExplorerUrls: [chain.explorer],
});

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const TX_HASH = /^0x[0-9a-fA-F]{64}$/;
const WORD = /^0x[0-9a-fA-F]{64}$/;
const MAX_SERIAL = 999_999_999; // the contract's MAX_TOKEN_ID; badge-art prints serials < 10^9
const MAX_HELD = 256; // one stamp per (holder, trait) and at most 256 traits: tokensOf() can never be longer
const MAX_RESULT = 2 + 64 * (2 + MAX_HELD) + 64; // hex chars: tokensOf at its cap, plus slack; nothing we read is longer

/** Event topics (keccak256 of the signature), checked against the compiled ABI by chain/test/build.test.mjs. */
export const TOPICS = {
  Stamped: "0x4751be9e14b8befc9e381a303a93c5d51d701f7b00f3ee68b098c93163bf131f", // Stamped(address indexed holder, uint8 indexed stampId, uint256 indexed tokenId)
  Transfer: "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", // Transfer(address indexed from, address indexed to, uint256 indexed tokenId)
};

/**
 * An Error with a stable `code` for the UI: rejected, not-configured, no-wallet, bad-stamp, wrong-chain,
 * no-account, closed, held, wallet, offline. Only `wallet` can follow a send; every other code means nothing was sent.
 */
export function stampsError(code, message, cause) {
  const e = new Error(message, cause ? { cause } : undefined);
  e.code = code;
  e.name = "StampsError";
  return e;
}
const isStampsError = (e) => e instanceof Error && e.name === "StampsError" && typeof e.code === "string";
const unexpected = () => new Error("unexpected answer from the contract");

/** keccak256(abi.encodePacked(address holder, uint8 stampId, uint256 tokenId)), exactly as CapableStamps.mint stores it. */
export function stampSeed(holder, stampId, tokenId) {
  if (typeof holder !== "string" || !ADDRESS.test(holder)) throw new TypeError("holder: 0x + 40 hex");
  if (!Number.isInteger(stampId) || stampId < 0 || stampId > 255) throw new TypeError("stampId: 0..255");
  if (!Number.isSafeInteger(tokenId) || tokenId < 0) throw new TypeError("tokenId: a non-negative safe integer");
  const packed = new Uint8Array(20 + 1 + 32);
  for (let i = 0; i < 20; i++) packed[i] = parseInt(holder.slice(2 + i * 2, 4 + i * 2), 16);
  packed[20] = stampId;
  new DataView(packed.buffer).setBigUint64(packed.length - 8, BigInt(tokenId)); // big-endian uint256, high bytes zero
  return toHex(keccak256(packed));
}

/**
 * The StampTrait for an app Trait (contract/app.d.ts): the contract prints names in capitals. For drawing only:
 * `open` here is the app's assumption, never the chain's answer; check() reads the trait's real `open` flag.
 */
export function stampTrait(trait) {
  return { stampId: trait.stampId, name: String(trait.name).toUpperCase(), color: trait.color, emblem: trait.emblem, open: true };
}

/** True when an EIP-1193 error carries `code`, directly or wrapped (MetaMask mobile nests 4902 under -32603). */
const hasCode = (e, code) => [e?.code, e?.data?.originalError?.code, e?.data?.code, e?.cause?.code, e?.error?.code].includes(code);
const chainIdOf = (v) => {
  if (typeof v === "number") return v;
  if (typeof v === "string" && /^0x[0-9a-fA-F]+$/.test(v)) return parseInt(v, 16);
  if (typeof v === "string" && /^\d+$/.test(v)) return Number(v);
  return NaN;
};

/**
 * A StampsAPI. The module's named exports are one built with the defaults; tests
 * (and anything else that needs to) inject the RPC URL, fetch and the codec loader.
 */
export function createStamps({ rpcUrl = null, fetch: fetchImpl = (...a) => globalThis.fetch(...a), loadCodec = () => import("./codec.mjs"), timeoutMs = 10_000 } = {}) {
  let current = null; // the last config(app) result: owned(address) reads with it
  let codecPromise = null;
  let rpcId = 0;
  const inflight = new Map();

  const codec = () => {
    codecPromise ??= loadCodec().catch((err) => {
      codecPromise = null;
      throw stampsError("offline", "could not load the stamp code; check the connection and try again", err);
    });
    return codecPromise;
  };

  function config(app) {
    const s = app?.stamps;
    const chain = s && typeof s === "object" && Number.isInteger(s.chainId) ? CHAINS[s.chainId] : undefined;
    const ok = chain && typeof s.address === "string" && ADDRESS.test(s.address) && !/^0x0{40}$/.test(s.address);
    current = ok ? { chainId: chain.chainId, address: s.address.toLowerCase() } : null;
    return current ? { ...current } : null;
  }

  const urlFor = (cfg) => rpcUrl ?? CHAINS[cfg.chainId].rpc;

  /** One JSON-RPC request; resolves the raw `result` (any JSON value). Throws on HTTP, transport and RPC errors. */
  async function rpc(url, method, params) {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
      credentials: "omit",
      signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined,
    });
    if (!res.ok) throw new Error(`the network answered HTTP ${res.status}`);
    const body = await res.json();
    if (body?.error) throw new Error(`the network refused the read (${Number.isInteger(body.error.code) ? body.error.code : "error"})`);
    if (!body || typeof body !== "object" || !("result" in body)) throw new Error("the network sent no data");
    return body.result;
  }

  async function read(url, address, functionName, args) {
    const { encode, decode } = await codec();
    const result = await rpc(url, "eth_call", [{ to: address, data: encode(functionName, args) }, "latest"]);
    if (typeof result !== "string" || !/^0x[0-9a-fA-F]*$/.test(result)) throw new Error("the network sent no data");
    if (result === "0x") throw new Error("no stamps contract at the configured address");
    if (result.length > MAX_RESULT) throw unexpected(); // never hand an absurd blob to the decoder
    return decode(functionName, result);
  }

  /** The address's stamps on chain, sorted by tokenId. Never throws: [] plus a reason on any failure. */
  async function owned(address, opts = {}) {
    const cfg = opts.app ? config(opts.app) : current;
    if (!cfg) return { stamps: [], error: "stamps are not on chain yet" };
    if (typeof address !== "string" || !ADDRESS.test(address)) return { stamps: [], error: "not an address" };
    const url = opts.rpcUrl ?? urlFor(cfg);
    try {
      const ids = await read(url, cfg.address, "tokensOf", [address.toLowerCase()]); // lower case: never a checksum error
      // Checked before any stampOf call: a hostile or broken RPC cannot make us fan out (review V-M16).
      if (!Array.isArray(ids) || ids.length > MAX_HELD) throw unexpected();
      if (ids.some((id) => typeof id !== "bigint" || id < 1n || id > BigInt(MAX_SERIAL))) throw unexpected();
      if (new Set(ids.map(String)).size !== ids.length) throw unexpected(); // the contract never lists an id twice
      const stampIds = await Promise.all(ids.map((id) => read(url, cfg.address, "stampOf", [id])));
      // A uint8 decoded from a dirty word can exceed 255 (review V-M18); one stamp per trait, so no repeats.
      if (stampIds.some((v) => !Number.isInteger(v) || v < 0 || v > 255)) throw unexpected();
      if (new Set(stampIds).size !== stampIds.length) throw unexpected();
      const stamps = ids.map((id, i) => ({ tokenId: Number(id), stampId: stampIds[i] }));
      stamps.sort((a, b) => a.tokenId - b.tokenId);
      return { stamps };
    } catch (err) {
      return { stamps: [], error: err?.message || String(err) };
    }
  }

  /** traitOf(stampId).open and hasStamp(holder, stampId), read together. Never throws. */
  async function checkWith(cfg, holder, stampId) {
    try {
      const url = urlFor(cfg);
      const [trait, held] = await Promise.all([read(url, cfg.address, "traitOf", [stampId]), read(url, cfg.address, "hasStamp", [holder.toLowerCase(), stampId])]);
      const open = Array.isArray(trait) && trait.length === 4 ? trait[3] : undefined;
      if (typeof open !== "boolean" || typeof held !== "boolean") throw unexpected();
      return { open, held };
    } catch (err) {
      return { open: false, held: false, error: err?.message || String(err) };
    }
  }

  /**
   * Is the trait open on chain, and does `holder` already hold it? Read-only. On any failure
   * { open: false, held: false, error }: the caller must not offer a mint then.
   */
  async function check({ app, holder, stampId } = {}) {
    const cfg = config(app);
    if (!cfg) return { open: false, held: false, error: "stamps are not on chain yet" };
    if (typeof holder !== "string" || !ADDRESS.test(holder)) return { open: false, held: false, error: "not an address" };
    if (!Number.isInteger(stampId) || stampId < 0 || stampId > 255) return { open: false, held: false, error: "stampId: 0..255" };
    return checkWith(cfg, holder, stampId);
  }

  /** A log topic as an address (12 zero bytes, then 20), or null. */
  const topicAddress = (t) => (typeof t === "string" && WORD.test(t) && /^0x0{24}/.test(t) ? `0x${t.slice(26).toLowerCase()}` : null);
  /** A log topic as an unsigned integer up to `max`, or null. */
  const topicUint = (t, max) => {
    if (typeof t !== "string" || !WORD.test(t)) return null;
    const v = BigInt(t);
    return v <= BigInt(max) ? Number(v) : null;
  };

  /** The tokenId minted to `holder` by `address` in these logs: its Stamped log, else its Transfer from 0x0. Else null. */
  function mintedTokenId(logs, address, holder) {
    let viaTransfer = null;
    for (const log of logs) {
      if (!log || typeof log !== "object" || log.removed === true) continue;
      if (typeof log.address !== "string" || log.address.toLowerCase() !== address) continue; // this contract's logs only
      const t = log.topics;
      if (!Array.isArray(t) || t.length !== 4) continue;
      if (t[0] === TOPICS.Stamped && topicAddress(t[1]) === holder && topicUint(t[2], 255) !== null) {
        const id = topicUint(t[3], MAX_SERIAL);
        if (id !== null && id >= 1) return id;
      }
      if (t[0] === TOPICS.Transfer && viaTransfer === null && topicAddress(t[1]) === `0x${"0".repeat(40)}` && topicAddress(t[2]) === holder) {
        const id = topicUint(t[3], MAX_SERIAL);
        if (id !== null && id >= 1) viaTransfer = id;
      }
    }
    return viaTransfer;
  }

  /**
   * Where a sent mint stands (V1). Never throws. "pending": not mined yet, or the read failed (with `error`): poll
   * again. "success": mined, and this contract minted `tokenId` to the holder. "reverted": mined but failed, or mined
   * without minting a stamp to the holder. `holder` (optional) is mint()'s `from`; without it the tx sender is used,
   * which is right for every ordinary wallet but not for a smart-contract wallet whose tx is sent by a bundler.
   */
  async function receipt({ app, txHash, holder } = {}) {
    const cfg = config(app);
    if (!cfg) return { status: "pending", error: "stamps are not on chain yet" };
    if (typeof txHash !== "string" || !TX_HASH.test(txHash)) return { status: "pending", error: "not a transaction hash" };
    if (holder !== undefined && (typeof holder !== "string" || !ADDRESS.test(holder))) return { status: "pending", error: "not an address" };
    try {
      const r = await rpc(urlFor(cfg), "eth_getTransactionReceipt", [txHash]);
      if (r === null) return { status: "pending" };
      if (!r || typeof r !== "object" || Array.isArray(r)) throw new Error("the network sent no receipt");
      if (typeof r.transactionHash !== "string" || r.transactionHash.toLowerCase() !== txHash.toLowerCase()) throw new Error("the network sent another transaction's receipt");
      if (r.status === "0x0") return { status: "reverted" };
      if (r.status !== "0x1") throw new Error("the network sent a receipt with no status");
      const who = (holder ?? r.from)?.toLowerCase?.();
      if (typeof who !== "string" || !ADDRESS.test(who)) throw new Error("the network sent a receipt with no sender");
      if (!Array.isArray(r.logs)) throw new Error("the network sent a receipt with no logs");
      const tokenId = mintedTokenId(r.logs, cfg.address, who);
      if (tokenId === null) return { status: "reverted", error: "the transaction was mined but minted no stamp for this account" };
      return { status: "success", tokenId };
    } catch (err) {
      return { status: "pending", error: err?.message || String(err) };
    }
  }

  /** The stamp's SVG, exactly as tokenURI will draw it once minted as `tokenId` by `holder`. */
  function preview({ holder, stampId, tokenId, trait }) {
    if (!Number.isInteger(tokenId) || tokenId < 0 || tokenId > MAX_SERIAL) throw new TypeError("tokenId: 0..999999999");
    const seed = stampSeed(holder, stampId, tokenId);
    return badgeSvg({ seed, name: String(trait?.name ?? "").toUpperCase(), color: trait?.color, emblem: trait?.emblem, serial: tokenId });
  }

  /** provider.request with the person's refusal (EIP-1193 4001) mapped to code "rejected". */
  async function ask(provider, method, params) {
    try {
      return await provider.request(params === undefined ? { method } : { method, params });
    } catch (err) {
      if (hasCode(err, 4001)) throw stampsError("rejected", "cancelled in the wallet", err);
      throw err;
    }
  }

  async function ensureChain(provider, chain) {
    if (chainIdOf(await ask(provider, "eth_chainId")) === chain.chainId) return;
    try {
      await ask(provider, "wallet_switchEthereumChain", [{ chainId: chain.hex }]);
    } catch (err) {
      if (isStampsError(err)) throw err;
      if (!hasCode(err, 4902)) throw stampsError("wrong-chain", `switch the wallet to ${chain.name} and try again`, err);
      await ask(provider, "wallet_addEthereumChain", [addChainParams(chain)]);
      if (chainIdOf(await ask(provider, "eth_chainId")) !== chain.chainId) {
        await ask(provider, "wallet_switchEthereumChain", [{ chainId: chain.hex }]);
      }
    }
    if (chainIdOf(await ask(provider, "eth_chainId")) !== chain.chainId) throw stampsError("wrong-chain", `switch the wallet to ${chain.name} and try again`);
  }

  async function send({ provider, stampId, cfg }) {
    const chain = CHAINS[cfg.chainId];
    const { encode } = await codec(); // before any wallet prompt: fail early if offline
    try {
      await ensureChain(provider, chain);
      const accounts = await ask(provider, "eth_requestAccounts");
      const from = Array.isArray(accounts) ? accounts[0] : undefined;
      if (typeof from !== "string" || !ADDRESS.test(from)) throw stampsError("no-account", "the wallet shared no account");
      // Re-check for the account that will send (review V1): it may not be the one the card checked, and the
      // trait may have closed since. A definite "held" or "closed" stops here. A failed read does not: the card
      // only offers a mint after check() answered, the wallet simulates the call, and receipt() reports a revert.
      const c = await checkWith(cfg, from, stampId);
      if (!c.error && c.held) throw stampsError("held", "this wallet already holds this stamp");
      if (!c.error && !c.open) throw stampsError("closed", "this stamp is not open for minting right now");
      // The one and only send, pinned to the chain (V11): a wallet that moved network since the switch refuses it.
      // Whatever happens next, this call never sends again.
      const txHash = await ask(provider, "eth_sendTransaction", [{ from, to: cfg.address, data: encode("mint", [stampId]), chainId: chain.hex }]);
      if (typeof txHash !== "string" || !TX_HASH.test(txHash)) throw stampsError("wallet", "the wallet did not return a transaction; check it before trying again");
      return { txHash, explorerUrl: `${chain.explorer}/tx/${txHash}`, from };
    } catch (err) {
      if (isStampsError(err)) throw err;
      throw stampsError("wallet", err?.message ? `the wallet said: ${err.message}` : "the wallet failed", err);
    }
  }

  /** Mint the stamp once. A second call for the same stamp while the first is open gets the same promise. */
  function mint({ provider, stampId, app }) {
    const cfg = config(app);
    if (!cfg) return Promise.reject(stampsError("not-configured", "stamps are not on chain yet"));
    if (!provider || typeof provider.request !== "function") return Promise.reject(stampsError("no-wallet", "no wallet"));
    if (!Number.isInteger(stampId) || stampId < 0 || stampId > 255) return Promise.reject(stampsError("bad-stamp", "stampId: 0..255"));
    const key = `${cfg.chainId}:${cfg.address}:${stampId}`;
    if (inflight.has(key)) return inflight.get(key);
    const p = send({ provider, stampId, cfg }).finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  }

  return { config, owned, preview, check, mint, receipt };
}

const api = createStamps();
export const config = api.config;
export const owned = api.owned;
export const preview = api.preview;
export const check = api.check;
export const mint = api.mint;
export const receipt = api.receipt;
export default api;
