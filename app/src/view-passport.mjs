// v3, the DOM halves of the citizen's pages: your passport (#/passport) with
// its sign-in sheet, share and sign-out; anyone's public passport
// (#/p/<address>); and the profile-picture fallback the home chip shares.
// Identity and stamps arrive injected (the shell passes the real modules),
// so the tests drive these with mocks.

import { renderPassport, renderPublic, renderSignIn, renderSignInBody, earnedTraitIds } from "./passport.mjs";
import { knownAddresses, previewHolder } from "./citizen.mjs";
import { paintIn } from "./paint.mjs";
import { stampTraitOf } from "./art.mjs";
import { COPY } from "./copy.mjs";
import { publicHref } from "./router.mjs";
import { qrSvg as defaultQr } from "./identity/index.mjs";

const CODES = new Set(["timeout", "cancelled", "rejected", "verify-failed", "network"]);

/** A profile picture that fails to load is removed, so the portrait under it shows (no inline handlers: CSP). */
export function wirePfp(root) {
  for (const img of root.querySelectorAll("img[data-pfp]")) {
    if (img.complete === true && img.naturalWidth === 0) img.remove();
    else img.addEventListener("error", () => img.remove(), { once: true });
  }
}

/** The page's own URL without its route: what a share links to. */
const appUrl = (win) => String(win.location.href).split("#")[0];

/**
 * Your passport. `isMiniApp()` says whether the app runs inside a host
 * client: there, "Sign in" reads the host's user without a sheet.
 */
export function mountPassport(root, { app, store, citizen, identity, stamps, isMiniApp = () => false, onClose = () => {}, qrSvg = identity?.qrSvg || defaultQr } = {}) {
  const doc = root.ownerDocument;
  const win = doc.defaultView;
  const localId = citizen.localId();
  const onChain = new Map();
  let busy = false;
  let sheet = null; // { ac, phase, url, code, opener }
  let destroyed = false;

  function draw() {
    const id = identity.current();
    const v = { app, state: store.get(), identity: id, localId, holder: previewHolder(id, citizen), onChain, sent: citizen.get().minted, preview: stamps.preview, busy };
    root.innerHTML = String(renderPassport(v));
    paintIn(root);
    wirePfp(root);
    if (sheet) drawSheet(true);
  }

  // ---- stamps on chain: for the reader's known addresses, when a contract is configured
  const cfg = stamps.config(app);
  const addresses = cfg ? knownAddresses(identity.current(), citizen) : [];
  if (addresses.length)
    Promise.all(addresses.map((a) => Promise.resolve(stamps.owned(a)).then((r) => ({ a, r })).catch(() => ({ a, r: { stamps: [] } })))).then((all) => {
      if (destroyed) return;
      for (const { a, r } of all) for (const s of r?.stamps || []) if (!onChain.has(s.stampId)) onChain.set(s.stampId, { tokenId: s.tokenId, holder: a });
      if (onChain.size) draw();
    });

  // ---- share: called straight from the tap, so a popup counts as a user gesture
  function share() {
    const traits = app.traits || [];
    const earned = new Set(earnedTraitIds(app, store.get()));
    for (const t of traits) if (onChain.has(stampTraitOf(app, t).stampId)) earned.add(t.id);
    const text = COPY.shareLine(app.citizen?.name || app.name, earned.size, traits.length);
    const addr = cfg ? knownAddresses(identity.current(), citizen)[0] : null;
    const url = appUrl(win) + (addr ? publicHref(addr) : "");
    identity.share(text, url).catch?.(() => {});
  }

  // ---- sign in
  function signIn(opener) {
    if (isMiniApp()) {
      // inside a host the user comes from its context: no sheet, no prompt
      busy = true;
      draw();
      Promise.resolve()
        .then(() => identity.signIn())
        .catch(() => {})
        .finally(() => {
          busy = false;
          if (!destroyed) draw();
        });
      return;
    }
    openSheet(opener);
  }

  function openSheet(opener) {
    const ac = new AbortController();
    sheet = { ac, phase: "waiting", url: null, code: null, opener };
    drawSheet();
    Promise.resolve()
      .then(() =>
        identity.signIn({
          signal: ac.signal,
          onUrl: (url) => {
            if (sheet?.ac !== ac) return;
            sheet.phase = "code";
            sheet.url = url;
            drawSheet();
          },
        }),
      )
      .then(() => {
        if (sheet?.ac !== ac) return;
        closeSheet({ abort: false });
        if (!destroyed) draw();
        root.querySelector("#pp-name")?.focus();
      })
      .catch((err) => {
        if (sheet?.ac !== ac) return; // closed by the reader
        sheet.phase = "error";
        sheet.code = CODES.has(err?.code) ? err.code : "network";
        drawSheet();
      });
  }

  /** Draw the sheet: the dialog once, then only its body as the phase changes, so focus stays put. */
  function drawSheet(fresh = false) {
    const main = root.querySelector(".passport");
    let el = root.querySelector(".signin");
    const view = { phase: sheet.phase, url: sheet.url, code: sheet.code, qr: sheet.phase === "code" ? safeQr(sheet.url) : "" };
    if (!el || fresh) {
      el?.remove();
      root.insertAdjacentHTML("beforeend", String(renderSignIn(view)));
      el = root.querySelector(".signin");
      main?.toggleAttribute("inert", true);
      doc.documentElement.classList.add("has-signin");
      el.querySelector(".signin__inner").focus();
    } else {
      const had = el.contains(doc.activeElement);
      el.dataset.phase = sheet.phase;
      el.querySelector(".signin__body").innerHTML = String(renderSignInBody(view));
      if (!had || !el.contains(doc.activeElement)) el.querySelector(".signin__body button, .signin__body a")?.focus();
    }
  }

  function safeQr(url) {
    try {
      return qrSvg(url);
    } catch {
      return "";
    }
  }

  function closeSheet({ abort = true } = {}) {
    if (!sheet) return;
    const s = sheet;
    sheet = null;
    if (abort) s.ac.abort();
    root.querySelector(".signin")?.remove();
    root.querySelector(".passport")?.toggleAttribute("inert", false);
    doc.documentElement.classList.remove("has-signin");
    if (!destroyed) (root.querySelector("[data-signin]") || root.querySelector("#pp-name"))?.focus();
  }

  const onClick = (e) => {
    const t = e.target.closest?.("button, a");
    if (!t || !root.contains(t)) return;
    if (t.matches(".passport__close") || (t.matches("a") && t.getAttribute("href") === "#/")) {
      e.preventDefault();
      return onClose();
    }
    if (t.hasAttribute("data-share")) return share();
    if (t.hasAttribute("data-signin")) return busy ? undefined : signIn(t);
    if (t.hasAttribute("data-signout")) {
      identity.signOut(); // the shell redraws on the change; a mock without one is redrawn here
      if (!destroyed) draw();
      return;
    }
    if (t.hasAttribute("data-signin-cancel")) return closeSheet();
    if (t.hasAttribute("data-signin-retry")) {
      const opener = sheet?.opener;
      closeSheet();
      return openSheet(opener);
    }
  };
  const onKey = (e) => {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    e.preventDefault();
    if (sheet) closeSheet();
    else onClose();
  };
  root.addEventListener("click", onClick);
  doc.addEventListener("keydown", onKey);

  draw();
  root.querySelector("#pp-name")?.focus({ preventScroll: true });
  if (doc.scrollingElement) doc.scrollingElement.scrollTop = 0;

  return {
    title: COPY.passportDoc,
    get sheet() {
      return sheet && { phase: sheet.phase, url: sheet.url, code: sheet.code };
    },
    redraw: draw,
    destroy() {
      destroyed = true;
      closeSheet();
      root.removeEventListener("click", onClick);
      doc.removeEventListener("keydown", onKey);
    },
  };
}

/** Anyone's passport, read from chain. Nothing here signs in or needs a wallet. */
export function mountPublic(root, { app, address, stamps, onClose = () => {} } = {}) {
  const doc = root.ownerDocument;
  let status = "loading";
  let owned = [];
  let destroyed = false;
  let seq = 0;

  const draw = () => {
    root.innerHTML = String(renderPublic({ app, address, status, owned, preview: stamps.preview }));
    paintIn(root);
  };

  function load() {
    const n = ++seq;
    status = "loading";
    owned = [];
    draw();
    // config(app) first: the stamp module reads with the last config
    Promise.resolve()
      .then(() => stamps.owned(address))
      .then((r) => {
        if (destroyed || n !== seq) return;
        owned = Array.isArray(r?.stamps) ? r.stamps.filter((s) => Number.isInteger(s?.tokenId) && Number.isInteger(s?.stampId)) : [];
        status = r?.error ? "error" : "ok";
        draw();
      })
      .catch(() => {
        if (destroyed || n !== seq) return;
        status = "error";
        draw();
      });
  }

  const onClick = (e) => {
    const t = e.target.closest?.("button, a");
    if (!t || !root.contains(t)) return;
    if (t.matches(".passport__close") || (t.matches("a") && t.getAttribute("href") === "#/")) {
      e.preventDefault();
      return onClose();
    }
    if (t.hasAttribute("data-retry")) return load();
  };
  const onKey = (e) => {
    if (e.key === "Escape" && !e.defaultPrevented) {
      e.preventDefault();
      onClose();
    }
  };
  root.addEventListener("click", onClick);
  doc.addEventListener("keydown", onKey);

  if (stamps.config(app)) load();
  else {
    status = "off";
    draw();
  }
  root.querySelector("#pp-name")?.focus({ preventScroll: true });
  if (doc.scrollingElement) doc.scrollingElement.scrollTop = 0;

  return {
    title: COPY.publicDoc,
    get status() {
      return status;
    },
    destroy() {
      destroyed = true;
      root.removeEventListener("click", onClick);
      doc.removeEventListener("keydown", onKey);
    },
  };
}
