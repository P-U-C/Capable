// The identity flows, loaded through import() from ./index.mjs on first use:
// Mini App detection and context, web Sign In With Farcaster with
// verification, the host compose sheet, and wallet discovery. The SDK and the
// sign-in client are themselves further lazy chunks (./core.mjs loaders).

import { saveIdentity, sanitizeIdentity, validFid, validAddress, validHttpsUrl } from "./store.mjs";
import { state, IdentityError, RELAY_URL, OPTIMISM_RPC, knownMiniApp, settle, windowOf, openCompose, makeNonce } from "./core.mjs";

const cancelled = (cause) => new IdentityError("cancelled", "Sign-in was cancelled.", cause);
const timedOut = () => new IdentityError("timeout", "Sign-in timed out before it was approved.");
const rejected = (why, cause) => new IdentityError("rejected", `Sign-in was declined or closed: ${why}.`, cause);
const verifyFailed = (why, cause) => new IdentityError("verify-failed", `Sign-in could not be verified: ${why}.`, cause);
const network = (why, cause) => new IdentityError("network", `Sign-in could not reach the service: ${why}.`, cause);
const asIdentityError = (e, otherwise) => (e instanceof IdentityError ? e : otherwise());

function lazy(load, check) {
  const p = Promise.resolve()
    .then(load)
    .then((m) => {
      const v = check(m);
      if (!v) throw new Error("module did not load");
      return v;
    });
  return p;
}

function getSdk() {
  if (!state.sdkPromise) {
    const p = lazy(state.loaders.miniapp, (m) => {
      const sdk = m?.sdk ?? m?.default;
      return sdk && typeof sdk === "object" ? sdk : null;
    });
    state.sdkPromise = p;
    p.catch(() => state.sdkPromise === p && (state.sdkPromise = null)); // a failed chunk load can be retried
  }
  return state.sdkPromise;
}

function getAuthClient() {
  if (!state.authPromise) {
    const p = lazy(state.loaders.authClient, (m) => (typeof m?.createAppClient === "function" && typeof m?.viemConnector === "function" ? m : null));
    state.authPromise = p;
    p.catch(() => state.authPromise === p && (state.authPromise = null));
  }
  return state.authPromise;
}

// ---- small helpers ----

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** `work` raced against `signal` (→ cancelled) and `deadline` (→ onTimeout()). */
function within(work, signal, deadline, onTimeout = timedOut) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(cancelled());
    const left = deadline - Date.now();
    if (left <= 0) return reject(onTimeout());
    let timer = null;
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener?.("abort", abort);
    };
    const abort = () => {
      done();
      reject(cancelled());
    };
    timer = setTimeout(() => {
      done();
      reject(onTimeout());
    }, left);
    signal?.addEventListener?.("abort", abort, { once: true });
    Promise.resolve()
      .then(work)
      .then(
        (v) => {
          done();
          resolve(v);
        },
        (e) => {
          done();
          reject(e);
        },
      );
  });
}

function looksOffline(e) {
  for (let i = 0, x = e; x && i < 6; i++, x = x.cause) {
    const s = `${x.name || ""} ${x.message || ""} ${x.code || ""}`;
    if (/HttpRequestError|TimeoutError|fetch failed|Failed to fetch|NetworkError|Load failed|ECONN|ENOTFOUND|EAI_AGAIN/i.test(s)) return true;
  }
  return false;
}

// ---- flows ----

/** True inside a host client as a Mini App. Resolves within 1.5 s; false on any error. */
export async function isMiniApp() {
  try {
    const known = knownMiniApp();
    if (known !== null) return known;
    const yes = await settle(async () => (await (await getSdk()).isInMiniApp()) === true, state.timing.detectMs, false);
    if (yes) state.confirmedMiniApp = true;
    return yes;
  } catch {
    return false;
  }
}

/** Mini App: tell the host the app is ready (hides its splash). Otherwise a no-op. Never throws. */
export async function ready() {
  try {
    if (!(await isMiniApp())) return;
    const sdk = await getSdk();
    await settle(() => sdk.actions.ready(), state.timing.hostMs, undefined);
  } catch {
    /* the app runs the same without it */
  }
}

/**
 * Mini App: the host's context user (no prompt). Web: Sign In With Farcaster.
 * Rejects with an IdentityError (code in ERROR_CODES); stores nothing unless
 * every check passed.
 */
export async function signIn(opts = {}) {
  const { onUrl, signal } = opts ?? {};
  if (signal?.aborted) throw cancelled();
  if (await isMiniApp()) return signInMiniApp(signal);
  return signInWeb(onUrl, signal);
}

async function signInMiniApp(signal) {
  const deadline = Date.now() + state.timing.timeoutMs;
  let sdk;
  let ctx;
  try {
    sdk = await within(getSdk, signal, deadline);
    ctx = await within(() => sdk.context, signal, deadline);
  } catch (e) {
    throw asIdentityError(e, () => network("the host did not answer", e));
  }
  const u = ctx && typeof ctx === "object" && ctx.user && typeof ctx.user === "object" ? ctx.user : {};
  const clean = sanitizeIdentity({
    fid: u.fid,
    username: u.username,
    displayName: u.displayName,
    pfpUrl: u.pfpUrl,
    source: "miniapp",
    signedInAt: new Date().toISOString(),
  });
  if (!clean) throw verifyFailed("the host shared no valid account");
  if (signal?.aborted) throw cancelled();
  return saveIdentity(clean.identity);
}

const REJECTING = new Set(["unauthenticated", "unauthorized", "not_found", "bad_request", "bad_request.validation_failure"]);

/** The IdentityError for a failed relay response, or null when it is usable. */
function relayFailure(res, why) {
  if (!res || typeof res !== "object") return network("the relay sent nothing");
  if (res.isError) return REJECTING.has(res.error?.errCode) ? rejected(why, res.error) : network("the relay did not answer", res.error);
  const status = res.response?.status;
  if (typeof status === "number") {
    if (status >= 400 && status < 500 && status !== 408 && status !== 429) return rejected(`${why} (${status})`);
    if (status < 200 || status >= 300) return network(`the relay answered ${status}`);
  }
  if (!res.data || typeof res.data !== "object") return network("the relay sent no data");
  return null;
}

async function signInWeb(onUrl, signal) {
  const deadline = Date.now() + state.timing.timeoutMs;
  const loc = globalThis.location;
  const domain = typeof loc?.host === "string" ? loc.host : "";
  const siweUri = typeof loc?.origin === "string" && typeof loc?.pathname === "string" ? loc.origin + loc.pathname : "";
  if (!domain || !/^https?:\/\/[^/]/.test(siweUri)) throw rejected("this page has no web address to sign in to");
  let nonce;
  try {
    nonce = makeNonce();
  } catch (e) {
    throw rejected("this browser cannot make a secure nonce", e);
  }

  let client;
  try {
    const ac = await within(getAuthClient, signal, deadline);
    client = ac.createAppClient({ relay: RELAY_URL, ethereum: ac.viemConnector({ rpcUrl: OPTIMISM_RPC }) });
  } catch (e) {
    throw asIdentityError(e, () => network("the sign-in code did not load", e));
  }

  // 1. Open a channel on the relay for our domain, page and nonce.
  let ch;
  try {
    ch = await within(() => client.createChannel({ siweUri, domain, nonce }), signal, deadline);
  } catch (e) {
    throw asIdentityError(e, () => network("the relay did not answer", e));
  }
  const chFail = relayFailure(ch, "the relay refused to open a channel");
  if (chFail) throw chFail;
  const { channelToken, url } = ch.data;
  if (typeof channelToken !== "string" || !channelToken || channelToken.length > 512) throw network("the relay sent no channel");
  const link = validHttpsUrl(url);
  if (!link) throw network("the relay sent no https link");
  if (ch.data.nonce !== undefined && ch.data.nonce !== nonce) throw verifyFailed("the relay changed the nonce");

  // 2. Show the link; wait for the person to approve it in their client.
  if (typeof onUrl === "function") {
    try {
      onUrl(link);
    } catch (e) {
      throw cancelled(e);
    }
  }
  let done = null;
  let misses = 0;
  for (;;) {
    let st;
    try {
      st = await within(() => client.status({ channelToken }), signal, deadline);
    } catch (e) {
      if (e instanceof IdentityError) throw e;
      st = { isError: true, error: e };
    }
    const f = relayFailure(st, "the request was closed");
    if (f) {
      if (f.code === "rejected" || ++misses >= state.timing.maxMisses) throw f;
    } else {
      misses = 0;
      if (st.data.state === "completed") {
        done = st.data;
        break;
      }
    }
    await within(() => sleep(state.timing.pollMs), signal, deadline);
  }

  // 3. Verify the signed message ourselves before keeping anything.
  const { message, signature } = done;
  if (typeof message !== "string" || !message || typeof signature !== "string" || !signature) throw rejected("no signed message came back");
  if (message.length > 8192 || !/^0x[0-9a-fA-F]{2,2048}$/.test(signature)) throw verifyFailed("the signed message is malformed");
  let v;
  try {
    v = await within(() => client.verifySignInMessage({ nonce, domain, message, signature }), signal, Date.now() + state.timing.verifyMs, () =>
      network("the signature check did not finish in time"),
    );
  } catch (e) {
    throw asIdentityError(e, () => (looksOffline(e) ? network("the signature check could not reach Optimism", e) : verifyFailed("the signature did not check out", e)));
  }
  if (!v || typeof v !== "object") throw verifyFailed("the signature check returned nothing");
  if (v.isError) {
    const err = v.error;
    throw err?.errCode === "unavailable" || looksOffline(err) ? network("the signature check could not reach Optimism", err) : verifyFailed(err?.message || "the signature did not check out", err);
  }
  if (v.success !== true) throw verifyFailed("the signature did not check out");
  const msg = v.data;
  if (!msg || typeof msg !== "object" || msg.nonce !== nonce) throw verifyFailed("the nonce does not match");
  if (msg.domain !== domain) throw verifyFailed("the domain does not match");
  const fid = validFid(v.fid);
  if (!fid) throw verifyFailed("no account was signed for");
  if (done.fid !== undefined && done.fid !== null && done.fid !== fid) throw verifyFailed("the relay and the signature name different accounts");
  const signer = validAddress(msg.address);

  if (signal?.aborted) throw cancelled();
  const saved = saveIdentity({
    fid,
    username: done.username,
    displayName: done.displayName,
    pfpUrl: done.pfpUrl,
    custody: v.authMethod === "authAddress" ? undefined : signer, // the custody address that signed
    verifications: done.verifications,
    source: "siwf",
    signedInAt: new Date().toISOString(),
  });
  if (!saved) throw verifyFailed("the account data was not valid");
  return saved;
}

/** Share inside a host (the index handles the plain web synchronously). */
export async function share(text, url) {
  if (await isMiniApp()) {
    const sdk = await getSdk();
    const link = validHttpsUrl(url);
    await sdk.actions.composeCast({ text: String(text ?? "").slice(0, 1024), embeds: link ? [link] : [] });
    return;
  }
  openCompose(text, url);
}

const isProvider = (p) => Boolean(p) && (typeof p === "object" || typeof p === "function") && typeof p.request === "function";

function injected(w) {
  try {
    return isProvider(w.ethereum) ? w.ethereum : null;
  } catch {
    return null;
  }
}

/** EIP-6963: ask wallets to announce themselves; take the first, else window.ethereum, else null. */
function discoverWallet() {
  const w = windowOf();
  if (!w) return Promise.resolve(null);
  return new Promise((resolve) => {
    let timer = null;
    let over = false;
    const finish = (p) => {
      if (over) return;
      over = true;
      clearTimeout(timer);
      try {
        w.removeEventListener?.("eip6963:announceProvider", onAnnounce);
      } catch {
        /* ignore */
      }
      resolve(p || injected(w));
    };
    const onAnnounce = (e) => {
      const p = e?.detail?.provider;
      if (isProvider(p)) finish(p);
    };
    try {
      w.addEventListener?.("eip6963:announceProvider", onAnnounce);
      w.dispatchEvent?.(new Event("eip6963:requestProvider"));
    } catch {
      /* no events here */
    }
    if (!over) timer = setTimeout(() => finish(null), state.timing.eip6963Ms);
  });
}

/** The Mini App host wallet, else an injected wallet (EIP-6963, then window.ethereum), else null. */
export async function wallet() {
  try {
    if (await isMiniApp()) {
      const sdk = await getSdk();
      const p = await settle(() => sdk.wallet.getEthereumProvider(), state.timing.hostMs, undefined);
      if (isProvider(p)) return p;
    }
  } catch {
    /* fall through to the browser's wallets */
  }
  return discoverWallet();
}
