// v3: what this browser keeps about the reader as a citizen, beside their
// progress (src/store.mjs), under the app's scoped key:
//
//   id      a random local id: seeds the signed-out portrait and the
//           placeholder holder of a stamp preview. Made on first use.
//   wallet  the wallet address a connected wallet shares without a prompt
//           (eth_accounts), for previews and this browser's own passport.
//           Seen silently, so it is never put in anything shared (review V9).
//   mints   the mint transactions this browser sent, keyed by
//           "<chainId>:<contract>:<stampId>" (review V8), so a new contract
//           (or chain) starts clean:
//             { txHash, explorerUrl, chainId, contract, stampId, from,
//               status: "pending" | "minted", tokenId, sentAt }
//           "pending" until a receipt says success ("minted", with the real
//           tokenId); a reverted or dropped transaction is forgotten, so the
//           mint can be offered again after a fresh check (review V1).
//   legacy  records the first v3 build kept by trait id, moved into `mints`
//           once the App says which stamp id each trait has (migrate(app)).
//
// Everything is validated on read, like the progress; storage may be missing,
// full or throwing, and then this lasts for the session. No keys, no
// signatures, nothing that leaves the browser.

import { keccak256, toHex } from "./stamps/keccak.mjs";

const ID = /^[0-9a-f]{20,64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const TX = /^0x[0-9a-fA-F]{64}$/;
const TRAIT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EXPLORER = /^https:\/\/(?:sepolia\.)?basescan\.org\/tx\/0x[0-9a-fA-F]{64}$/;
const MINT_KEY = /^([1-9]\d{0,9}):(0x[0-9a-f]{40}):(\d{1,3})$/;
const MAX_TOKEN = 999_999_999;

/** The localStorage key for an app served from `base`. */
export const citizenKey = (base = "/") => `capable.citizen@${String(base || "/")}`;

export const isAddress = (a) => typeof a === "string" && ADDRESS.test(a);

/** A mint record's key: the chain, the contract and the stamp, so a record never carries over to another contract (review V8). */
export const mintKey = (chainId, contract, stampId) => `${chainId}:${String(contract).toLowerCase()}:${stampId}`;

const isStampId = (n) => Number.isInteger(n) && n >= 0 && n <= 255;
const isTokenId = (n) => Number.isInteger(n) && n >= 1 && n <= MAX_TOKEN;
const goodTx = (v) => v && typeof v === "object" && TX.test(v.txHash) && typeof v.explorerUrl === "string" && EXPLORER.test(v.explorerUrl) && v.explorerUrl.endsWith(v.txHash);

/** One mint record under `key`, or null when anything is off (including a key that disagrees with the record). */
function sanitizeMint(key, v) {
  const m = MINT_KEY.exec(key);
  if (!m || !goodTx(v)) return null;
  const chainId = Number(m[1]);
  const contract = m[2];
  const stampId = Number(m[3]);
  if (!isStampId(stampId) || v.chainId !== chainId || String(v.contract).toLowerCase() !== contract || v.stampId !== stampId) return null;
  const status = v.status === "minted" ? "minted" : "pending";
  return {
    txHash: v.txHash,
    explorerUrl: v.explorerUrl,
    chainId,
    contract,
    stampId,
    from: isAddress(v.from) ? v.from.toLowerCase() : null,
    status,
    tokenId: status === "minted" && isTokenId(v.tokenId) ? v.tokenId : null,
    sentAt: Number.isFinite(v.sentAt) && v.sentAt > 0 ? v.sentAt : null,
  };
}

/** Keep only well-formed fields. */
export function sanitizeCitizen(raw) {
  const out = { id: null, wallet: null, mints: {}, legacy: {} };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  if (typeof raw.id === "string" && ID.test(raw.id)) out.id = raw.id;
  if (isAddress(raw.wallet)) out.wallet = raw.wallet;
  const m = raw.mints;
  if (m && typeof m === "object" && !Array.isArray(m))
    for (const [k, v] of Object.entries(m)) {
      const rec = sanitizeMint(k, v);
      if (rec) out.mints[k] = rec;
    }
  // the first v3 build: { minted: { <trait id>: { txHash, explorerUrl, chainId, contract } } }; kept by trait until migrate(app)
  for (const src of [raw.legacy, raw.minted]) {
    if (!src || typeof src !== "object" || Array.isArray(src)) continue;
    for (const [k, v] of Object.entries(src)) {
      if (!TRAIT_ID.test(k) || !goodTx(v) || !Number.isInteger(v.chainId) || v.chainId < 1 || !isAddress(v.contract) || out.legacy[k]) continue;
      out.legacy[k] = { txHash: v.txHash, explorerUrl: v.explorerUrl, chainId: v.chainId, contract: v.contract.toLowerCase() };
    }
  }
  return out;
}

/** 20 random bytes as hex (a local id); Math.random only where no crypto exists. */
export function randomId(cryptoImpl = globalThis.crypto) {
  const b = new Uint8Array(20);
  if (cryptoImpl?.getRandomValues) cryptoImpl.getRandomValues(b);
  else for (let i = 0; i < b.length; i++) b[i] = Math.floor(Math.random() * 256);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/**
 * A stand-in holder for a stamp preview when no address is known: an address
 * derived from the local id, so the preview is stable in this browser and
 * looks like nobody's real account.
 */
export function placeholderHolder(localId) {
  const bytes = new TextEncoder().encode(`capable:local:${localId}`);
  return `0x${toHex(keccak256(bytes)).replace(/^0x/, "").slice(-40)}`;
}

export function openCitizen(storage, { key = citizenKey("/"), random = randomId } = {}) {
  let state;
  try {
    state = sanitizeCitizen(JSON.parse(storage?.getItem(key) || "null"));
  } catch {
    state = sanitizeCitizen(null);
  }
  const save = () => {
    try {
      const { legacy, ...rest } = state;
      storage?.setItem(key, JSON.stringify(Object.keys(legacy).length ? state : rest));
    } catch {
      /* full or disabled: keep it for the session */
    }
  };
  const keyOf = (cfg, stampId) => (cfg && Number.isInteger(cfg.chainId) && isAddress(cfg.address) && isStampId(stampId) ? mintKey(cfg.chainId, cfg.address, stampId) : null);
  return {
    key,
    get: () => state,
    /** The local id, made (and kept) on first use. */
    localId() {
      if (!state.id) {
        const id = random();
        state = { ...state, id: ID.test(id) ? id : randomId() };
        save();
      }
      return state.id;
    },
    setWallet(address) {
      if (!isAddress(address) || state.wallet?.toLowerCase() === address.toLowerCase()) return;
      state = { ...state, wallet: address };
      save();
    },
    /** Move records kept by trait id (the first v3 build) to their (chain, contract, stamp) key, using the App's stamp ids. Idempotent. */
    migrate(app) {
      const ids = Object.keys(state.legacy);
      if (!ids.length) return false;
      const mints = { ...state.mints };
      const legacy = { ...state.legacy };
      for (const traitId of ids) {
        const t = (app?.traits || []).find((x) => x?.id === traitId);
        if (!t || !isStampId(t.stampId)) continue; // the App can't say yet: keep it
        const old = legacy[traitId];
        delete legacy[traitId];
        const k = mintKey(old.chainId, old.contract, t.stampId);
        if (mints[k]) continue;
        // what the old build called "sent" was never confirmed: pending, checked again on the next view
        const rec = sanitizeMint(k, { ...old, stampId: t.stampId, status: "pending" });
        if (rec) mints[k] = rec;
      }
      state = { ...state, mints, legacy };
      save();
      return true;
    },
    /** The record for this stamp on this contract (cfg: StampsAPI.config(app)), or null. */
    mintFor(cfg, stampId) {
      const k = keyOf(cfg, stampId);
      return (k && state.mints[k]) || null;
    },
    /** Every record for this contract, by stamp id. */
    mintsFor(cfg) {
      const out = new Map();
      if (!keyOf(cfg, 0)) return out;
      for (const rec of Object.values(state.mints)) if (rec.chainId === cfg.chainId && rec.contract === cfg.address.toLowerCase()) out.set(rec.stampId, rec);
      return out;
    },
    /** Remember a mint (validated): `rec` without chainId/contract/stampId, which come from cfg and stampId. */
    recordMint(cfg, stampId, rec) {
      const k = keyOf(cfg, stampId);
      if (!k) return false;
      const clean = sanitizeMint(k, { ...rec, chainId: cfg.chainId, contract: cfg.address.toLowerCase(), stampId });
      if (!clean) return false;
      state = { ...state, mints: { ...state.mints, [k]: clean } };
      save();
      return true;
    },
    /** Forget a record: its transaction reverted or never landed, so the mint may be offered again after a fresh check. */
    forgetMint(cfg, stampId) {
      const k = keyOf(cfg, stampId);
      if (!k || !state.mints[k]) return false;
      const { [k]: _gone, ...mints } = state.mints;
      state = { ...state, mints };
      save();
      return true;
    },
    /** Sign-out (review T5): forget the wallet address and the mint records, so the next person on this browser sees none of them. */
    forgetWallet() {
      state = { ...state, wallet: null, mints: {}, legacy: {} };
      save();
    },
  };
}

// Review V14: a signed-in identity's `verifications` come from the sign-in
// relay and are not covered by the signature, so they are never taken as
// proof that the person owns an address. The connected wallet's account comes
// first everywhere; verifications are a last resort for local display only,
// and never go into anything shared.

/**
 * The holder a stamp preview shows before anything is minted: the connected
 * wallet's account once it has shared one, else the signed-in person's first
 * listed address, else a stand-in derived from the local id. Only a preview:
 * the card says the pattern is set when the stamp is added (review V12).
 */
export function previewHolder(identity, citizen) {
  const w = citizen?.get?.().wallet;
  if (isAddress(w)) return w;
  const v = identity?.verifications?.find?.(isAddress);
  if (v) return v;
  return placeholderHolder(citizen?.localId?.() || "citizen");
}

/** The addresses that minted from this browser for this contract (the person chose each one in their wallet), minted first. */
function mintedFrom(citizen, cfg) {
  const recs = cfg && citizen?.mintsFor ? [...citizen.mintsFor(cfg).values()] : [];
  recs.sort((a, b) => (a.status === b.status ? 0 : a.status === "minted" ? -1 : 1));
  return recs.map((r) => r.from).filter(isAddress);
}

/**
 * Addresses whose on-chain stamps this browser's passport shows: the ones
 * minted from here, the connected wallet's account, then (display only, V14)
 * the signed-in person's first listed address. Never shared.
 */
export function knownAddresses(identity, citizen, cfg = null) {
  const out = [];
  for (const a of [...mintedFrom(citizen, cfg), citizen?.get?.().wallet, identity?.verifications?.find?.(isAddress)]) if (isAddress(a) && !out.some((x) => x.toLowerCase() === a.toLowerCase())) out.push(a);
  return out;
}

/**
 * The address a share (and the "your public passport" link) may carry
 * (review V9, V14): one the reader chose in their own wallet here, by minting
 * from it. Never a wallet seen silently, never the relay's unsigned list.
 * Null when there is none: the share links the app only.
 */
export function chosenAddress(identity, citizen, cfg) {
  if (!cfg) return null;
  return mintedFrom(citizen, cfg)[0]?.toLowerCase() ?? null;
}
