// I3 — identity storage and safety: localStorage["capable.identity.v1"] is
// validated on every read; a bad core clears the key; a bad optional field is
// dropped (and the cleaned record written back); sign-out clears; untrusted
// fields are allow-listed (https pfp, username pattern, display name without
// control or format characters) and stay text when rendered.
import test from "node:test";
import assert from "node:assert/strict";
import * as id from "../src/identity/index.mjs";
import { saveIdentity, sanitizeIdentity, validDisplayName, FORMAT_CHARS, KEY } from "../src/identity/store.mjs";
import { FORMAT_CHARS as CONTRACT_FORMAT_CHARS, isDisplayName } from "../../contract/validate-app.mjs";
import { html } from "../src/html.mjs";

// ---- shims: a memory localStorage and a window that carries storage events ----

function memoryStorage() {
  const m = new Map();
  return {
    m,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
  };
}
const define = (name, value) => Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
let ls;
let win;
test.beforeEach(() => {
  id._reset();
  ls = memoryStorage();
  define("localStorage", ls);
  win = new EventTarget();
  win.parent = win;
  define("window", win);
  define("addEventListener", win.addEventListener.bind(win));
  define("removeEventListener", win.removeEventListener.bind(win));
});
test.after(() => {
  id._reset();
  for (const k of ["localStorage", "window", "addEventListener", "removeEventListener"]) delete globalThis[k];
});

const FULL = Object.freeze({
  fid: 1234,
  username: "alice.eth",
  displayName: "Alice Teapot",
  pfpUrl: "https://imagedelivery.net/abc/def/original",
  source: "siwf",
  custody: "0x63C378DDC446DFf1d831B9B96F7d338FE6bd4231",
  verifications: ["0x8fc5d6afe572fefc4ec153587b63ce543f6fa2ea"],
  signedInAt: "2026-11-12T19:06:15.123Z",
});
const put = (value) => ls.setItem(KEY, typeof value === "string" ? value : JSON.stringify(value));
const stored = () => (ls.getItem(KEY) === null ? null : JSON.parse(ls.getItem(KEY)));

test("the key is capable.identity.v1 and a valid identity round-trips through current()", () => {
  assert.equal(id.STORAGE_KEY, "capable.identity.v1");
  assert.equal(id.current(), null, "nothing stored \u2192 null");
  put(FULL);
  assert.deepEqual({ ...id.current(), verifications: [...id.current().verifications] }, FULL);
  assert.deepEqual(stored(), FULL, "a clean record is left as it was");
  const minimal = { fid: 1, source: "miniapp", signedInAt: "2026-11-12T19:06:15Z" };
  put(minimal);
  assert.deepEqual({ ...id.current() }, minimal);
});

test("a bad core (fid, source, signedInAt) or unreadable data \u2192 null and the key is removed", () => {
  const bad = [
    "not json",
    "{",
    "[]",
    "null",
    "42",
    '"text"',
    JSON.stringify([FULL]),
    { ...FULL, fid: 0 },
    { ...FULL, fid: -1 },
    { ...FULL, fid: 1.5 },
    { ...FULL, fid: "1234" },
    { ...FULL, fid: 2 ** 53 },
    { ...FULL, fid: null },
    { ...FULL, fid: undefined },
    { ...FULL, source: "web" },
    { ...FULL, source: "MINIAPP" },
    { ...FULL, source: undefined },
    { ...FULL, signedInAt: "yesterday" },
    { ...FULL, signedInAt: "2026-11-12" },
    { ...FULL, signedInAt: "2026-02-31T00:00:00Z" },
    { ...FULL, signedInAt: "2026-11-12T19:06:15+01:00" },
    { ...FULL, signedInAt: 1731438375 },
    { ...FULL, signedInAt: undefined },
    "x".repeat(40 * 1024),
    JSON.stringify({ ...FULL, padding: "y".repeat(33 * 1024) }), // larger than any record we write
  ];
  for (const value of bad) {
    put(value);
    assert.equal(id.current(), null, String(typeof value === "string" ? value.slice(0, 40) : JSON.stringify(value).slice(0, 80)));
    assert.equal(ls.getItem(KEY), null, "key removed");
  }
});

test("hostile optional fields are dropped one by one; the core is kept and the cleaned record is written back", () => {
  const cases = {
    pfpUrl: [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      "data:image/svg+xml,<svg onload=alert(1)>",
      "http://example.com/a.png",
      "//evil.example/a.png",
      "/relative.png",
      'https://x.example/a.png" onerror="alert(1)',
      "https://x.example/a.png'onerror='alert(1)",
      "https://x.example/<script>.png",
      "https://x.example/a.png)background:url(evil",
      "https://x.example/[a].png",
      "https://x.example/{a}.png",
      "https://x.example\\@evil.example/a.png",
      "https://x.example/a b.png",
      "https://x.example/a\n.png",
      "https://user:pass@x.example/a.png",
      "https://x.example/\u00E9.png",
      "https:///a.png",
      "https://x.example/" + "a".repeat(2049 - 18),
      42,
      ["https://x.example/a.png"],
      { href: "https://x.example/a.png" },
    ],
    displayName: [
      "evil\u202Egnp.exe", // RTL override
      "a\u202Ab", // LRE
      "a\u2066b", // LRI
      "a\u200Bb", // zero-width space
      "a\u200Fb", // RLM
      "a\u061Cb", // Arabic letter mark
      "a\u2028b", // line separator
      "a\uFEFFb", // BOM
      "a\u2060b", // word joiner
      "line\nbreak",
      "tab\there",
      "cr\rhere",
      "soft\u00ADhyphen",
      "mongolian\u180Evs",
      "anchor\uFFF9x",
      "nul\u0000",
      "del\u007F",
      "c1\u0085",
      "",
      "   ",
      "x".repeat(81),
      "\uD83D\uDE42".repeat(40) + "x", // 81 UTF-16 units
      "\uD800lone",
      7,
      null,
    ],
    username: [
      "a".repeat(10 * 1024),
      "a".repeat(65),
      "Alice",
      "_alice",
      ".alice",
      "-alice",
      "al ice",
      "@alice",
      "al/ice",
      "al\u202Eice",
      "",
      12,
    ],
    custody: ["0x123", "0x" + "g".repeat(40), "63C378DDC446DFf1d831B9B96F7d338FE6bd4231", "0x" + "a".repeat(41), 1],
    verifications: ["0x8fc5d6afe572fefc4ec153587b63ce543f6fa2ea", [], ["not an address"], { 0: "0x8fc5d6afe572fefc4ec153587b63ce543f6fa2ea" }],
  };
  for (const [field, values] of Object.entries(cases)) {
    for (const value of values) {
      if (value === null) continue; // null means "absent", covered below
      put({ ...FULL, [field]: value });
      const got = id.current();
      const label = `${field}=${JSON.stringify(value)?.slice(0, 60)}`;
      assert.ok(got, `${label}: the identity survives`);
      assert.equal(got.fid, FULL.fid, label);
      assert.equal(got.source, FULL.source, label);
      assert.ok(!(field in got), `${label}: dropped`);
      for (const other of ["username", "displayName", "pfpUrl", "custody"]) if (other !== field) assert.equal(got[other], FULL[other], `${label}: ${other} kept`);
      const back = stored();
      assert.ok(back && !(field in back), `${label}: written back without it`);
      if (typeof value === "string" && value.length > 3 && !JSON.stringify(FULL).includes(value)) assert.ok(!ls.getItem(KEY).includes(JSON.stringify(value).slice(1, -1)), `${label}: hostile bytes gone from storage`);
    }
  }
});

test("a 10 KB username is dropped without losing the account; the record stays small", () => {
  put({ ...FULL, username: "u".repeat(10 * 1024) });
  const got = id.current();
  assert.equal(got.fid, 1234);
  assert.equal(got.username, undefined);
  assert.ok(ls.getItem(KEY).length < 600, `rewritten record is ${ls.getItem(KEY).length} bytes`);
});

test("boundaries: username 64, display name 80 UTF-16 units, pfp 2048 chars, verifications deduped and capped", () => {
  const max = "https://x.example/" + "a".repeat(2048 - 18);
  const name80 = "\uD83D\uDE42".repeat(20) + "x".repeat(40); // 80 UTF-16 units, as the contract counts
  const many = Array.from({ length: 40 }, (_, i) => "0x" + i.toString(16).padStart(40, "0"));
  put({ ...FULL, username: "a" + "b".repeat(63), displayName: name80, pfpUrl: max, verifications: [FULL.verifications[0], FULL.verifications[0].toUpperCase().replace("0X", "0x"), 5, null, ...many] });
  const got = id.current();
  assert.equal(got.username.length, 64);
  assert.equal(got.displayName, name80);
  assert.equal(got.pfpUrl.length, 2048);
  assert.equal(got.verifications.length, 32, "capped at 32");
  assert.equal(got.verifications[0], FULL.verifications[0]);
  assert.equal(new Set(got.verifications.map((a) => a.toLowerCase())).size, 32, "deduped regardless of case");
});

test("unknown fields and __proto__ are dropped without polluting prototypes", () => {
  put('{"fid":7,"source":"siwf","signedInAt":"2026-11-12T19:06:15Z","__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"isAdmin":true,"bio":"<b>x</b>"}');
  const got = id.current();
  assert.deepEqual(Object.keys(got).sort(), ["fid", "signedInAt", "source"]);
  assert.equal({}.polluted, undefined);
  assert.equal(Object.prototype.polluted, undefined);
  assert.deepEqual(Object.keys(stored()).sort(), ["fid", "signedInAt", "source"], "written back clean");
});

test("current() hands out a frozen copy; mutating it changes nothing stored", () => {
  put(FULL);
  const a = id.current();
  assert.ok(Object.isFrozen(a) && Object.isFrozen(a.verifications));
  assert.throws(() => {
    "use strict";
    a.fid = 1;
  });
  assert.equal(id.current().fid, 1234);
});

test("sign-out clears the key and tells subscribers; unsubscribe works; a throwing subscriber does not stop others", () => {
  put(FULL);
  const seen = [];
  const bad = id.onChange(() => {
    throw new Error("subscriber bug");
  });
  const off = id.onChange((v) => seen.push(v));
  id.signOut();
  assert.equal(ls.getItem(KEY), null);
  assert.equal(id.current(), null);
  assert.deepEqual(seen, [null]);
  off();
  bad();
  saveIdentity(FULL);
  assert.deepEqual(seen, [null], "no calls after unsubscribe");
  assert.throws(() => id.onChange("nope"), TypeError);
});

test("a sign-in or sign-out in another tab reaches subscribers (storage event)", () => {
  const seen = [];
  const off = id.onChange((v) => seen.push(v && v.fid));
  put(FULL);
  win.dispatchEvent(Object.assign(new Event("storage"), { key: KEY }));
  ls.removeItem(KEY);
  win.dispatchEvent(Object.assign(new Event("storage"), { key: KEY }));
  win.dispatchEvent(Object.assign(new Event("storage"), { key: "citizen.v1" })); // someone else's key: ignored
  assert.deepEqual(seen, [1234, null]);
  off();
  put(FULL);
  win.dispatchEvent(Object.assign(new Event("storage"), { key: KEY }));
  assert.deepEqual(seen, [1234, null], "the storage listener is removed with the last subscriber");
});

test("missing, throwing or full storage: current() is null or the session copy; nothing throws", () => {
  define("localStorage", undefined);
  assert.equal(id.current(), null);
  assert.equal(saveIdentity(FULL).fid, 1234, "kept for the session");
  assert.equal(id.current().fid, 1234);
  id.signOut();
  assert.equal(id.current(), null);

  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get() {
      throw new Error("SecurityError");
    },
  });
  assert.equal(id.current(), null);
  assert.doesNotThrow(() => id.signOut());

  const full = memoryStorage();
  full.m.set(KEY, JSON.stringify({ ...FULL, fid: 99 })); // an older record
  full.setItem = () => {
    throw new Error("QuotaExceededError");
  };
  define("localStorage", full);
  assert.equal(saveIdentity(FULL).fid, 1234);
  assert.equal(id.current().fid, 1234, "the new identity wins over the older stored one");
});

test("sanitizeIdentity never returns the input object and refuses non-objects", () => {
  for (const v of [null, undefined, 0, "x", [], () => {}]) assert.equal(sanitizeIdentity(v), null);
  const input = { ...FULL };
  const out = sanitizeIdentity(input);
  assert.notEqual(out.identity, input);
  assert.deepEqual(out.dropped, []);
});

test("valid but hostile-looking display text stays text through the app's escaping templates", () => {
  put({ ...FULL, displayName: '<img src=x onerror="alert(1)">', username: "a.b-c_d" });
  const me = id.current();
  assert.equal(me.displayName, '<img src=x onerror="alert(1)">', "allowed: it is only text");
  const markup = String(html`<p class="who">${me.displayName} <span>@${me.username}</span></p><img src="${me.pfpUrl}" referrerpolicy="no-referrer" alt="">`);
  assert.ok(!markup.includes("<img src=x"), markup);
  assert.ok(markup.includes("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"));
  assert.equal((markup.match(/<img /g) || []).length, 1, "only our own img tag");
});

test("display names use the contract's FORMAT_CHARS, and anything accepted here passes the contract's isDisplayName", () => {
  assert.equal(FORMAT_CHARS.source, CONTRACT_FORMAT_CHARS.source, "copied verbatim from contract/validate-app.mjs");
  assert.equal(FORMAT_CHARS.flags, CONTRACT_FORMAT_CHARS.flags);
  const samples = ["Alice", "Tony D'Addeo", "\u5F20\u4F1F", "\uD83D\uDE42 smile", "x".repeat(80), "x".repeat(81), " padded ", "a\tb", "a\nb", "a\rb", "a\u00ADb", "a\u200Db", "\uD800", ""];
  for (let cp = 0; cp < 0x10000; cp += 1) samples.push(`a${String.fromCharCode(cp)}b`);
  for (const v of samples) if (validDisplayName(v) !== undefined) assert.ok(isDisplayName(v), JSON.stringify(v));
  for (let cp = 0; cp <= 0x9f; cp++) if (cp < 0x20 || cp >= 0x7f) assert.equal(validDisplayName(`a${String.fromCharCode(cp)}b`), undefined, `C0/C1 U+${cp.toString(16)}`);
});
