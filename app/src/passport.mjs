// v3, pure rendering of the citizen's pages (docs/SPEC-V3.md "Passport"):
// your passport (#/passport), anyone's public passport (#/p/<address>), the
// avatar on home's "you" chip, and the sign-in sheet. Every identity field is
// untrusted display data and goes through the escaping `html` tag; the art
// arrives as SVG strings and is admitted by svgMarkup.

import { html, join, empty, rich, safeUrl, extLink, svgMarkup } from "./html.mjs";
import { COPY } from "./copy.mjs";
import { brandLockup, portraitArt, stampTraitOf, stampMarkup, stampArt, previewArt } from "./art.mjs";
import { pixelLabel } from "./cards.mjs";
import { countable, homeFacts } from "./model.mjs";
import { publicHref } from "./router.mjs";

/** The project's source (review T6): who made it, and where to read the code. */
export const SOURCE_URL = "https://github.com/P-U-C/Capable";
export const aboutLine = (cls = "mono smallprint about") =>
  html`<p class="${cls}">${COPY.madeBy} · ${extLink(SOURCE_URL, COPY.openSource, { cls: "about__link", aria: COPY.openSourceA11y })}</p>`;

/** Trait ids the reader has earned in this browser: at least one finished ready lesson of that trait (drafts never count). */
export function earnedTraitIds(app, state) {
  const done = state?.done || {};
  const ids = new Set(countable(app).filter((x) => done[x.lesson.id] === true).map((x) => x.lesson.trait));
  return (app?.traits || []).map((t) => t.id).filter((id) => ids.has(id));
}

/** Ready lessons finished, out of ready lessons. */
export function lessonsDone(app, state) {
  const ready = countable(app);
  return { done: ready.filter((x) => state?.done?.[x.lesson.id] === true).length, total: ready.length };
}

/** "0x12ab…cdef" */
export const shortAddress = (a) => (typeof a === "string" && a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : String(a ?? ""));

/** The seed of a reader's portrait: their fid when signed in, else the local id. */
export const portraitSeed = (identity, localId) => (identity?.fid ? `fid:${identity.fid}` : String(localId || "citizen"));

/** The name a passport shows: display name, else @username, else nothing. */
const nameOf = (id) => id?.displayName || (id?.username ? `@${id.username}` : "");

/**
 * A portrait, and the person's profile picture over it when they are signed
 * in and have an https one. If the picture fails to load the view removes it
 * (img.pfp "error"), and the portrait shows through. No referrer is sent.
 */
export function photo(identity, localId, { uid, size = "big", title = "" } = {}) {
  const src = safeUrl(identity?.pfpUrl);
  return html`<span class="${`photo photo--${size}`}">${portraitArt(portraitSeed(identity, localId), { uid, title: src ? "" : title })}${
    src ? html`<img class="photo__pfp" src="${src}" alt="${title}" referrerpolicy="no-referrer" loading="lazy" decoding="async" data-pfp>` : empty
  }</span>`;
}

/** The "you" chip's avatar: a 48px portrait (or the profile picture) once signed in; nothing when signed out. */
export function chipAvatar(identity, localId) {
  return identity ? photo(identity, localId, { uid: "chip", size: "chip" }) : empty;
}

/** One trait's stamp tile: its art and its state. `art` is an SVG string or "". */
function stampTile(trait, state, art, extra = empty) {
  const label = COPY.stampState[state];
  return html`<li class="stampt" data-hue="${trait.hue}" data-state="${state}">
<div class="stampt__art" role="img" aria-label="${COPY.stampStateA11y(trait.name, label)}">${
    art ? html`<span class="stampt__svg" aria-hidden="true">${stampMarkup(art)}</span>` : html`<span class="stampt__empty" aria-hidden="true"><span class="stampt__ring"></span><span class="stampt__name">${trait.name}</span></span>`
  }</div>
<p class="stampt__name-line" aria-hidden="true"><span class="chip">${trait.name}</span></p>
<p class="mono stampt__state" aria-hidden="true">${label}</p>${extra}
</li>`;
}

const isTokenId = (n) => Number.isInteger(n) && n >= 1 && n <= 999_999_999;

/**
 * Your passport. `v`:
 *   app, state (progress), identity (or null), localId, holder (the preview
 *   holder address), onChain (Map stampId → { tokenId, holder }), mints
 *   (Map stampId → this browser's mint record for the current contract),
 *   chosen (an address the reader chose: share links its public passport, and
 *   the page links it; null otherwise, review V9/T4), preview
 *   (StampsAPI.preview), busy (signing in), miniApp (inside a host: no sign
 *   out, the host signs you straight back in; review T17).
 */
export function renderPassport(v) {
  const { app, state, identity = null, localId, holder, onChain = new Map(), mints = new Map(), chosen = null, preview, busy = false, miniApp = false } = v;
  const earned = new Set(earnedTraitIds(app, state));
  const lessons = lessonsDone(app, state);
  const name = nameOf(identity);
  const tiles = (app.traits || []).map((t) => {
    const st = stampTraitOf(app, t);
    const chain = onChain.get(st.stampId);
    if (chain) return stampTile(t, "minted", stampArt(preview, app, t, chain.holder, chain.tokenId));
    const rec = mints.get(st.stampId);
    if (rec?.status === "minted" && isTokenId(rec.tokenId) && typeof rec.from === "string") return stampTile(t, "minted", stampArt(preview, app, t, rec.from, rec.tokenId));
    if (!earned.has(t.id) && !rec) return stampTile(t, "none", "");
    const link = rec ? extLink(rec.explorerUrl, COPY.mintView, { cls: "mono stampt__link", aria: COPY.mintViewA11y }) : empty;
    return stampTile(t, rec ? "sent" : "earned", previewArt(preview, app, t, holder), link);
  });
  const filled = (app.traits || []).filter((t) => earned.has(t.id) || onChain.has(stampTraitOf(app, t).stampId)).map((t) => t.id);
  const count = filled.length;
  const handle = identity?.username ? html`<p class="mono pp__handle">${COPY.handleLine(identity.username)}</p>` : empty;
  const share = html`<button class="btn btn--primary pp__share" type="button" data-share>${COPY.shareLabel}</button>`;
  const actions = identity
    ? html`${share}${miniApp ? empty : html`<button class="btn pp__signout" type="button" data-signout>${COPY.signOut}</button>`}`
    : html`<button class="btn btn--primary pp__signin" type="button" data-signin${busy ? html` disabled aria-busy="true"` : empty}>${busy ? COPY.signingIn : COPY.signIn}</button><p class="mono pp__local">${COPY.passportLocal}</p><button class="btn pp__share" type="button" data-share>${COPY.shareLabel}</button>`;
  const mine = chosen
    ? html`<div class="pp__mine"><a class="btn btn--small pp__public" href="${publicHref(chosen)}">${COPY.publicMine}</a><p class="mono pp__mine-note">${COPY.publicMineNote(shortAddress(chosen))}</p></div>`
    : empty;
  return html`<main class="passport" id="main" aria-labelledby="pp-name">
<div class="passport__top">
<a class="btn-icon passport__close" href="#/" aria-label="${COPY.backHome}"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18"/></svg></a>
<p class="eyebrow">${pixelLabel(COPY.passportEyebrow)}</p>
</div>
<section class="pp" data-signed="${identity ? "in" : "out"}">
<div class="pp__head">
${photo(identity, localId, { uid: "pp", title: identity ? COPY.pfpA11y(name || COPY.passportAnon) : COPY.portraitA11y })}
<div class="pp__who">
<h1 class="pp__name" id="pp-name" tabindex="-1">${name || COPY.passportAnon}</h1>
${handle}
${identity ? empty : html`<p class="pp__anon">${COPY.passportAnonLine}</p>`}
</div>
</div>
<p class="pp__line">${rich(app.citizen?.line ?? "")}</p>
<div class="pp__seal">${brandLockup({ size: 56, filled })}<p class="pixel pp__count"><span aria-hidden="true">${COPY.traitsDone(count, (app.traits || []).length)}</span><span class="sr-only">${COPY.traitsA11y(count, (app.traits || []).length)}</span></p></div>
</section>
<section class="pp-stamps" aria-labelledby="pp-stamps-h">
<h2 class="eyebrow" id="pp-stamps-h">${pixelLabel(COPY.stampsHeading)}</h2>
<ul class="stampts">${join(tiles)}</ul>
<p class="pixel pp__lessons">${pixelLabel(COPY.passportLessons(lessons.done, lessons.total))}</p>
${mine}
</section>
<div class="pp__actions">${actions}</div>
${aboutLine("mono smallprint about pp__about")}
</main>`;
}

/**
 * Anyone's passport, read from chain: a portrait seeded by the address, the
 * address itself (no name: the chain does not say who they are), and the
 * stamps it holds. `status`: "loading" | "ok" | "error" | "off".
 */
export function renderPublic({ app, address, status = "loading", owned = [], preview }) {
  const facts = homeFacts(app);
  const first = countable(app)[0]?.lesson;
  const byStamp = new Map(owned.map((s) => [s.stampId, s]));
  const tiles = (app.traits || []).map((t) => {
    const s = byStamp.get(stampTraitOf(app, t).stampId);
    return s ? stampTile(t, "minted", stampArt(preview, app, t, address, s.tokenId)) : stampTile(t, "none", "");
  });
  const filled = (app.traits || []).filter((t) => byStamp.has(stampTraitOf(app, t).stampId)).map((t) => t.id);
  const note =
    status === "loading"
      ? COPY.publicLoading
      : status === "error"
        ? COPY.publicError
        : status === "off"
          ? COPY.publicOff
          : owned.length === 0
            ? COPY.publicNone
            : "";
  return html`<main class="passport passport--public" id="main" aria-labelledby="pp-name" data-status="${status}">
<div class="passport__top">
<a class="btn-icon passport__close" href="#/" aria-label="${COPY.backHome}"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18"/></svg></a>
<p class="eyebrow">${pixelLabel(COPY.publicEyebrow)}</p>
</div>
<section class="pub-what" aria-label="${app.name}">
<p class="pub-what__line">${COPY.publicWhat({ name: app.name, ...facts })} ${rich(app.citizen?.line ?? "")}</p>
${first ? html`<a class="btn btn--primary pub-what__cta" href="${`#/l/${first.id}`}">${COPY.publicStart(1)}</a>` : empty}
</section>
<section class="pp">
<div class="pp__head">
<span class="photo photo--big">${portraitArt(address, { uid: "pub", title: COPY.publicA11y })}</span>
<div class="pp__who">
<h1 class="pp__name" id="pp-name" tabindex="-1">${COPY.publicName}</h1>
<p class="mono pp__handle" title="${address}">${COPY.walletLine(shortAddress(address))}</p>
</div>
</div>
<div class="pp__seal">${brandLockup({ size: 56, filled })}<p class="pixel pp__count"><span aria-hidden="true">${COPY.traitsDone(filled.length, (app.traits || []).length)}</span><span class="sr-only">${COPY.traitsA11y(filled.length, (app.traits || []).length)}</span></p></div>
</section>
<section class="pp-stamps" aria-labelledby="pp-stamps-h" aria-busy="${status === "loading" ? "true" : "false"}">
<h2 class="eyebrow" id="pp-stamps-h">${pixelLabel(COPY.stampsHeading)}</h2>
${note ? html`<p class="pp__note" role="status">${note}</p>` : html`<p class="mono pp__note pp__note--quiet">${COPY.publicStampsNote}</p>`}
${status === "error" ? html`<button class="btn btn--small pp__retry" type="button" data-retry>${COPY.tryAgain}</button>` : empty}
<ul class="stampts">${join(tiles)}</ul>
</section>
<div class="pp__actions"><a class="btn btn--primary" href="#/">${COPY.publicCta}</a></div>
${aboutLine("mono smallprint about pp__about")}
</main>`;
}

/**
 * The sign-in sheet's changing part. `phase`: "waiting" (no link yet),
 * "code" (the QR code and the link), "error" (copy for `code`). `qr` is the
 * QR encoder's SVG string.
 */
export function renderSignInBody({ phase = "waiting", url = null, qr = "", code = null, touch = true } = {}) {
  const href = safeUrl(url);
  if (phase === "error")
    return html`<p class="signin__error" role="alert">${COPY.signInError[code] || COPY.signInError.network}</p>
<div class="signin__actions"><button class="btn btn--primary" type="button" data-signin-retry>${COPY.tryAgain}</button><button class="btn" type="button" data-signin-cancel>${COPY.signInClose}</button></div>`;
  if (phase === "code" && href)
    return html`<div class="signin__qr" role="img" aria-label="${COPY.signInQrA11y}">${svgMarkup(qr, "qr")}</div>
<p class="mono signin__status" role="status">${COPY.signInPending}</p>
<div class="signin__actions">${extLink(href, touch ? COPY.signInOpenHere : COPY.signInOpenLink, { cls: "btn btn--primary signin__open" })}<button class="btn" type="button" data-signin-cancel>${COPY.signInCancel}</button></div>`;
  return html`<div class="signin__qr signin__qr--wait" aria-hidden="true"><span class="signin__dots"><i></i><i></i><i></i></span></div>
<p class="mono signin__status" role="status">${COPY.signInWaiting}</p>
<div class="signin__actions"><button class="btn" type="button" data-signin-cancel>${COPY.signInCancel}</button></div>`;
}

/** The sign-in sheet: a modal dialog with the title, the explainer and the body for the phase. */
export function renderSignIn(view = {}) {
  return html`<div class="signin" role="dialog" aria-modal="true" aria-labelledby="signin-h" aria-describedby="signin-d" data-phase="${view.phase || "waiting"}">
<div class="signin__inner" tabindex="-1">
<h2 class="signin__title" id="signin-h">${COPY.signInTitle}</h2>
<p class="signin__explain" id="signin-d"${view.phase === "error" ? html` hidden` : empty}>${COPY.signInScan}</p>
<div class="signin__body">${renderSignInBody(view)}</div>
</div>
</div>`;
}
