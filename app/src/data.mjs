// The App data: read the copy inlined at build time, and decide whether a
// fetched ./app.json should replace it. Untrusted either way; a fetched copy
// that fails the contract's validator is ignored (fail closed).

import { validateApp } from "../../contract/validate-app.mjs";

/** Parse the inlined App from <script type="application/json" id="app-data">. */
export function readInline(doc) {
  const el = doc.getElementById("app-data");
  if (!el) return null;
  try {
    return JSON.parse(el.textContent || "null");
  } catch {
    return null;
  }
}

const time = (a) => {
  const t = Date.parse(a?.generatedAt ?? "");
  return Number.isFinite(t) ? t : -Infinity;
};

/** Is `next` a newer App than `current`? */
export const isNewer = (next, current) => time(next) > time(current);

/** JSON with object keys sorted, so equal data always prints the same. */
function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
      .join(",")}}`;
  return JSON.stringify(v) ?? "null";
}

/** Do two Apps say the same thing? generatedAt is ignored: a republish can keep it (review S10). */
export function sameContent(a, b) {
  const strip = (x) => {
    const { generatedAt: _t, ...rest } = x && typeof x === "object" ? x : {};
    return rest;
  };
  return canonical(strip(a)) === canonical(strip(b));
}

/**
 * The App to show after fetching `next`. It replaces `current` when it is
 * valid, not older, and says something different: a newer generatedAt alone
 * is not needed, and an older copy (a stale cache) never wins.
 * Returns { app, changed, errors }.
 */
export function acceptUpdate(current, next) {
  const keep = { app: current, changed: false, errors: [] };
  if (!next || typeof next !== "object" || Array.isArray(next)) return keep;
  if (time(next) < time(current) || sameContent(next, current)) return keep;
  const errors = validateApp(next);
  if (errors.length) return { app: current, changed: false, errors };
  return { app: next, changed: true, errors: [] };
}

/** Fetch ./app.json, bypassing the HTTP cache (the service worker goes network-first too). */
export async function fetchLatest(fetchImpl = globalThis.fetch, url = "./app.json") {
  const res = await fetchImpl(url, { cache: "no-cache", credentials: "same-origin" });
  if (!res.ok) throw new Error(`app.json ${res.status}`);
  return res.json();
}
