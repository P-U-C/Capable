// Review V7: after a deploy, a page still running the old code can no longer
// load its lazy chunks (sign-in, the wallet and chain code, hls.js): Pages has
// replaced the hashed files and the new service worker has deleted the old
// caches. The features fail with a network error, and "Try again" repeats it.
//
// When one of those entry points fails, ask whether the app was updated: the
// live sw.js (never cached by the service worker, fetched past the HTTP cache)
// lists the first-paint bundle by name; if it no longer lists the one this
// page runs, this page is out of date. Then the shell says "<app> was
// updated — reload to continue". The reader's place is already in storage
// (the deck saves every card), so a reload resumes where they were.
//
// A service worker taking over this page (controllerchange) marks it stale at
// once. A "no" is remembered briefly, so a run of failures costs one fetch.

import { html } from "./html.mjs";
import { COPY } from "./copy.mjs";

/** The notice: what happened and one button. Reloading keeps the route (the hash) and the deck resumes at the saved card. */
export function renderUpdateNotice(name) {
  return html`<div class="update__inner" role="alert"><p class="update__text">${COPY.appUpdated(name)}</p><button class="btn btn--primary update__reload" type="button" data-reload>${COPY.reload}</button></div>`;
}

/** The first-paint bundle this page runs ("app.<hash>.js"), from its module script; null when unknown (dev, tests). */
export function pageEntry(doc) {
  for (const s of doc?.querySelectorAll?.('script[type="module"][src]') || []) {
    const name = String(s.getAttribute("src") || "")
      .split(/[?#]/)[0]
      .split("/")
      .pop();
    if (/^app\.[A-Za-z0-9]+\.js$/.test(name)) return name;
  }
  return null;
}

/** Does this look like a failed dynamic import (any browser's wording), here or in its causes? */
export function isChunkError(err) {
  for (let e = err, n = 0; e && n < 6; e = e.cause, n++) {
    if (e?.name === "ChunkLoadError") return true;
    if (/dynamically imported module|importing a module script failed|error loading dynamically imported|failed to fetch dynamically|loading chunk|module script/i.test(String(e?.message ?? ""))) return true;
  }
  return false;
}

/**
 * The update check. `fetchImpl` and `now` are injectable; `entry` defaults to
 * pageEntry(doc). check() resolves true when the deployed app is not the one
 * this page runs; false when it is, or when that can't be told (offline, no
 * entry known). It never throws.
 */
export function createUpdateCheck({ doc, fetchImpl, entry = pageEntry(doc), url = "./sw.js", now = () => Date.now(), ttl = 30_000 } = {}) {
  let stale = false;
  let last = { at: -Infinity, p: null };
  return {
    get stale() {
      return stale;
    },
    /** A new service worker took over: the old lazy chunks are gone. */
    mark() {
      stale = true;
    },
    check() {
      if (stale) return Promise.resolve(true);
      if (!entry || typeof fetchImpl !== "function") return Promise.resolve(false);
      if (last.p && now() - last.at < ttl) return last.p;
      last = {
        at: now(),
        p: Promise.resolve()
          .then(() => fetchImpl(url, { cache: "no-store", credentials: "same-origin" }))
          .then((res) => (res?.ok ? res.text() : null))
          .then((text) => {
            if (typeof text !== "string" || !/capable service worker/.test(text)) return false;
            if (!text.includes(JSON.stringify(`./${entry}`))) stale = true;
            return stale;
          })
          .catch(() => false),
      };
      return last.p;
    },
  };
}
