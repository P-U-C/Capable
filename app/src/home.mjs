// A3: home. Pure rendering of the logo and headline, a short intro that says
// what this is and where to start, the stacked lesson tiles, and the "you"
// panel whose trait chips fill in as lessons finish.

import { html, join, empty, rich, num, plain } from "./html.mjs";
import { COPY } from "./copy.mjs";
import { lessonArt, brandLockup, confettiSvg } from "./art.mjs";
import { earnedTraitIds, chipAvatar } from "./passport.mjs";
import { shout, traitChip, pixelLabel } from "./cards.mjs";
import { lessonProgress } from "./store.mjs";
import { ordered, traitOf, traitProgress, traitsComplete, upNext, homeFacts } from "./model.mjs";

export { ordered, traitOf, traitProgress, traitsComplete, logoFill, upNext } from "./model.mjs";

/**
 * A chunky outlined bar; the fill is an SVG width, so no style attribute is
 * needed. An ink edge marks where the fill ends, so the bar reads at 3:1 or
 * better even when the fill is a pale candy (review U12).
 */
export function bar(fraction, label, cls = "bar") {
  const f = Math.max(0, Math.min(1, Number(fraction) || 0));
  const x = num(f * 100);
  return html`<svg class="${cls}" viewBox="0 0 100 10" preserveAspectRatio="none" role="img" aria-label="${label}" focusable="false"><rect width="${x}" height="10"/>${f > 0 && f < 1 ? html`<line class="bar__edge" x1="${x}" x2="${x}" y1="0" y2="10"/>` : empty}</svg>`;
}

const arrow = html`<svg class="arrow" viewBox="0 0 24 12" aria-hidden="true" focusable="false"><path d="M1 6h20M16 1l5 5-5 5"/></svg>`;

/** The intro under the headline (review U1): who this helps you become, how long it takes, and one button to start or continue. */
function intro(app, state) {
  const up = upNext(app, state);
  const facts = homeFacts(app);
  let action = empty;
  if (up) {
    const cta = up.started ? COPY.heroContinue(up.position) : COPY.heroStart(up.position);
    action = html`<a class="btn btn--primary intro__cta" href="${`#/l/${up.lesson.id}`}" aria-label="${COPY.heroA11y(cta, plain(up.lesson.title))}">${cta}${arrow}</a>`;
  } else if (facts.lessons > 0) {
    action = html`<p class="pixel intro__done">${pixelLabel(COPY.heroDone)}</p><a class="btn intro__cta" href="#/passport">${COPY.seeTraits}${arrow}</a>`;
  }
  return html`<div class="intro">
<p class="intro__line">${rich(app.citizen?.line ?? "")}</p>
${facts.lessons ? html`<p class="mono intro__facts">${join(COPY.homeFacts(facts).split(" · ").map((f) => html`<span class="nowrap">${f}</span>`), " · ")}</p>` : empty}
${action}
</div>`;
}

function tile({ lesson, position }, app, state, upId) {
  const trait = traitOf(app, lesson);
  const p = lessonProgress(state, lesson.id);
  const isNext = lesson.id === upId;
  const cta = p.done ? COPY.again : p.started ? COPY.resume : COPY.start;
  const id = `t-${lesson.id}`;
  const look = p.done ? "done" : isNext ? "next" : "todo";
  // Not started: no empty bar (it reads as a text field), just the words (review U12).
  const progress = p.started && !p.done
    ? html`<div class="tile__progress">${bar(p.fraction, COPY.progressA11y(p.fraction, p.done))}<span class="mono tile__pct" aria-hidden="true">${COPY.progressPct(p.fraction)}</span></div>`
    : p.done
      ? empty
      : html`<p class="mono tile__state" aria-hidden="true">${COPY.notStarted}</p>`;
  return html`<li class="tiles__item">
<a class="tile" href="${`#/l/${lesson.id}`}" data-hue="${trait.hue}" data-lesson="${lesson.id}" data-look="${look}"${lesson.status === "draft" ? html` data-draft="true"` : empty} aria-labelledby="${`${id}-title ${id}-state`}" aria-describedby="${`${id}-promise`}">
<div class="frame frame--scene tile__art" aria-hidden="true">${lessonArt(lesson, trait, `${lesson.id}-tile`)}${lesson.status === "draft" ? html`<span class="sticker tile__draft">${COPY.draft}</span>` : empty}${p.done ? html`<span class="sticker tile__done">${COPY.doneSticker}</span>` : empty}</div>
<p class="mono tile__num" aria-hidden="true">${pixelLabel(COPY.lessonLabel(position))}</p>
${shout(lesson.title, { cls: "shout tile__title", id: `${id}-title` })}
<p class="tile__promise" id="${`${id}-promise`}">${rich(lesson.promise)}</p>
<div class="tile__meta" aria-hidden="true">${traitChip(trait)}<span class="mono">${COPY.minutes(lesson.minutes)}</span></div>
<span class="sr-only" id="${`${id}-state`}">${COPY.tileA11y(position, COPY.progressA11y(p.fraction, p.done), lesson.minutes)}</span>
<div class="tile__foot" aria-hidden="true">
${progress}
<span class="${isNext ? "btn btn--primary tile__cta" : "btn tile__cta"}">${cta}</span>
</div>
</a>
</li>`;
}

function youPanel(app, state) {
  const tp = traitProgress(app, state);
  const chips = tp.map(
    ({ trait, total, done, fraction }) => html`<li class="tchip" data-hue="${trait.hue}" data-full="${total > 0 && done === total ? "true" : "false"}">
<div class="tchip__bar" role="img" aria-label="${COPY.traitA11y(trait.name, done, total)}"><svg class="tchip__fill" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true" focusable="false"><rect width="${num(fraction * 100)}" height="10"/></svg><span class="tchip__name" aria-hidden="true">${trait.name}</span><span class="mono tchip__count" aria-hidden="true">${COPY.traitCount(done, total)}</span></div>
<p class="tchip__grant">${rich(trait.grant)}</p>
</li>`,
  );
  const complete = traitsComplete(tp);
  return html`<section class="you" id="you" aria-labelledby="you-h" tabindex="-1">
<div class="you__head"><h2 class="eyebrow" id="you-h">${pixelLabel(`// ${COPY.you}`)}</h2><p class="pixel you__count"><span aria-hidden="true">${COPY.traitsDone(complete, tp.length)}</span><span class="sr-only">${COPY.traitsA11y(complete, tp.length)}</span></p></div>
<p class="you__line">${rich(app.citizen?.line ?? "")}</p>
<ul class="tchips">${join(chips)}</ul>
<p class="mono smallprint">${COPY.credits}</p>
</section>`;
}

/**
 * The header's mark: the citizen seal and wordmark, its ring filled with the
 * traits earned so far (U18). On a first run (nothing earned) the ring is
 * shown `firstRun`: "empty" (chosen: the wordmark's four candies carry the
 * brand, and the ring only ever gains colour as traits are earned) or "full"
 * (all four quarters, which would then drop to one after the first lesson).
 */
export const FIRST_RUN_LOGO = "empty";
export function headerLogo(app, state, { firstRun = FIRST_RUN_LOGO } = {}) {
  const earned = earnedTraitIds(app, state);
  const filled = earned.length === 0 && firstRun === "full" ? undefined : earned;
  return html`<span class="home__logo" data-filled="${earned.join(" ")}">${brandLockup({ size: 44, filled })}</span>`;
}

/**
 * `who`: { identity, localId } for the "you" chip: signed in, it carries a
 * 48px portrait (or the profile picture); it opens the passport.
 */
export function renderHome(app, state, { who = {}, firstRun } = {}) {
  const list = ordered(app);
  const tp = traitProgress(app, state);
  const up = upNext(app, state);
  const complete = traitsComplete(tp);
  const avatar = chipAvatar(who.identity, who.localId);
  return html`<main class="home" id="main">
<header class="home__head">
${confettiSvg("home-head", [{ x: 0.74, y: 0.2, w: 0.22, h: 0.14 }, { x: 0.86, y: 0.04, w: 0.12, h: 0.1 }, { x: 0.02, y: 0.12, w: 0.6, h: 0.02 }], 9)}
<div class="home__bar">${headerLogo(app, state, { firstRun })}<a class="sticker home__you" href="#/passport"${who.identity ? html` data-signed="in"` : empty}>${avatar}<span class="sr-only">${COPY.passportOpen}: ${COPY.traitsA11y(complete, tp.length)}</span><span class="home__you-label" aria-hidden="true">// ${COPY.you}</span><span class="home__you-count" aria-hidden="true">${COPY.traitsDone(complete, tp.length)}</span></a></div>
${shout(COPY.homeShout(app.citizen?.name || app.name), { cls: "shout home__shout", level: 1 })}
<p class="accent home__accent">${COPY.homeAccent}</p>
${intro(app, state)}
</header>
<h2 class="sr-only">${COPY.lessons}</h2>
${list.length ? html`<ol class="tiles">${join(list.map((x) => tile(x, app, state, up?.lesson.id)))}</ol>` : html`<p class="home__empty">${COPY.noLessons}</p>`}
${youPanel(app, state)}
</main>`;
}
