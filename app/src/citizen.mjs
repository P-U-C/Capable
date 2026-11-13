// v3: what this browser keeps about the reader as a citizen, beside their
// progress (src/store.mjs), under the app's scoped key:
//
//   id      a random local id: seeds the signed-out portrait and the
//           placeholder holder of a stamp preview. Made on first use.
//   wallet  the wallet address, once a wallet has shared it (eth_accounts or
//           the mint), so previews and the passport can use it.
//   minted  per trait id, the mint transaction this browser submitted
//           ({ txHash, explorerUrl, chainId, contract }), so the trait card
//           never offers to send a second one and can link the first.
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

/** The localStorage key for an app served from `base`. */
export const citizenKey = (base = "/") => `capable.citizen@${String(base || "/")}`;

export const isAddress = (a) => typeof a === "string" && ADDRESS.test(a);

/** Keep only well-formed fields. */
export function sanitizeCitizen(raw) {
  const out = { id: null, wallet: null, minted: {} };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  if (typeof raw.id === "string" && ID.test(raw.id)) out.id = raw.id;
  if (isAddress(raw.wallet)) out.wallet = raw.wallet;
  const m = raw.minted;
  if (m && typeof m === "object" && !Array.isArray(m))
    for (const [k, v] of Object.entries(m)) {
      if (!TRAIT_ID.test(k) || !v || typeof v !== "object") continue;
      if (!TX.test(v.txHash) || typeof v.explorerUrl !== "string" || !EXPLORER.test(v.explorerUrl) || !v.explorerUrl.endsWith(v.txHash)) continue;
      out.minted[k] = {
        txHash: v.txHash,
        explorerUrl: v.explorerUrl,
        chainId: Number.isInteger(v.chainId) ? v.chainId : null,
        contract: isAddress(v.contract) ? v.contract.toLowerCase() : null,
      };
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
      storage?.setItem(key, JSON.stringify(state));
    } catch {
      /* full or disabled: keep it for the session */
    }
  };
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
    recordMint(traitId, rec) {
      const next = sanitizeCitizen({ ...state, minted: { ...state.minted, [traitId]: rec } });
      if (!next.minted[traitId]) return false;
      state = next;
      save();
      return true;
    },
  };
}

/**
 * The holder a stamp preview shows before anything is minted: the signed-in
 * person's first verified address, else the wallet address once a wallet has
 * shared it, else a stand-in derived from the local id.
 */
export function previewHolder(identity, citizen) {
  const v = identity?.verifications?.find?.(isAddress);
  if (v) return v;
  const w = citizen?.get?.().wallet;
  if (isAddress(w)) return w;
  return placeholderHolder(citizen?.localId?.() || "citizen");
}

/** Addresses whose on-chain stamps belong on this reader's passport: their first verified address and their wallet, once known. */
export function knownAddresses(identity, citizen) {
  const out = [];
  for (const a of [identity?.verifications?.find?.(isAddress), citizen?.get?.().wallet]) if (isAddress(a) && !out.some((x) => x.toLowerCase() === a.toLowerCase())) out.push(a);
  return out;
}
