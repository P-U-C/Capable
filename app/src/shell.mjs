// Boot: read the inlined App, route between home and a lesson, keep the
// browser history tidy, look for a changed app.json, and register the service
// worker. Every browser object arrives through `env`, so the tests drive this
// with a small fake window and document.
//
// History (review U4): a lesson opened from home is marked on its history
// entry. Closing it (the close button, Esc, "All lessons") goes back to that
// home entry instead of pushing a new one, so Back from home leaves the app,
// as an installed app should. A lesson reached any other way (a deep link, a
// reload) is replaced by home when closed. Moving from one lesson to the next
// replaces the entry too, so the stack never grows while reading.

import { readInline, acceptUpdate, fetchLatest } from "./data.mjs";
import { openStore, storageKey } from "./store.mjs";
import { parseRoute } from "./router.mjs";
import { mountHome } from "./view-home.mjs";
import { mountDeck } from "./view-deck.mjs";
import { mountPassport, mountPublic, fitPassportTitles } from "./view-passport.mjs";
import { plain } from "./html.mjs";
import { COPY } from "./copy.mjs";
import { identity as identityApi, qrSvg } from "./identity/index.mjs";
import stampsApi from "./stamps/index.mjs";
import { openCitizen, citizenKey } from "./citizen.mjs";
import { openSeen, seenKey } from "./seen.mjs";
import { createUpdateCheck, renderUpdateNotice } from "./stale.mjs";
import { fitTitles } from "./fit.mjs";

/** The identity the app uses by default: the identity lane's module, with its QR encoder. */
export const defaultIdentity = Object.freeze({ ...identityApi, qrSvg });

/** After the first paint: the next frame, then a task. */
const afterPaint = (win) => new Promise((r) => (win.requestAnimationFrame ? win.requestAnimationFrame(() => setTimeout(r, 0)) : setTimeout(r, 0)));

const FROM_HOME = "from-home";

/** The directory the app is served from ("/Capable/"): progress and caches are namespaced by it (review S23). */
export function basePath(href) {
  try {
    return new URL(".", href).pathname;
  } catch {
    return "/";
  }
}

function storageOf(win) {
  try {
    return win.localStorage ?? null;
  } catch {
    return null;
  }
}

export function boot({ win = globalThis.window, doc = win?.document, storage = storageOf(win), fetchImpl = win?.fetch?.bind(win), loadHls, serviceWorker = true, identity = defaultIdentity, stamps = stampsApi, updates = createUpdateCheck({ doc, fetchImpl }), stampTiming } = {}) {
  const root = doc.getElementById("app");
  const base = basePath(win.location.href);
  const store = openStore(storage, { key: storageKey(base) });
  const citizen = openCitizen(storage, { key: citizenKey(base) });
  const seen = openSeen(storage, { key: seenKey(base) });
  let miniApp = false;
  const motion = win.matchMedia?.("(prefers-reduced-motion: reduce)") ?? { matches: false };
  let app = readInline(doc);
  if (app) {
    seen.baseline(app); // a first visit: nothing is "new" yet (review T10)
    citizen.migrate(app); // mint records kept by trait id become (chain, contract, stamp) keyed (review V8)
  }

  // ---- review V7: a lazy chunk that won't load may mean the app was updated under this page
  let notice = null;
  function showUpdate() {
    if (notice?.isConnected) return;
    notice = doc.createElement("div");
    notice.className = "update";
    notice.innerHTML = String(renderUpdateNotice(app?.name || ""));
    notice.addEventListener("click", (e) => {
      if (!e.target.closest?.("[data-reload]")) return;
      // the route is in the hash and the deck saved the reader's card: a reload resumes right here
      win.location.reload();
    });
    doc.body.appendChild(notice);
  }
  /** Called by sign-in, the mint and video when their code fails to load; resolves true when the notice is shown. */
  function onLazyFail() {
    return Promise.resolve()
      .then(() => updates.check())
      .then((stale) => {
        if (stale === true) showUpdate();
        return stale === true;
      })
      .catch(() => false);
  }
  let view = null;
  let current = { view: null };

  const fromHome = () => win.history.state?.capable === FROM_HOME;

  function render() {
    const route = parseRoute(win.location.hash);
    const from = current.view === "lesson" ? current.id : null;
    view?.destroy();
    view = null;
    doc.documentElement.dataset.view = route.view;
    if (route.view === "lesson") {
      view = mountDeck(root, { app, lessonId: route.id, store, reduced: motion.matches, onClose: close, onLink: follow, loadHls, identity, stamps, citizen, onLazyFail, stampTiming });
      if (!view) {
        // an unknown lesson: home, in place of the bad entry
        win.history.replaceState(null, "", "#/");
        current = { view: null };
        return render();
      }
      doc.title = COPY.docTitle(plain(view.title), app.name);
      seen.markLesson(app.lessons.find((l) => l.id === route.id));
    } else if (route.view === "passport") {
      view = mountPassport(root, { app, store, citizen, identity, stamps, isMiniApp: () => miniApp, onClose: close, onLazyFail });
      doc.title = COPY.docTitle(view.title, app.name);
    } else if (route.view === "public") {
      view = mountPublic(root, { app, address: route.address, stamps, onClose: close, onLazyFail });
      doc.title = COPY.docTitle(view.title, app.name);
    } else {
      view = mountHome(root, { app, store, focus: route.focus, from, who: { identity: identity.current() }, news: seen.news(app) });
      doc.title = app.name;
    }
    // a page opened from home is marked, so closing it goes back rather than piling up entries
    if (route.view !== "home" && current.view === "home" && !fromHome()) win.history.replaceState({ ...(win.history.state || {}), capable: FROM_HOME }, "");
    current = route;
  }

  /** Leave a lesson for home: back to the home entry it was opened from, else replace it with home. */
  function close() {
    if (fromHome()) win.history.back();
    else {
      win.history.replaceState(null, "", "#/");
      render();
    }
  }

  /** An in-app link inside a lesson: home closes the lesson; anything else replaces this entry. */
  function follow(hash) {
    const r = parseRoute(hash);
    if (r.view === "home" && !r.focus) return close();
    win.history.replaceState(win.history.state, "", hash);
    render();
  }

  win.addEventListener("hashchange", render);
  // big titles shrink to fit their line rather than break inside a word: again when the width or the fonts change
  const refit = () => (current.view === "lesson" ? null : current.view === "home" ? fitTitles(root) : fitPassportTitles(root)); // the deck refits its own cards
  win.addEventListener("resize", refit);
  doc.fonts?.ready?.then?.(refit);
  motion.addEventListener?.("change", () => current.view === "lesson" && render());
  // signing in or out (here or in another tab) redraws the chip and the passport; an open lesson keeps its place
  identity.onChange?.(() => app && current.view !== "lesson" && current.view !== "public" && render());

  if (app) render();

  // Inside a host client (a Mini App): tell the host we're ready once the
  // first frame is painted, then take the person from its context, with no
  // prompt. On a top-level page isMiniApp() answers false at once and no
  // identity code is downloaded.
  const miniapp = Promise.resolve()
    .then(() => identity.isMiniApp())
    .then(async (yes) => {
      if (yes !== true) return false;
      miniApp = true;
      doc.documentElement.dataset.host = "miniapp";
      await afterPaint(win);
      await identity.ready();
      try {
        await identity.signIn();
      } catch {
        /* the app runs signed out */
      }
      return true;
    })
    .catch(() => false);

  // Updates: a valid app.json that says something new replaces the inlined
  // copy. Home re-renders at once; an open lesson keeps the reader's place and
  // picks it up next time.
  const updated =
    typeof fetchImpl === "function"
      ? fetchLatest(fetchImpl)
          .then((next) => {
            const r = acceptUpdate(app, next);
            if (!r.changed) return false;
            app = r.app;
            citizen.migrate(app);
            if (current.view !== "lesson") render();
            return true;
          })
          .catch(() => false) /* offline or not deployed beside an app.json: the inlined copy stands */
      : Promise.resolve(false);

  const loc = win.location;
  if (serviceWorker && win.navigator && "serviceWorker" in win.navigator && (loc.protocol === "https:" || loc.hostname === "localhost" || loc.hostname === "127.0.0.1")) {
    const sw = win.navigator.serviceWorker;
    // a new worker taking over a page it didn't load: the old lazy chunks are gone with the old caches (review V7)
    if (sw.controller) sw.addEventListener?.("controllerchange", () => updates.mark());
    win.addEventListener("load", () => sw.register("./sw.js").catch(() => {}));
  }

  return {
    store,
    citizen,
    updated,
    miniapp,
    get app() {
      return app;
    },
    get view() {
      return view;
    },
    get route() {
      return current;
    },
    render,
    close,
    follow,
    onLazyFail,
    seen,
    get notice() {
      return notice;
    },
  };
}
