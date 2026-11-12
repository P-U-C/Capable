// Boot: read the inlined App, route between home and a lesson, look for a
// newer app.json, and register the service worker.

import { readInline, acceptUpdate, fetchLatest } from "./data.mjs";
import { openStore } from "./store.mjs";
import { parseRoute } from "./router.mjs";
import { mountHome } from "./view-home.mjs";
import { mountDeck } from "./view-deck.mjs";

const doc = document;
const root = doc.getElementById("app");
const store = openStore();
const motion = matchMedia("(prefers-reduced-motion: reduce)");
let app = readInline(doc);
let view = null;
let current = { view: null };

function render() {
  const route = parseRoute(location.hash);
  const from = current.view === "lesson" ? current.id : null;
  view?.destroy();
  view = null;
  doc.documentElement.dataset.view = route.view;
  if (route.view === "lesson") {
    view = mountDeck(root, { app, lessonId: route.id, store, reduced: motion.matches, navigate });
    if (!view) return navigate("#/", { replace: true });
  } else {
    view = mountHome(root, { app, store, focus: route.focus, from });
  }
  current = route;
}

function navigate(hash, { replace = false } = {}) {
  if (replace) {
    history.replaceState(null, "", hash);
    render();
  } else if (location.hash === hash) render();
  else location.hash = hash;
}

addEventListener("hashchange", render);
motion.addEventListener?.("change", () => current.view === "lesson" && render());

if (app) render();

// Updates: a newer, valid app.json replaces the inlined copy. Home re-renders
// at once; an open lesson keeps the reader's place and picks it up next time.
fetchLatest()
  .then((next) => {
    const r = acceptUpdate(app, next);
    if (!r.changed) return;
    app = r.app;
    if (current.view !== "lesson") render();
  })
  .catch(() => {
    /* offline or not deployed beside an app.json: the inlined copy stands */
  });

if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
  addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
}
