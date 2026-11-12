// Pure rendering of a lesson deck: the chrome (close, progress) and every card.
// Each card is a <section> region with an accessible name. Every string from
// app.json goes through the escaping `html` tag or `rich` (*emphasis* only).

import { html, join, empty, extLink, rich, plain, words } from "./html.mjs";
import { COPY } from "./copy.mjs";
import { sceneSvg, sceneKey, logoSvg, confettiSvg, SCENE_LABELS, SURFACE } from "./art.mjs";
import { renderLead, renderMore } from "./work.mjs";

const pad2 = (n) => String(n).padStart(2, "0");

/**
 * A Shout headline: the last word is the key word, set in the trait colour
 * with an ink outline, and gets a full stop if it has no punctuation.
 * data-n is the longest word's length so CSS can fit it to the card width.
 */
export function shout(text, { cls = "shout", level = 2, id } = {}) {
  const ws = String(text ?? "").trim().split(/\s+/).filter(Boolean);
  const last = ws.pop() ?? "";
  const dot = /[.!?…]$/.test(last) ? "" : ".";
  const n = Math.max(4, ...ws.map((w) => w.length), last.length + dot.length);
  const inner = html`${ws.length ? html`${ws.join(" ")} ` : empty}<span class="key">${last}${dot}</span>`;
  const idAttr = id ? html` id="${id}"` : empty;
  if (level === 1) return html`<h1 class="${cls}" data-n="${Math.min(n, 18)}"${idAttr}>${inner}</h1>`;
  if (level === 3) return html`<h3 class="${cls}" data-n="${Math.min(n, 18)}"${idAttr}>${inner}</h3>`;
  return html`<h2 class="${cls}" data-n="${Math.min(n, 18)}"${idAttr}>${inner}</h2>`;
}

/** A solid trait-colour chip with the trait's name. */
export const traitChip = (trait) => html`<span class="chip" data-hue="${trait.hue}">${trait.name}</span>`;

/** Seconds a reader needs for a card: drives the fill of the current progress segment. */
export function readSeconds(c) {
  const n = words(c.text) + words(c.heading) + words(c.def) + words(c.claim) + words(c.reply) + words(c.prompt) + (c.steps || []).reduce((m, s) => m + words(s), 0);
  if (c.type === "lead" || c.type === "more") return 0; // video drives its own fill; lists are read at will
  return Math.max(3, Math.min(30, Math.round(n / 3.2)));
}

function shell(c, i, ctx, eyebrow, body, { extra = "" } = {}) {
  const name = COPY.cardName[c.type] ?? c.type;
  return html`<section class="card card--${c.type}${extra}" data-i="${i}" data-type="${c.type}" data-read="${readSeconds(c)}" role="region" aria-roledescription="card" aria-label="${COPY.cardOf(i + 1, ctx.count)}: ${name}" tabindex="-1">
<header class="card__head"><p class="eyebrow">${eyebrow}</p>${confettiSvg(`${ctx.lesson.id}/${c.key}`, [{ x: 0.56, y: 0.12, w: 0.38, h: 0.7 }], 7)}</header>
<div class="card__body">${body}</div>
</section>`;
}

const RENDER = {
  cover: (c, i, ctx) =>
    shell(
      c,
      i,
      ctx,
      COPY.label.cover(ctx.position),
      html`<div class="frame frame--scene cover__art">${sceneSvg(sceneKey(ctx.lesson), ctx.hue, `${ctx.lesson.id}-cover`, { label: SCENE_LABELS[sceneKey(ctx.lesson)] })}</div>
${shout(ctx.lesson.title, { cls: "shout cover__title" })}
<p class="cover__promise">${rich(ctx.lesson.promise)}</p>
<div class="cover__meta">${traitChip(ctx.trait)}<span class="pixel">${`// ${COPY.minutes(ctx.lesson.minutes)}`}</span></div>
<p class="pixel cover__hint" aria-hidden="true">${COPY.swipeHint}<svg viewBox="0 0 24 12" focusable="false"><path d="M1 6h20M16 1l5 5-5 5"/></svg></p>`,
    ),

  idea: (c, i, ctx) => shell(c, i, ctx, COPY.label.idea, html`<p class="idea__text">${rich(c.text)}</p>`),

  story: (c, i, ctx) =>
    shell(c, i, ctx, COPY.label.story, html`<h2 class="story__heading">${rich(c.heading)}</h2><p class="story__text">${rich(c.text)}</p>`),

  term: (c, i, ctx) =>
    shell(c, i, ctx, COPY.label.term, html`<h2 class="term__term"><span class="chip chip--big" data-hue="${ctx.hue}">${rich(c.term)}</span></h2><p class="term__def">${rich(c.def)}</p>`),

  counter: (c, i, ctx) =>
    shell(
      c,
      i,
      ctx,
      COPY.label.counter,
      html`<blockquote class="counter__claim"><p>${rich(c.claim)}</p></blockquote>
<p class="eyebrow counter__label">${COPY.label.reply}</p>
<p class="counter__reply">${rich(c.reply)}</p>`,
    ),

  question: (c, i, ctx) =>
    shell(c, i, ctx, COPY.label.question, html`<p class="accent question__text">${rich(c.text)}</p><span class="question__mark" aria-hidden="true">?</span>`),

  practice: (c, i, ctx) => {
    const ticked = new Set(ctx.ticks?.[`${ctx.lesson.id}/${c.key}`] || []);
    const steps = (c.steps || []).map(
      (s, n) =>
        html`<li><button class="step" type="button" data-step="${n}" data-tick-key="${`${ctx.lesson.id}/${c.key}`}" aria-pressed="${ticked.has(n) ? "true" : "false"}"><span class="step__n" aria-hidden="true">${n + 1}</span><span class="step__t">${rich(s)}</span></button></li>`,
    );
    return shell(c, i, ctx, COPY.label.practice, html`<p class="practice__prompt">${rich(c.prompt)}</p><ol class="steps">${join(steps)}</ol>`);
  },

  lead: (c, i, ctx) =>
    shell(c, i, ctx, c.work.kind === "build" ? COPY.label.leadBuild : COPY.label.lead, renderLead(ctx.app, ctx.lesson, c.work, { hue: ctx.hue, uid: `${ctx.lesson.id}-${c.key}` }), {
      extra: c.work.kind === "build" ? " card--build" : " card--video",
    }),

  more: (c, i, ctx) => shell(c, i, ctx, COPY.label.more, renderMore(ctx.app, ctx.lesson, c.works, { hue: ctx.hue, uid: `${ctx.lesson.id}-more` })),

  trait: (c, i, ctx) =>
    shell(
      c,
      i,
      ctx,
      COPY.label.trait,
      html`<div class="trait__burst" aria-hidden="true">${confettiSvg(`${ctx.lesson.id}/burst`, [{ x: 0.06, y: 0.04, w: 0.88, h: 0.12 }, { x: 0.06, y: 0.86, w: 0.88, h: 0.1 }], 12)}</div>
<div class="trait__logo">${logoSvg({ filled: ctx.logoFilled, outline: true, paper: SURFACE, title: `${ctx.app.citizen?.name ?? ctx.app.name}: ${COPY.lessonsDone(ctx.doneAfter, ctx.totalLessons)}` })}</div>
<p class="pixel trait__count">${`// ${COPY.lessonsDone(ctx.doneAfter, ctx.totalLessons)}`}</p>
${shout(ctx.trait.name, { cls: "shout trait__name" })}
<p class="trait__grant">${rich(ctx.trait.grant)}</p>
<p class="trait__chip">${traitChip(ctx.trait)}<span class="pixel">${COPY.traitCount(ctx.traitDone, ctx.traitTotal)}</span></p>`,
    ),

  deeper: (c, i, ctx) => {
    const items = (ctx.lesson.sources || []).map(
      (s) => html`<li class="source">
<p class="source__title">${s.title}</p>
<p class="mono source__by">${s.author}, ${s.year}</p>
<p class="source__note">${rich(s.note)}</p>
${extLink(s.url, COPY.readMore, { cls: "mono source__link", aria: `${COPY.readMore.replace(" ↗", "")}: ${s.title}, opens in a new tab` })}
</li>`,
    );
    return shell(c, i, ctx, COPY.label.deeper, html`<ul class="sources">${join(items)}</ul>`);
  },

  next: (c, i, ctx) => {
    const nx = ctx.next;
    if (!nx) {
      return shell(
        c,
        i,
        ctx,
        COPY.label.end,
        html`${shout(COPY.endShout, { cls: "shout next__title" })}<p class="next__text">${COPY.allDone}</p>
<div class="next__actions"><a class="btn btn--primary" href="#/you">${COPY.seeTraits}</a><a class="btn" href="#/">${COPY.allLessons}</a></div>`,
      );
    }
    return shell(
      c,
      i,
      ctx,
      COPY.label.next,
      html`<a class="tile tile--mini" href="${`#/l/${nx.lesson.id}`}" data-hue="${nx.trait.hue}" aria-label="${COPY.nextLesson(nx.position)}: ${nx.lesson.title}">
<div class="frame frame--scene">${sceneSvg(sceneKey(nx.lesson), nx.trait.hue, `${nx.lesson.id}-next`)}</div>
${shout(nx.lesson.title, { cls: "shout tile__title", level: 3 })}
<p class="tile__promise">${rich(nx.lesson.promise)}</p>
</a>
<div class="next__actions"><a class="btn btn--primary" href="${`#/l/${nx.lesson.id}`}">${COPY.nextLesson(nx.position)}</a><a class="btn" href="#/">${COPY.allLessons}</a></div>`,
    );
  },
};

/** One card's markup. Unknown types render nothing (deckCards already drops them). */
export function renderCard(c, i, ctx) {
  const r = RENDER[c.type];
  return r ? r(c, i, ctx) : empty;
}

/** The whole lesson view: chrome, the stack of cards, desktop arrows, live region. */
export function renderDeck(ctx, cards) {
  const segs = cards.map((_, i) => html`<span class="seg" data-seg="${i}"><i></i></span>`);
  return html`<main class="deck" id="main" aria-label="${COPY.deckLabel(plain(ctx.lesson.title))}" data-hue="${ctx.hue}" data-lesson="${ctx.lesson.id}">
<div class="deck__top">
<a class="btn-icon deck__close" href="#/" aria-label="${COPY.close}"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18"/></svg></a>
<div class="segs" role="progressbar" aria-label="${COPY.progressLabel}" aria-valuemin="1" aria-valuemax="${cards.length}" aria-valuenow="1">${join(segs)}</div>
</div>
<div class="deck__stage">${join(cards.map((c, i) => renderCard(c, i, ctx)))}</div>
<button class="btn-icon deck__nav deck__nav--prev" type="button" data-nav="prev" aria-label="${COPY.prev}"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M15 5l-7 7 7 7"/></svg></button>
<button class="btn-icon deck__nav deck__nav--next" type="button" data-nav="next" aria-label="${COPY.next}"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M9 5l7 7-7 7"/></svg></button>
<p class="sr-only" aria-live="polite" data-announce></p>
</main>`;
}
