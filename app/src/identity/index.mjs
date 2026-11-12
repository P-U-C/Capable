// Identity (contract/citizen.d.ts IdentityAPI, docs/IDENTITY.md).
//
// Inside a host client (a Mini App) the host's SDK supplies the user, the
// wallet and the compose sheet. On the web, Sign In With Farcaster runs through
// the public relay and the signed message is verified (domain, our nonce,
// signature for the fid on Optimism) before anything is stored.
//
// This file is the first-paint surface: the stored identity (current,
// onChange, signOut), the QR encoder, and the synchronous answers that must not
// wait for a download (not a Mini App on a top-level page; the web share link,
// opened inside the tap's user gesture). Everything else is in ./flows.mjs,
// loaded through import() on first use; the SDK and the sign-in client are
// further lazy chunks behind it. Bundle with code splitting to keep them out.

import { current, onChange, signOut, sanitizeIdentity, KEY, _resetStore } from "./store.mjs";
import { qrSvg, qrDataUrl, qrMatrix } from "./qr.mjs";
import { state, DEFAULT_LOADERS, DEFAULT_TIMING, IdentityError, ERROR_CODES, RELAY_URL, OPTIMISM_RPC, COMPOSE_URL, knownMiniApp, settle, composeUrl, openCompose, makeNonce } from "./core.mjs";

export { current, onChange, signOut, sanitizeIdentity, qrSvg, qrDataUrl, qrMatrix };
export { IdentityError, ERROR_CODES, RELAY_URL, OPTIMISM_RPC, COMPOSE_URL, composeUrl, makeNonce };
export const STORAGE_KEY = KEY;
export const TIMING = DEFAULT_TIMING;

const flows = () => import("./flows.mjs");

/** True inside a host client as a Mini App. Resolves within 1.5 s; false on any error. */
export async function isMiniApp() {
  const known = knownMiniApp();
  if (known !== null) return known;
  return settle(async () => (await flows()).isMiniApp(), state.timing.detectMs, false);
}

/** Mini App: tell the host the app is ready (hides its splash). Otherwise a no-op. Never throws. */
export async function ready() {
  if (knownMiniApp() === false) return;
  try {
    await (await flows()).ready();
  } catch {
    /* the app runs the same without it */
  }
}

/**
 * Mini App: the host's context user (no prompt). Web: Sign In With Farcaster;
 * `onUrl` gets the https deep link to show as a QR code and a link. Rejects
 * with an IdentityError whose `code` is in ERROR_CODES; stores nothing unless
 * every check passed.
 */
export async function signIn(opts = {}) {
  if (opts?.signal?.aborted) throw new IdentityError("cancelled", "Sign-in was cancelled.");
  let f;
  try {
    f = await flows();
  } catch (e) {
    throw new IdentityError("network", "Sign-in could not reach the service: the sign-in code did not load.", e);
  }
  return f.signIn(opts);
}

/**
 * Share a line and a link. Mini App: the host's compose sheet. Web: the
 * compose page in a new tab, opened synchronously when we already know this
 * is not a host, so the tap still counts as a user gesture. Never posts.
 */
export function share(text, url) {
  if (knownMiniApp() === false) {
    openCompose(text, url);
    return Promise.resolve();
  }
  return flows().then((f) => f.share(text, url));
}

/** The Mini App host wallet, else an injected wallet (EIP-6963, then window.ethereum), else null. */
export async function wallet() {
  try {
    return await (await flows()).wallet();
  } catch {
    return null;
  }
}

/** The whole IdentityAPI as one object. */
export const identity = Object.freeze({ isMiniApp, ready, current, signIn, signOut, onChange, share, wallet });

// ---- tests only ----

/** Replace the lazy loaders: { miniapp: () => Promise<{ sdk }>, authClient: () => Promise<{ createAppClient, viemConnector }> }. */
export function _setLoaders(next = {}) {
  state.loaders = { ...DEFAULT_LOADERS, ...next };
  state.sdkPromise = null;
  state.authPromise = null;
  state.confirmedMiniApp = false;
}

/** Shorten timeouts and intervals. */
export function _setTiming(next = {}) {
  state.timing = { ...DEFAULT_TIMING, ...next };
}

/** Back to defaults: loaders, timing, caches, in-memory identity and subscribers. */
export function _reset() {
  _setLoaders();
  _setTiming();
  _resetStore();
}
