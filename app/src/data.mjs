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

/**
 * The App to show after fetching `next`: it replaces `current` only when it
 * is newer and valid. Returns { app, changed, errors }.
 */
export function acceptUpdate(current, next) {
  if (!next || typeof next !== "object" || !isNewer(next, current)) return { app: current, changed: false, errors: [] };
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
