// The signed-in identity, kept in localStorage["capable.identity.v1"] and
// validated every time it is read. Everything in an identity came from the
// network (a relay or a host app), so every field is checked against an
// allow-list: the core (fid, source, signedInAt) must be valid or the whole
// record is dropped and the key removed; an optional field that fails is
// dropped on its own and the cleaned record is written back.
//
// This module imports nothing. It is the synchronous surface the app can load
// at first paint (current, onChange, signOut).

export const KEY = "capable.identity.v1";
export const SOURCES = Object.freeze(["miniapp", "siwf"]);

const MAX_RAW = 32 * 1024; // a stored record larger than this is not ours
const MAX_VERIFICATIONS = 32;
const USERNAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const ISO = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
// Control and invisible format characters: the same class as the contract's
// FORMAT_CHARS (contract/validate-app.mjs; a test checks the two stay equal).
// Copied rather than imported so the validator, and its banned-word list, stay
// out of the bundle. It allows tab, LF and CR (for multi-line text), so
// display names also refuse those (CONTROL_WS).
export const FORMAT_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb]/;
const CONTROL_WS = /[\t\n\r]/;
// A URL is printable ASCII without quotes, brackets of any kind, or backslash.
const URL_CHARS = /^[!#$%&*+,\-./0-9:;=?@A-Z_a-z~]+$/;

const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** A positive safe integer, or null. */
export function validFid(v) {
  return typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? v : null;
}

export function validUsername(v) {
  return typeof v === "string" && USERNAME.test(v) ? v : undefined;
}

/**
 * 1–80 characters (UTF-16 units, as the contract's isDisplayName counts), not
 * blank, no control or format characters, no lone surrogates.
 */
export function validDisplayName(v) {
  if (typeof v !== "string" || v.length < 1 || v.length > 80 || !v.trim()) return undefined;
  if (FORMAT_CHARS.test(v) || CONTROL_WS.test(v)) return undefined;
  if (typeof v.isWellFormed === "function" && !v.isWellFormed()) return undefined;
  return v;
}

/** An https URL of at most 2048 characters with a host and no credentials. */
export function validHttpsUrl(v) {
  if (typeof v !== "string" || v.length > 2048 || !/^https:\/\/[^/]/.test(v) || !URL_CHARS.test(v)) return undefined;
  let u;
  try {
    u = new URL(v);
  } catch {
    return undefined;
  }
  return u.protocol === "https:" && u.hostname && !u.username && !u.password ? v : undefined;
}

export function validAddress(v) {
  return typeof v === "string" && ADDRESS.test(v) ? v : undefined;
}

export function validIso(v) {
  if (typeof v !== "string") return null;
  const m = ISO.exec(v);
  if (!m) return null;
  const t = Date.parse(v);
  if (!Number.isFinite(t)) return null;
  // Reject dates that Date.parse rolls over (2026-02-31 → March).
  const d = new Date(t);
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() + 1 === +m[2] && d.getUTCDate() === +m[3] ? v : null;
}

/**
 * Validate an identity from anywhere (storage, a relay, a host app).
 * Returns { identity, dropped } with a fresh object holding only allowed
 * fields, or null when the core (fid, source, signedInAt) is invalid.
 */
export function sanitizeIdentity(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const fid = validFid(own(raw, "fid") ? raw.fid : undefined);
  const source = own(raw, "source") && SOURCES.includes(raw.source) ? raw.source : null;
  const signedInAt = validIso(own(raw, "signedInAt") ? raw.signedInAt : undefined);
  if (!fid || !source || !signedInAt) return null;
  const id = { fid };
  const dropped = [];
  const opt = (key, check) => {
    if (!own(raw, key) || raw[key] === undefined || raw[key] === null) return;
    const v = check(raw[key]);
    if (v === undefined) dropped.push(key);
    else id[key] = v;
  };
  opt("username", validUsername);
  opt("displayName", validDisplayName);
  opt("pfpUrl", validHttpsUrl);
  id.source = source;
  opt("custody", validAddress);
  opt("verifications", (list) => {
    if (!Array.isArray(list)) return undefined;
    const seen = new Set();
    const out = [];
    for (const a of list.slice(0, 256)) {
      if (!validAddress(a) || seen.has(a.toLowerCase())) continue;
      seen.add(a.toLowerCase());
      out.push(a);
      if (out.length === MAX_VERIFICATIONS) break;
    }
    if (out.length < list.length) dropped.push("verifications[]");
    return out.length ? out : undefined;
  });
  id.signedInAt = signedInAt;
  for (const k of Object.keys(raw)) if (!own(id, k) && !dropped.includes(k)) dropped.push(k);
  return { identity: id, dropped };
}

const freeze = (id) => {
  const copy = { ...id };
  if (copy.verifications) copy.verifications = Object.freeze([...copy.verifications]);
  return Object.freeze(copy);
};

// ---- storage ----

let memory = null; // used only when localStorage is missing or refuses writes
const listeners = new Set();
let watching = false;

function storage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // access itself can throw (sandboxed frames, blocked cookies)
  }
}

function removeStored(st) {
  try {
    st?.removeItem(KEY);
  } catch {
    /* nothing more we can do */
  }
}

/** The stored identity, or null. Bad data is cleared; dropped fields are rewritten. */
export function current() {
  const st = storage();
  if (!st) return memory ? freeze(memory) : null;
  let raw;
  try {
    raw = st.getItem(KEY);
  } catch {
    return memory ? freeze(memory) : null;
  }
  if (raw === null || raw === undefined) return memory ? freeze(memory) : null;
  let parsed = null;
  if (typeof raw === "string" && raw.length <= MAX_RAW) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
  }
  const clean = sanitizeIdentity(parsed);
  if (!clean) {
    memory = null;
    removeStored(st);
    return null;
  }
  if (clean.dropped.length) {
    try {
      st.setItem(KEY, JSON.stringify(clean.identity));
    } catch {
      /* read-only storage: the cleaned copy is still what we return */
    }
  }
  return freeze(clean.identity);
}

/** Store a validated identity and tell subscribers. Returns what was stored, or null. */
export function saveIdentity(raw) {
  const clean = sanitizeIdentity(raw);
  if (!clean) return null;
  const id = clean.identity;
  const st = storage();
  memory = id;
  if (st) {
    try {
      st.setItem(KEY, JSON.stringify(id));
      memory = null;
    } catch {
      removeStored(st); // full or disabled: keep it for this session only, and never let an older record win
    }
  }
  const out = freeze(id);
  notify(out);
  return out;
}

/** Forget the identity here. Nothing else is touched. */
export function signOut() {
  memory = null;
  removeStored(storage());
  notify(null);
}

function notify(id) {
  for (const fn of [...listeners]) {
    try {
      fn(id);
    } catch (err) {
      globalThis.reportError?.(err);
    }
  }
}

// Another tab signed in or out.
function onStorage(e) {
  if (e && (e.key === KEY || e.key === null)) notify(current());
}

/** Subscribe to sign-in and sign-out (here or in another tab). Returns an unsubscribe function. */
export function onChange(fn) {
  if (typeof fn !== "function") throw new TypeError("onChange needs a function");
  listeners.add(fn);
  if (!watching && typeof globalThis.addEventListener === "function") {
    globalThis.addEventListener("storage", onStorage);
    watching = true;
  }
  return () => {
    listeners.delete(fn);
    if (!listeners.size && watching) {
      globalThis.removeEventListener?.("storage", onStorage);
      watching = false;
    }
  };
}

/** Tests only: forget in-memory state and subscribers. */
export function _resetStore() {
  memory = null;
  listeners.clear();
  if (watching) globalThis.removeEventListener?.("storage", onStorage);
  watching = false;
}
