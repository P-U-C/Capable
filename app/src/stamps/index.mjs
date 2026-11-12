// Stamps: soulbound badges on Base (contract/citizen.d.ts → StampsAPI; docs/STAMPS.md).
//
//   config(app)  → { chainId, address } from app.stamps, or null (not deployed: stamps stay local)
//   owned(addr)  → the address's stamps, read through a public JSON-RPC (no wallet)
//   preview(…)   → the exact SVG the contract draws for (holder, stampId, tokenId), offline
//   mint(…)      → switch/add the chain, send mint(stampId) once, return the tx hash
//
// First paint loads only this file, ./keccak.mjs and contract/badge-art.mjs. viem
// (ABI encode/decode) arrives with ./codec.mjs on the first owned() or mint().
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
const MAX_SERIAL = 999_999_999; // the contract's MAX_TOKEN_ID; badge-art prints serials < 10^9

/** An Error with a stable `code` for the UI: rejected, not-configured, no-wallet, bad-stamp, wrong-chain, no-account, wallet, offline. */
export function stampsError(code, message, cause) {
  const e = new Error(message, cause ? { cause } : undefined);
  e.code = code;
  e.name = "StampsError";
  return e;
}
const isStampsError = (e) => e instanceof Error && e.name === "StampsError" && typeof e.code === "string";

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

/** The StampTrait for an app Trait (contract/app.d.ts): the contract prints names in capitals. */
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
    if (body?.error) throw new Error(`the network refused the read (${body.error.code ?? "error"})`);
    if (typeof body?.result !== "string" || !/^0x[0-9a-fA-F]*$/.test(body.result)) throw new Error("the network sent no data");
    return body.result;
  }

  async function read(url, address, functionName, args) {
    const { encode, decode } = await codec();
    const result = await rpc(url, "eth_call", [{ to: address, data: encode(functionName, args) }, "latest"]);
    if (result === "0x") throw new Error("no stamps contract at the configured address");
    return decode(functionName, result);
  }

  /** The address's stamps on chain, sorted by tokenId. Never throws: [] plus a reason on any failure. */
  async function owned(address, opts = {}) {
    const cfg = opts.app ? config(opts.app) : current;
    if (!cfg) return { stamps: [], error: "stamps are not on chain yet" };
    if (typeof address !== "string" || !ADDRESS.test(address)) return { stamps: [], error: "not an address" };
    const url = opts.rpcUrl ?? rpcUrl ?? CHAINS[cfg.chainId].rpc;
    try {
      const ids = await read(url, cfg.address, "tokensOf", [address]);
      if (!Array.isArray(ids) || ids.length > 256) throw new Error("unexpected answer from the contract");
      const stampIds = await Promise.all(ids.map((id) => read(url, cfg.address, "stampOf", [id])));
      const stamps = ids.map((id, i) => {
        const tokenId = Number(id);
        const stampId = Number(stampIds[i]);
        if (typeof id !== "bigint" || id < 1n || id > BigInt(MAX_SERIAL) || !Number.isInteger(stampId) || stampId < 0 || stampId > 255) throw new Error("unexpected answer from the contract");
        return { tokenId, stampId };
      });
      stamps.sort((a, b) => a.tokenId - b.tokenId);
      return { stamps };
    } catch (err) {
      return { stamps: [], error: err?.message || String(err) };
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
      // The one and only send. Whatever happens next, this call never sends again.
      const txHash = await ask(provider, "eth_sendTransaction", [{ from, to: cfg.address, data: encode("mint", [stampId]) }]);
      if (typeof txHash !== "string" || !TX_HASH.test(txHash)) throw stampsError("wallet", "the wallet did not return a transaction; check it before trying again");
      return { txHash, explorerUrl: `${chain.explorer}/tx/${txHash}` };
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

  return { config, owned, preview, mint };
}

const api = createStamps();
export const config = api.config;
export const owned = api.owned;
export const preview = api.preview;
export const mint = api.mint;
export default api;
