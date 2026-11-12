// Small pieces shared by the first-paint surface (./index.mjs) and the lazy
// flows (./flows.mjs): constants, the error type, mutable state (injectable
// for tests), and the synchronous checks that must not wait for a chunk.

import { validHttpsUrl } from "./store.mjs";

export const RELAY_URL = "https://relay.farcaster.xyz";
export const OPTIMISM_RPC = "https://mainnet.optimism.io";
export const COMPOSE_URL = "https://farcaster.xyz/~/compose";
export const ERROR_CODES = Object.freeze(["timeout", "cancelled", "rejected", "verify-failed", "network"]);

export const DEFAULT_TIMING = Object.freeze({
  detectMs: 1500, // isMiniApp() answers within this
  hostMs: 3000, // ready() and the host wallet lookup give up after this
  timeoutMs: 5 * 60 * 1000, // web sign-in: from start until the person approves
  pollMs: 1500, // relay status poll interval
  verifyMs: 30 * 1000, // signature check on Optimism
  eip6963Ms: 300, // wait for injected wallets to announce themselves
  maxMisses: 3, // consecutive failed polls before giving up as "network"
});

// The SDK and the sign-in client, each its own lazy chunk.
export const DEFAULT_LOADERS = Object.freeze({
  miniapp: () => import("./lazy-miniapp.mjs"),
  authClient: () => import("./lazy-auth.mjs"),
});

export const state = {
  loaders: { ...DEFAULT_LOADERS },
  timing: { ...DEFAULT_TIMING },
  sdkPromise: null,
  authPromise: null,
  confirmedMiniApp: false,
};

/** Every sign-in failure is one of these, with `code` in ERROR_CODES. */
export class IdentityError extends Error {
  constructor(code, message, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "IdentityError";
    this.code = code;
  }
}

export function windowOf() {
  const w = globalThis.window;
  return w && typeof w === "object" ? w : null;
}

/** Inside an iframe or a React Native WebView: the only places a host can be. */
function framed(w) {
  try {
    return Boolean(w.ReactNativeWebView) || w.parent !== w;
  } catch {
    return true;
  }
}

/** true / false when known without asking a host, else null. */
export function knownMiniApp() {
  if (state.confirmedMiniApp) return true;
  const w = windowOf();
  if (!w || !framed(w)) return false;
  return null;
}

/** `work` settled, or `fallback` on rejection or after `ms`. Never rejects. */
export function settle(work, ms, fallback) {
  let timer;
  const run = Promise.resolve()
    .then(work)
    .catch(() => fallback);
  return Promise.race([run, new Promise((r) => (timer = setTimeout(() => r(fallback), ms)))]).finally(() => clearTimeout(timer));
}

/** The web compose link for a line and a link (https only; anything else is left out). */
export function composeUrl(text, url) {
  const link = validHttpsUrl(url);
  let u = `${COMPOSE_URL}?text=${encodeURIComponent(String(text ?? "").slice(0, 1024))}`;
  if (link) u += `&embeds[]=${encodeURIComponent(link)}`;
  return u;
}

export function openCompose(text, url) {
  const w = windowOf();
  if (typeof w?.open === "function") w.open(composeUrl(text, url), "_blank", "noopener,noreferrer");
}

const ALNUM = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** A crypto-random alphanumeric nonce (no modulo bias). */
export function makeNonce(length = 24) {
  const out = [];
  const buf = new Uint8Array(length * 2);
  while (out.length < length) {
    globalThis.crypto.getRandomValues(buf);
    for (const b of buf) if (b < 248 && out.length < length) out.push(ALNUM[b % 62]);
  }
  return out.join("");
}
