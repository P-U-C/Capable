// A3: home. Pure rendering of the logo and headline, the stacked lesson
// tiles, and the "you" panel whose trait chips fill in as lessons finish.

import { html, join, empty, rich, num } from "./html.mjs";
import { COPY } from "./copy.mjs";
import { sceneSvg, sceneKey, logoSvg, confettiSvg, SCENE_LABELS } from "./art.mjs";
import { shout, traitChip } from "./cards.mjs";
import { lessonProgress } from "./store.mjs";
import { ordered, traitOf, traitProgress, traitsComplete } from "./model.mjs";

export { ordered, traitOf, traitProgress, traitsComplete, logoFill } from "./model.mjs";

/** A chunky outlined bar; the fill is an SVG width, so no style attribute is needed. */
export function bar(fraction, label, cls = "bar") {
  const f = Math.max(0, Math.min(1, Number(fraction) || 0));
  return html`<svg class="${cls}" viewBox="0 0 100 10" preserveAspectRatio="none" role="img" aria-label="${label}" focusable="false"><rect width="${num(f * 100)}" height="10"/></svg>`;
}

function tile({ lesson, position }, app, state) {
  const trait = traitOf(app, lesson);
  const p = lessonProgress(state, lesson.id);
  const cta = p.done ? COPY.again : p.started ? COPY.resume : COPY.start;
  const key = sceneKey(lesson);
  const status = p.done ? COPY.progressDone : p.fraction > 0 ? COPY.progressPct(p.fraction) : "";
  return html`<li class="tiles__item">
<a class="tile" href="${`#/l/${lesson.id}`}" data-hue="${trait.hue}" data-lesson="${lesson.id}"${lesson.status === "draft" ? html` data-draft="true"` : empty}>
<div class="frame frame--scene tile__art">${sceneSvg(key, trait.hue, `${lesson.id}-tile`, { label: SCENE_LABELS[key] })}${lesson.status === "draft" ? html`<span class="sticker tile__draft">${COPY.draft}</span>` : empty}</div>
<p class="mono tile__num">${COPY.lessonLabel(position)}</p>
${shout(lesson.title, { cls: "shout tile__title" })}
<p class="tile__promise">${rich(lesson.promise)}</p>
<div class="tile__meta">${traitChip(trait)}<span class="mono">${COPY.minutes(lesson.minutes)}</span></div>
<div class="tile__foot">
<div class="tile__progress">${bar(p.fraction, COPY.progressA11y(p.fraction, p.done))}${status ? html`<span class="mono tile__pct" aria-hidden="true">${status}</span>` : empty}</div>
<span class="btn btn--primary tile__cta" aria-hidden="true">${cta}</span>
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
  return html`<section class="you" id="you" aria-labelledby="you-h" tabindex="-1">
<div class="you__head"><h2 class="eyebrow" id="you-h">${`// ${COPY.you}`}</h2><p class="pixel you__count">${COPY.traitsDone(traitsComplete(tp), tp.length)}</p></div>
<p class="you__line">${rich(app.citizen?.line ?? "")}</p>
<ul class="tchips">${join(chips)}</ul>
<p class="mono smallprint">${COPY.credits}</p>
</section>`;
}

export function renderHome(app, state) {
  const list = ordered(app);
  const tp = traitProgress(app, state);
  return html`<main class="home" id="main">
<header class="home__head">
${confettiSvg("home-head", [{ x: 0.74, y: 0.72, w: 0.22, h: 0.2 }, { x: 0.86, y: 0.36, w: 0.12, h: 0.18 }, { x: 0.02, y: 0.26, w: 0.6, h: 0.03 }], 9)}
<div class="home__bar">${logoSvg({ title: app.name, filled: 7 })}<a class="sticker home__you" href="#/you"><span class="sr-only">${COPY.youOpen}: </span><span aria-hidden="true">${`// ${COPY.you}`}</span><span class="home__you-count">${COPY.traitsDone(traitsComplete(tp), tp.length)}</span></a></div>
${shout(COPY.homeShout(app.citizen?.name || app.name), { cls: "shout home__shout", level: 1 })}
<p class="accent home__accent">${COPY.homeAccent}</p>
</header>
<h2 class="sr-only">${COPY.lessons}</h2>
${list.length ? html`<ol class="tiles">${join(list.map((x) => tile(x, app, state)))}</ol>` : html`<p class="home__empty">${COPY.noLessons}</p>`}
${youPanel(app, state)}
</main>`;
}
