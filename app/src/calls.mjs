// v4: open calls (docs/SPEC-V4.md). When a lesson's idea has an open call for
// explainers, home's tile and the lesson's cover carry a small "open call ·
// closes Sun" badge, and the deck gains a "Make the explainer" card just
// before the trait card. This is the one reader-facing place, besides the
// identity UI, that may name the reward, when the call closes, the entries so
// far, where entries are posted and the Earn app; every word of it is a
// `call*` key in copy.mjs (test/safety.test.mjs allow-lists exactly those).
//
// Pure: which calls are open on the reader's clock, how their closing time
// reads in the reader's time zone, and the markup. The Mini App actions at the
// bottom take the host SDK through a loader, so nothing here downloads it
// until a reader taps.

import { html, empty, safeUrl } from "./html.mjs";
import { COPY } from "./copy.mjs";
import { shout, pixelLabel } from "./cards.mjs";
import { COMPOSE_URL } from "./identity/index.mjs";

/**
 * Where a call's entries go: its own post's conversation (the contract's
 * CALL_REPLY_PREFIX, which the browser bundle never carries). Derived from the
 * identity module's web client, so no second copy of the host ships.
 */
export const REPLY_PREFIX = `${new URL(COMPOSE_URL).origin}/~/conversations/`;
/** Past winners: Dylan Brodeur's Earn app (docs/SPEC-V4.md). */
export const EARN_URL = "https://earn.dylanbrodeur.org/";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
/** Under this the card shows a countdown. */
export const COUNTDOWN_MS = 48 * HOUR;
const HASH = /^0x[0-9a-f]{40}$/;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The call's closing time in ms, or NaN. */
export const closeTime = (call) => (typeof call?.closesAt === "string" ? Date.parse(call.closesAt) : NaN);

/**
 * A call the app may show: well formed (fail closed, even if a stale or odd
 * app.json slipped past the validator) and still open on the reader's clock.
 */
export function isOpen(call, now = Date.now()) {
  if (!call || typeof call !== "object") return false;
  const end = closeTime(call);
  if (!Number.isFinite(end) || !(end > now)) return false;
  if (!HASH.test(call.castHash || "") || call.replyUrl !== `${REPLY_PREFIX}${call.castHash}` || !safeUrl(call.replyUrl)) return false;
  return typeof call.reward === "string" && call.reward.trim() !== "" && typeof call.brief === "string" && (call.kind === "video" || call.kind === "build");
}

/** The open calls whose lesson exists and is about the call's topic. */
export function openCalls(app, now = Date.now()) {
  const lessons = new Map((app?.lessons || []).map((l) => [l?.id, l]));
  return (Array.isArray(app?.calls) ? app.calls : []).filter((c) => isOpen(c, now) && lessons.get(c.lesson)?.topic === c.topic);
}

/** The open call on a lesson, or null. */
export const callFor = (app, lessonId, now = Date.now()) => openCalls(app, now).find((c) => c.lesson === lessonId) || null;

/** The next moment any shown call closes (ms), or null: the shell hides it then. */
export function nextClose(app, now = Date.now()) {
  const ends = openCalls(app, now).map(closeTime);
  return ends.length ? Math.min(...ends) : null;
}

/** Which calls are open, as one comparable string (the shell re-renders when it changes). */
export const openKey = (app, now = Date.now()) =>
  openCalls(app, now)
    .map((c) => `${c.lesson}:${c.castHash}`)
    .join(" ");

// ---- time, in the reader's zone ---------------------------------------------

const formats = new Map();
function format(timeZone) {
  const key = timeZone || "";
  if (!formats.has(key)) {
    const opts = { weekday: "short", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true };
    let f;
    try {
      f = new Intl.DateTimeFormat("en-US", { ...opts, timeZone: timeZone || undefined });
    } catch {
      f = new Intl.DateTimeFormat("en-US", opts); // an unknown zone: the reader's own
    }
    formats.set(key, f);
  }
  return formats.get(key);
}

/** A moment's calendar parts in `timeZone` (default: the reader's). */
export function localParts(ms, timeZone) {
  const p = {};
  for (const x of format(timeZone).formatToParts(new Date(ms))) p[x.type] = x.value;
  return { weekday: p.weekday, year: +p.year, month: +p.month, day: +p.day, hour: +p.hour, minute: p.minute, period: String(p.dayPeriod || "").toLowerCase() };
}

const dayNumber = (p) => Date.UTC(p.year, p.month - 1, p.day) / DAY;

/** "6 pm" on the hour, else "6:24 pm". */
export const clockText = (p) => (p.minute === "00" ? `${p.hour} ${p.period}` : `${p.hour}:${p.minute} ${p.period}`);

/** The full closing time: "Sun 15 Nov, 6:24 pm" in the reader's zone. */
export function closesOn(call, timeZone) {
  const p = localParts(closeTime(call), timeZone);
  return `${p.weekday} ${p.day} ${MONTHS[p.month - 1]}, ${clockText(p)}`;
}

/**
 * When the call closes, for the badge, relative to now in the reader's zone:
 *   under 1 h     "in 40 min"
 *   under 6 h     "in 3 h"
 *   under 24 h    "today 6 pm" / "tomorrow 1:24 am"
 *   under 7 days  "Sun"
 *   later         "23 Nov"
 * null once closed.
 */
export function closesWhen(call, now = Date.now(), timeZone) {
  const end = closeTime(call);
  const ms = end - now;
  if (!(ms > 0)) return null;
  if (ms < HOUR) return COPY.callInMin(Math.max(1, Math.floor(ms / MIN)));
  if (ms < 6 * HOUR) return COPY.callInHours(Math.floor(ms / HOUR));
  const a = localParts(now, timeZone);
  const b = localParts(end, timeZone);
  const days = dayNumber(b) - dayNumber(a);
  if (ms < DAY) return days <= 0 ? COPY.callToday(clockText(b)) : COPY.callTomorrow(clockText(b));
  if (days < 7) return b.weekday;
  return `${b.day} ${MONTHS[b.month - 1]}`;
}

/** Hours and minutes left when under 48 h (at least 1 min), else null. */
export function countdown(call, now = Date.now()) {
  const ms = closeTime(call) - now;
  if (!(ms > 0) || ms >= COUNTDOWN_MS) return null;
  const total = Math.max(1, Math.floor(ms / MIN));
  return { h: Math.floor(total / 60), m: total % 60 };
}

// ---- markup ------------------------------------------------------------------

/** The badge text, or "" when there is no open call. */
export const badgeText = (call, now, timeZone) => {
  const when = call ? closesWhen(call, now, timeZone) : null;
  return when ? COPY.callBadge(when) : "";
};

/**
 * The sticker on a home tile (whose art is hidden from screen readers, so the
 * tile says it in its own label too) or a lesson's cover.
 */
export function renderCallBadge(call, { now = Date.now(), timeZone, cls = "" } = {}) {
  const when = call ? closesWhen(call, now, timeZone) : null;
  if (!when) return empty;
  // two lines, so the time is never cut short: "● open call" over "closes in 3 h"
  return html`<span class="${`call-badge ${cls}`.trim()}" data-call="${call.lesson}" data-call-badge><span class="call-badge__k"><span class="call-badge__dot" aria-hidden="true"></span>${COPY.callKicker}</span><span class="call-badge__sep" aria-hidden="true"> · </span><span class="call-badge__w" data-call-text>${COPY.callCloses(when)}</span></span>`;
}

/** The closing line and, under 48 h, the countdown: redrawn in place as time passes. */
export function renderCallWhen(call, { now = Date.now(), timeZone } = {}) {
  const left = countdown(call, now);
  return html`<span class="call__closes" data-call-closes>${COPY.callCloses(closesOn(call, timeZone))}</span>${
    left
      ? html`<span class="call__left" data-call-left><span class="sr-only">${COPY.callLeft(left.h, left.m)}</span><span class="cd" aria-hidden="true"><span class="cd__n">${left.h}</span><span class="cd__u">${COPY.callUnits.h}</span></span><span class="cd" aria-hidden="true"><span class="cd__n">${String(left.m).padStart(2, "0")}</span><span class="cd__u">${COPY.callUnits.min}</span></span><span class="cd__left" aria-hidden="true">${COPY.callUnits.left}</span></span>`
      : empty
  }`;
}

/**
 * The card's two actions. `host`: inside a Farcaster client the reply opens
 * the host's composer and Earn opens as a Mini App (buttons the view wires);
 * on the web both are plain links that open in a new tab. Nothing is ever
 * posted for the reader: the composer only opens, the reader posts.
 */
export function renderCallActions(call, { host = false } = {}) {
  const reply = COPY.callReply(call.kind);
  const href = safeUrl(call.replyUrl);
  const replyEl = host
    ? html`<button class="btn btn--primary call__reply" type="button" data-call-reply="${call.castHash}">${reply}</button>`
    : href
      ? html`<a class="btn btn--primary call__reply" href="${href}" target="_blank" rel="noopener noreferrer" data-call-reply="${call.castHash}" aria-label="${COPY.callReplyA11y[call.kind === "build" ? "build" : "video"]}"><span>${reply}<span class="call__ext" aria-hidden="true">\u00a0↗</span></span></a>`
      : empty;
  const earnEl = host
    ? html`<button class="btn call__earn" type="button" data-call-earn>${COPY.callWinners}</button>`
    : html`<a class="btn call__earn" href="${EARN_URL}" target="_blank" rel="noopener noreferrer" data-call-earn aria-label="${COPY.callWinnersA11y}">${COPY.callWinners}</a>`;
  return html`${replyEl}<p class="mono call__status" data-call-status role="status"></p>${earnEl}<p class="mono call__credit">${COPY.callEarnBy}</p>`;
}

/**
 * The "Make the explainer" card's body: the reward and when the call closes
 * (a countdown under 48 h), the brief, the entries so far, one line of how-to,
 * then the reply and Earn actions.
 */
export function renderCallBody(call, { now = Date.now(), timeZone, host = false } = {}) {
  const long = call.reward.length > 12;
  return html`<div class="call" data-call="${call.lesson}" data-kind="${call.kind}">
${shout(COPY.callTitle, { cls: "shout call__title" })}
<p class="call__offer"${long ? html` data-long` : empty}><span class="call__reward">${call.reward}</span> <span class="call__for">${COPY.callOffer(call.kind)}</span><span class="call__sep" aria-hidden="true"> · </span><span class="call__when" data-call-when>${renderCallWhen(call, { now, timeZone })}</span></p>
<div class="say call__brief"><p class="say__tab">${pixelLabel(COPY.callBriefTab)}</p><p class="say__text call__brief-text">${call.brief}</p><p class="pixel call__entries">${COPY.callEntries(call.entries)}</p></div>
<p class="call__how">${COPY.callHowTo[call.kind === "build" ? "build" : "video"]}</p>
<div class="call__actions" data-call-actions>${renderCallActions(call, { host })}</div>
</div>`;
}

// ---- inside a host: the SDK's actions -------------------------------------------

/** The host SDK, loaded on first use from the identity lane's own lazy chunk (no second copy). */
export const loadHostSdk = () => import("./identity/lazy-miniapp.mjs").then((m) => m.sdk);

/**
 * Inside a host: open the host's composer as a reply to the call's post, with
 * a short line prefilled. The reader attaches the video and posts it, or
 * doesn't. If the host has no composer, its browser opens the post instead.
 */
export async function replyInHost(call, { loadSdk = loadHostSdk, text } = {}) {
  const sdk = await loadSdk();
  try {
    await sdk.actions.composeCast({ text: String(text ?? "").slice(0, 320), parent: { type: "cast", hash: call.castHash } });
  } catch {
    await sdk.actions.openUrl(call.replyUrl);
  }
}

/** Inside a host: past winners in Earn, opened as a Mini App (else in the host's browser). */
export async function openEarnInHost({ loadSdk = loadHostSdk } = {}) {
  const sdk = await loadSdk();
  try {
    await sdk.actions.openMiniApp({ url: EARN_URL });
  } catch {
    await sdk.actions.openUrl(EARN_URL);
  }
}
