// A2: the two work slots. Pure rendering of the creators' work plus the
// decision of how a video can play here. The DOM half (the <video> element,
// lazy hls.js) is src/player.mjs.

import { html, join, empty, safeUrl, extLink, rich } from "./html.mjs";
import { COPY } from "./copy.mjs";
import { sceneSvg, sceneKey, confettiSvg } from "./art.mjs";

const USERNAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** "@username", or "a creator" when the creator is unknown or has no valid username. */
export function creatorName(app, fid) {
  const c = app?.creators?.[String(fid)];
  return c && typeof c.username === "string" && USERNAME.test(c.username) ? `@${c.username}` : COPY.aCreator;
}

/** The works that fill a slot, in the order compile gave them. */
export const worksFor = (lesson, role) => (Array.isArray(lesson?.work) ? lesson.work.filter((w) => w && w.role === role) : []);

/**
 * How a video plays in this browser:
 *   native  — Safari plays the HLS playlist itself
 *   file    — an mp4 the <video> element plays directly
 *   hlsjs   — HLS through hls.js, loaded lazily on first play
 *   external — no playable stream; link out to where it lives
 *   none    — nothing usable
 * Only https URLs are considered.
 */
export function pickSource(video, { nativeHls = false } = {}) {
  const hls = safeUrl(video?.hls);
  const mp4 = safeUrl(video?.mp4);
  const ext = safeUrl(video?.external);
  if (hls && nativeHls) return { mode: "native", url: hls };
  if (mp4) return { mode: "file", url: mp4 };
  if (hls) return { mode: "hlsjs", url: hls };
  if (ext) return { mode: "external", url: ext };
  return { mode: "none", url: null };
}

/** Where "watch the original" goes: the video's own page if given, else the original post. */
export const fallbackUrl = (work) => safeUrl(work?.video?.external) || safeUrl(work?.original);

/** The mono credit strip: "by @papa · original ↗". */
export function credit(app, work) {
  const name = creatorName(app, work.fid);
  return html`<p class="credit"><span class="credit__by">${COPY.by(name)}</span>${safeUrl(work.original) ? html`<span class="credit__dot" aria-hidden="true">·</span>` : empty}${extLink(work.original, COPY.original, { cls: "credit__link", aria: COPY.originalA11y(name) })}</p>`;
}

/** The poster and error face shared by every video frame. */
function videoFrame(app, lesson, work, hue, uid) {
  const name = creatorName(app, work.fid);
  const fb = fallbackUrl(work);
  return html`<div class="vframe" data-work="${work.id}">
<div class="vframe__poster">${sceneSvg(sceneKey(lesson), hue, `${uid}-poster`)}</div>
<button class="vframe__play" type="button" data-play aria-label="${COPY.playA11y(name)}"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 5.5v13l11-6.5Z"/></svg></button>
<button class="pill vframe__sound" type="button" data-sound aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 9h4l5-4v14l-5-4H4Z"/><path class="sound-on" d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none"/><path class="sound-off" d="M16 9l5 6M21 9l-5 6" fill="none"/></svg><span class="vframe__sound-label">${COPY.unmute}</span></button>
<p class="pill vframe__paused" aria-hidden="true">${COPY.paused}</p>
<div class="vframe__error"><p>${COPY.videoUnavailable}</p>${fb ? extLink(fb, COPY.watchOriginal, { cls: "btn btn--primary btn--small" }) : empty}</div>
</div>`;
}

function buildLinks(work, { small = false } = {}) {
  const site = safeUrl(work.build?.site);
  const repo = safeUrl(work.build?.repo);
  const size = small ? " btn--small" : "";
  return html`<div class="build-links">${site ? extLink(site, COPY.openGuide, { cls: `btn btn--primary${size}` }) : empty}${repo ? extLink(repo, COPY.seeCode, { cls: `btn${site ? "" : " btn--primary"}${size}` }) : empty}</div>`;
}

/** The lead slot: one creator's work, big. Video gets the 9:16 frame; a build gets its guide and code. */
export function renderLead(app, lesson, work, { hue, uid }) {
  if (work.kind === "build") {
    return html`<div class="lead lead--build">
<div class="frame frame--scene">${sceneSvg("build", hue, `${uid}-build`)}</div>
<p class="lead__caption">${rich(work.caption)}</p>
${credit(app, work)}
${buildLinks(work)}
</div>`;
  }
  return html`<div class="lead lead--video">
${videoFrame(app, lesson, work, hue, uid)}
<p class="lead__caption">${rich(work.caption)}</p>
${credit(app, work)}
</div>`;
}

/** The more slot: every other take, stacked. Videos open in a sheet; builds link out. */
export function renderMore(app, lesson, works, { hue, uid }) {
  const items = works.map((w, i) => {
    const name = creatorName(app, w.fid);
    const thumb =
      w.kind === "video"
        ? html`<button class="mini__thumb" type="button" data-open="${w.id}" aria-label="${COPY.playA11y(name)}">${sceneSvg(sceneKey(lesson), hue, `${uid}-m${i}`, { align: ["xMinYMid", "xMidYMid", "xMaxYMid"][i % 3], fit: "slice" })}<span class="mini__play" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="M8 5.5v13l11-6.5Z"/></svg></span></button>`
        : html`<div class="mini__thumb mini__thumb--build" aria-hidden="true">${sceneSvg("build", hue, `${uid}-m${i}`)}</div>`;
    return html`<li class="mini">
${thumb}
<div class="mini__body">
<p class="mini__caption">${rich(w.caption)}</p>
${credit(app, w)}
${w.kind === "build" ? buildLinks(w, { small: true }) : empty}
</div>
</li>`;
  });
  return html`<ul class="minis">${join(items)}</ul>`;
}

/** The sheet that plays a "more" video full size. */
export function renderSheet(app, lesson, work, { hue, uid }) {
  const name = creatorName(app, work.fid);
  return html`<div class="sheet" role="dialog" aria-modal="true" aria-label="${COPY.playA11y(name)}">
<div class="sheet__inner">
<button class="btn-icon sheet__close" type="button" data-close-sheet aria-label="${COPY.closeVideo}"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
${videoFrame(app, lesson, work, hue, uid)}
<p class="lead__caption">${rich(work.caption)}</p>
${credit(app, work)}
</div>
${confettiSvg(`sheet-${work.id}`, [{ x: 0.05, y: 0.02, w: 0.9, h: 0.04 }], 6)}
</div>`;
}
