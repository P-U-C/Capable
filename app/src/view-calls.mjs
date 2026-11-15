// v4, the DOM half of open calls (src/calls.mjs): redraw the badges' and the
// card's words as time passes, and wire the card's two actions. Inside a host
// client the reply opens the host's composer (as a reply to the call's post,
// with a short line prefilled) and Earn opens as a Mini App; on the web both
// are plain links in a new tab and need nothing here. Nothing is ever posted
// for the reader.

import { callFor, closesWhen, renderCallWhen, renderCallActions, replyInHost, openEarnInHost, loadHostSdk, EARN_URL } from "./calls.mjs";
import { COPY } from "./copy.mjs";

/** Redraw every call sticker's words and the card's closing line in place: "closes in 3 h" becomes "in 2 h". */
export function tickCalls(root, app, { now = Date.now(), timeZone } = {}) {
  for (const el of root.querySelectorAll("[data-call-badge]")) {
    const call = callFor(app, el.dataset.call, now);
    const t = el.querySelector("[data-call-text]");
    const when = call ? closesWhen(call, now, timeZone) : null;
    if (when && t) t.textContent = COPY.callCloses(when);
  }
  for (const el of root.querySelectorAll("[data-call-a11y]")) {
    const call = callFor(app, el.closest("[data-lesson]")?.dataset.lesson, now);
    const when = call ? closesWhen(call, now, timeZone) : null;
    if (when) el.textContent = COPY.callBadgeA11y(when);
  }
  for (const el of root.querySelectorAll("[data-call-when]")) {
    const call = callFor(app, el.closest("[data-call]")?.dataset.call, now);
    if (call) el.innerHTML = String(renderCallWhen(call, { now, timeZone }));
  }
}

/** Swap the card's actions to the host's (buttons) once the app learns it runs inside one. */
export function hostCallActions(root, app, { now = Date.now() } = {}) {
  for (const el of root.querySelectorAll("[data-call-actions]")) {
    const call = callFor(app, el.closest("[data-call]")?.dataset.call, now);
    if (call) el.innerHTML = String(renderCallActions(call, { host: true }));
  }
}

/**
 * Handle a click on the card's reply or Earn control. Returns true when it was
 * one. Inside a host (`isMiniApp()` true) the SDK acts and a link's own
 * navigation is stopped; on the web a link simply opens (a button, drawn for a
 * host that turned out not to be one, opens the same URL in a new tab).
 */
export function callClick(e, t, { app, now = () => Date.now(), isMiniApp = () => false, loadSdk = loadHostSdk, win, onLazyFail = () => {} } = {}) {
  const reply = t.hasAttribute("data-call-reply");
  if (!reply && !t.hasAttribute("data-call-earn")) return false;
  const call = callFor(app, t.closest("[data-call]")?.dataset.call, now());
  if (!call) {
    // closed while the card was open: nothing to reply to any more
    if (reply) e.preventDefault();
    return true;
  }
  const status = t.closest("[data-call-actions]")?.querySelector("[data-call-status]");
  if (status) status.textContent = "";
  if (isMiniApp() === true) {
    e.preventDefault();
    const act = reply ? replyInHost(call, { loadSdk, text: COPY.callComposeText(app.name) }) : openEarnInHost({ loadSdk });
    act.catch((err) => {
      if (status) status.textContent = COPY.callComposeFailed;
      onLazyFail(err);
    });
    return true;
  }
  if (t.matches("button")) win?.open?.(reply ? call.replyUrl : EARN_URL, "_blank", "noopener,noreferrer");
  return true;
}
