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
import { mountPassport, mountPublic } from "./view-passport.mjs";
import { plain } from "./html.mjs";
import { COPY } from "./copy.mjs";
import { identity as identityApi, qrSvg } from "./identity/index.mjs";
import stampsApi from "./stamps/index.mjs";
import { openCitizen, citizenKey } from "./citizen.mjs";

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

export function boot({ win = globalThis.window, doc = win?.document, storage = storageOf(win), fetchImpl = win?.fetch?.bind(win), loadHls, serviceWorker = true, identity = defaultIdentity, stamps = stampsApi } = {}) {
  const root = doc.getElementById("app");
  const base = basePath(win.location.href);
  const store = openStore(storage, { key: storageKey(base) });
  const citizen = openCitizen(storage, { key: citizenKey(base) });
  let miniApp = false;
  const motion = win.matchMedia?.("(prefers-reduced-motion: reduce)") ?? { matches: false };
  let app = readInline(doc);
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
      view = mountDeck(root, { app, lessonId: route.id, store, reduced: motion.matches, onClose: close, onLink: follow, loadHls, identity, stamps, citizen });
      if (!view) {
        // an unknown lesson: home, in place of the bad entry
        win.history.replaceState(null, "", "#/");
        current = { view: null };
        return render();
      }
      doc.title = COPY.docTitle(plain(view.title), app.name);
    } else if (route.view === "passport") {
      view = mountPassport(root, { app, store, citizen, identity, stamps, isMiniApp: () => miniApp, onClose: close });
      doc.title = COPY.docTitle(view.title, app.name);
    } else if (route.view === "public") {
      view = mountPublic(root, { app, address: route.address, stamps, onClose: close });
      doc.title = COPY.docTitle(view.title, app.name);
    } else {
      view = mountHome(root, { app, store, focus: route.focus, from, who: { identity: identity.current() } });
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
            if (current.view !== "lesson") render();
            return true;
          })
          .catch(() => false) /* offline or not deployed beside an app.json: the inlined copy stands */
      : Promise.resolve(false);

  const loc = win.location;
  if (serviceWorker && win.navigator && "serviceWorker" in win.navigator && (loc.protocol === "https:" || loc.hostname === "localhost" || loc.hostname === "127.0.0.1")) {
    win.addEventListener("load", () => win.navigator.serviceWorker.register("./sw.js").catch(() => {}));
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
  };
}
