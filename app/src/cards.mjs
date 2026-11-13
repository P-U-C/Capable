// Pure rendering of a lesson deck: the chrome (close, progress) and every card.
// Each card is a <section> region with an accessible name. Every string from
// app.json goes through the escaping `html` tag or `rich` (*emphasis* only).

import { html, join, empty, extLink, rich, plain, words } from "./html.mjs";
import { COPY } from "./copy.mjs";
import { lessonArt, confettiSvg, stampArt, previewArt, stampMarkup } from "./art.mjs";
import { renderLead, renderMore } from "./work.mjs";
import { preview as stampPreview } from "./stamps/index.mjs";

/** The holder a stamp preview uses when the view knows none: a fixed, obviously-unowned stand-in. */
export const PREVIEW_HOLDER = "0x000000000000000000000000000000000000ca9a";

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

/**
 * A Pixel label such as "// idea". The "//" is decoration: screen readers
 * skip it and read only the words (review U11).
 */
export function pixelLabel(text) {
  const m = /^\/\/\s?(.*)$/s.exec(String(text ?? ""));
  return m ? html`<span class="slashes" aria-hidden="true">// </span>${m[1]}` : html`${text}`;
}

/** A solid trait-colour chip with the trait's name. */
export const traitChip = (trait) => html`<span class="chip" data-hue="${trait.hue}">${trait.name}</span>`;

/** Seconds a reader needs for a card: drives the fill of the current progress segment. */
export function readSeconds(c) {
  const n = words(c.text) + words(c.heading) + words(c.def) + words(c.claim) + words(c.reply) + words(c.prompt) + (c.steps || []).reduce((m, s) => m + words(s), 0);
  if (c.type === "lead" || c.type === "more") return 0; // video drives its own fill; lists are read at will
  return Math.max(3, Math.min(30, Math.round(n / 3.2)));
}

/**
 * Idea cards rotate three looks by their place among the lesson's ideas, so
 * a deck has rhythm: trait-colour fill with ink text, off-white paper with the
 * key phrase marked in the trait colour, and ink with off-white text.
 */
export const IDEA_LOOKS = ["fill", "paper", "ink"];
export const ideaLook = (ord) => IDEA_LOOKS[(((Math.trunc(Number(ord)) || 0) % 3) + 3) % 3];

/**
 * An idea's key phrase, as *emphasis*: the text's own emphasis when it has
 * any, else its first sentence when that is short and not the whole text,
 * else a short lead-in that ends in a colon. Returns the text unchanged when
 * there is nothing to mark.
 */
export function keyPhrase(text) {
  const s = String(text ?? "");
  if (/\*[^*\n]+\*/.test(s)) return s;
  for (const re of [/^([^*\n]+?[.!?])\s+(?=\S)/, /^([^*\n.!?:]+?:)\s+(?=\S)/]) {
    const m = s.match(re);
    if (m && words(m[1]) <= 14) return `*${m[1]}*${s.slice(m[1].length)}`;
  }
  return s;
}

/** Cards whose text a reader can select (long-press, drag with a mouse); video and lists keep press-and-hold. */
const SELECTABLE = new Set(["cover", "idea", "story", "term", "counter", "question", "practice", "trait", "deeper"]);

function shell(c, i, ctx, eyebrow, body, { extra = "", look = "" } = {}) {
  const name = COPY.cardName[c.type] ?? c.type;
  const lookAttr = look ? html` data-look="${look}"` : empty;
  const sel = SELECTABLE.has(c.type) ? html` data-selectable` : empty;
  // The "more below" cue is its own strip under the body, never over the text (review U8).
  return html`<section class="card card--${c.type}${extra}" data-i="${i}" data-type="${c.type}" data-key="${c.key}"${lookAttr} data-read="${readSeconds(c)}" role="region" aria-roledescription="card" aria-label="${COPY.cardOf(i + 1, ctx.count)}: ${name}" tabindex="-1">
<header class="card__head"><p class="eyebrow">${pixelLabel(eyebrow)}</p>${confettiSvg(`${ctx.lesson.id}/${c.key}`, [{ x: 0.56, y: 0.12, w: 0.38, h: 0.7 }], 7)}</header>
<div class="card__body"${sel}>${body}</div>
<div class="card__more" aria-hidden="true"><span class="card__more-tab"><svg viewBox="0 0 24 24" focusable="false"><path d="M6 9l6 6 6-6"/></svg></span></div>
</section>`;
}

const RENDER = {
  cover: (c, i, ctx) =>
    shell(
      c,
      i,
      ctx,
      COPY.label.cover(ctx.position),
      html`<div class="frame frame--scene cover__art">${lessonArt(ctx.lesson, ctx.trait, `${ctx.lesson.id}-cover`, { label: true })}</div>
${shout(ctx.lesson.title, { cls: "shout cover__title" })}
<p class="cover__promise">${rich(ctx.lesson.promise)}</p>
<div class="cover__meta">${traitChip(ctx.trait)}<span class="pixel">${pixelLabel(`// ${COPY.minutes(ctx.lesson.minutes)}`)}</span></div>
<p class="pixel cover__hint" aria-hidden="true"><span class="hint--touch">${COPY.swipeHint}</span><span class="hint--fine">${COPY.keyHint}</span><svg viewBox="0 0 24 12" focusable="false"><path d="M1 6h20M16 1l5 5-5 5"/></svg></p>`,
    ),

  idea: (c, i, ctx) => {
    const look = ideaLook(c.ord);
    const text = look === "paper" ? keyPhrase(c.text) : c.text;
    return shell(
      c,
      i,
      ctx,
      COPY.label.idea,
      html`<p class="idea__text">${rich(text)}</p>
<div class="idea__deco" aria-hidden="true"><span class="idea__num">${(Number(c.ord) || 0) + 1}</span>${confettiSvg(`${ctx.lesson.id}/${c.key}/deco`, [{ x: 0.7, y: 0.42, w: 0.24, h: 0.46 }], 8)}</div>`,
      { look },
    );
  },

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
      html`<div class="say say--but"><p class="say__tab">${pixelLabel(COPY.label.but)}</p><p class="say__text counter__claim">${rich(c.claim)}</p></div>
<div class="say say--reply"><p class="say__tab">${pixelLabel(COPY.label.reply)}</p><p class="say__text counter__reply">${rich(c.reply)}</p></div>`,
    ),

  question: (c, i, ctx) =>
    shell(c, i, ctx, COPY.label.question, html`<p class="accent question__text">${rich(c.text)}</p><span class="question__deco" aria-hidden="true"><span class="question__mark">?</span></span>`),

  practice: (c, i, ctx) => {
    // Ticks are kept by the card's stable key and each step's id (review S12).
    const key = `${ctx.lesson.id}/${c.key}`;
    const ticked = new Set(ctx.ticks?.[key] || []);
    const ids = c.stepIds || [];
    const steps = (c.steps || []).map(
      (s, n) =>
        html`<li><button class="step" type="button" data-step="${ids[n] ?? ""}" data-tick-key="${key}" aria-pressed="${ticked.has(ids[n]) ? "true" : "false"}"><span class="step__box" aria-hidden="true"><span class="step__n">${n + 1}</span><svg class="step__check" viewBox="0 0 24 24" focusable="false"><path d="M5 12.5l4.5 4.5L19 7"/></svg></span><span class="step__t">${rich(s)}</span></button></li>`,
    );
    const all = steps.length > 0 && ids.every((x) => ticked.has(x));
    return shell(
      c,
      i,
      ctx,
      COPY.label.practice,
      html`<p class="practice__prompt">${rich(c.prompt)}</p><p class="pixel steps__hint">${pixelLabel(COPY.stepsHint)}</p><ol class="steps">${join(steps)}</ol><p class="sticker practice__done" data-practice-done${all ? html` data-on` : empty}>${COPY.practiceDone}</p>`,
    );
  },

  lead: (c, i, ctx) =>
    shell(c, i, ctx, c.work.kind === "build" ? COPY.label.leadBuild : COPY.label.lead, renderLead(ctx.app, ctx.lesson, c.work, { hue: ctx.hue, uid: `${ctx.lesson.id}-${c.key}` }), {
      extra: c.work.kind === "build" ? " card--build" : " card--video",
    }),

  more: (c, i, ctx) => shell(c, i, ctx, COPY.label.more, renderMore(ctx.app, ctx.lesson, c.works, { hue: ctx.hue, uid: `${ctx.lesson.id}-more` })),

  // The reward (review U6): the card takes the trait colour, the stamp is
  // pressed onto it, and it says where the stamp went: saved to the passport,
  // or (when a wallet and the stamps contract exist) offered for minting. The
  // view swaps [data-stamp-act] as the mint goes (renderStampAct).
  trait: (c, i, ctx) =>
    shell(
      c,
      i,
      ctx,
      COPY.label.trait,
      html`<div class="trait__burst" aria-hidden="true">${confettiSvg(`${ctx.lesson.id}/burst`, [{ x: 0.04, y: 0.02, w: 0.92, h: 0.1 }, { x: 0.04, y: 0.9, w: 0.92, h: 0.08 }], 12)}</div>
<div class="trait__stamp" role="img" aria-label="${COPY.stampA11y(ctx.trait.name)}" data-hue="${ctx.hue}"><div class="trait__press" aria-hidden="true">${renderTraitStamp(ctx)}</div></div>
${shout(ctx.trait.name, { cls: "shout trait__name" })}
<p class="trait__grant">${rich(ctx.trait.grant)}</p>
<p class="pixel trait__count">${pixelLabel(`// ${COPY.lessonsDone(ctx.doneAfter, ctx.totalLessons)}`)}</p>
<div class="trait__act" data-stamp-act data-trait="${ctx.trait.id}">${renderStampAct(ctx.act || { phase: ctx.lesson.status === "ready" ? "saved" : "draft" })}</div>`,
      { look: "fill" },
    ),

  deeper: (c, i, ctx) => {
    const items = (ctx.lesson.sources || []).map(
      (s) => html`<li class="source">
<p class="source__title">${s.title}</p>
<p class="mono source__by">${s.author}, ${s.year}</p>
<p class="source__note">${rich(s.note)}</p>
${extLink(s.url, COPY.readMore, { cls: "mono source__link", aria: `Read: ${s.title}, opens in a new tab` })}
</li>`,
    );
    return shell(c, i, ctx, COPY.label.deeper, html`<ul class="sources">${join(items)}</ul>`);
  },

  // The hand-off goes to the next lesson the reader has not finished (wrapping
  // round), and says "all caught up" only when every ready lesson is done (review U3).
  next: (c, i, ctx) => {
    const nx = ctx.next;
    if (!nx) {
      return shell(
        c,
        i,
        ctx,
        COPY.label.end,
        html`${shout(COPY.endShout, { cls: "shout next__title" })}<p class="next__text">${COPY.allDone}</p>
<div class="next__actions"><a class="btn btn--primary" href="#/passport">${COPY.seeTraits}</a><a class="btn" href="#/">${COPY.allLessons}</a></div>`,
      );
    }
    return shell(
      c,
      i,
      ctx,
      COPY.label.next,
      html`<a class="tile tile--mini" href="${`#/l/${nx.lesson.id}`}" data-hue="${nx.trait.hue}" aria-label="${nx.started ? COPY.continueLesson(nx.position) : COPY.nextLesson(nx.position)}: ${plain(nx.lesson.title)}">
<div class="frame frame--scene" aria-hidden="true">${lessonArt(nx.lesson, nx.trait, `${nx.lesson.id}-next`)}</div>
${shout(nx.lesson.title, { cls: "shout tile__title", level: 3 })}
<p class="tile__promise">${rich(nx.lesson.promise)}</p>
</a>
<p class="mono next__left">${COPY.lessonsLeft(ctx.left)}</p>
<div class="next__actions"><a class="btn btn--primary" href="${`#/l/${nx.lesson.id}`}">${nx.started ? COPY.continueLesson(nx.position) : COPY.nextLesson(nx.position)}</a><a class="btn" href="#/">${COPY.allLessons}</a></div>`,
    );
  },
};

const isTokenId = (n) => Number.isInteger(n) && n >= 1 && n <= 999_999_999;

/**
 * The trait card's stamp. Minted (`ctx.minted`: { holder, tokenId } from a
 * success receipt): the exact on-chain art, serial included. Otherwise a
 * preview for `ctx.holder` with no serial; the card says the pattern is set
 * when the stamp is added (review V12).
 */
export function renderTraitStamp(ctx) {
  const draw = ctx.preview || stampPreview;
  const m = ctx.minted;
  if (m && isTokenId(m.tokenId) && typeof m.holder === "string") return stampMarkup(stampArt(draw, ctx.app, ctx.trait, m.holder, m.tokenId));
  return stampMarkup(previewArt(draw, ctx.app, ctx.trait, ctx.holder || PREVIEW_HOLDER));
}

const CHECK = html`<svg class="trait__tick" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 12.5l4.5 4.5L19 7"/></svg>`;

/**
 * Where the trait card's stamp went, as the mint goes (review V1). `a.phase`:
 *   saved       kept in this browser (no wallet, stamps not on chain, or the
 *               chain couldn't be read: nothing mint-related is offered)
 *   draft       a draft lesson: nothing is kept
 *   closed      saved here; adding to wallets is paused for this trait (on chain)
 *   mint        the trait is open and the account doesn't hold it: the button
 *   busy        the wallet is working (or a re-check runs); `a.step` is
 *               check | network | account | confirm
 *   confirming  sent; waiting for the receipt; `a.explorerUrl` links it
 *   slow        sent, no receipt yet after the wait: still confirming, the link
 *   minted      a success receipt: the real stamp; `a.share` (an address) offers
 *               to share the public passport, the address shown first (V9)
 *   held        the chain says this account already has it
 *   reverted    mined and failed: nothing added, the link, "Check again"
 *   dropped     never mined: nothing added, the link, "Check again"
 *   error       `a.code`: rejected | wrong-chain | offline | no-account | unsent
 *               (nothing was sent: "Try again") | failed (the wallet may have
 *               sent it: check the wallet, no resend)
 */
export const RETRYABLE = new Set(["rejected", "wrong-chain", "offline", "no-account", "unsent"]);
const txLink = (a) => extLink(a.explorerUrl, COPY.mintView, { cls: "mono trait__link", aria: COPY.mintViewA11y });
const saved = () => html`<a class="sticker trait__saved" href="#/passport">${CHECK}${COPY.stampSaved}</a>`;
const shortAddr = (a) => (typeof a === "string" && a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : String(a ?? ""));
export function renderStampAct(a = { phase: "saved" }) {
  switch (a.phase) {
    case "draft":
      return html`<p class="trait__note">${COPY.stampDraft}</p>`;
    case "closed":
      return html`${saved()}<p class="mono trait__note">${COPY.mintClosed}</p>`;
    case "mint":
      return html`<button class="btn trait__mint" type="button" data-mint>${COPY.mintStamp}</button><p class="mono trait__note">${COPY.mintNote} ${COPY.mintPreview}</p>`;
    case "busy":
      return html`<button class="btn trait__mint" type="button" disabled aria-disabled="true">${COPY.mintStamp}</button><p class="mono trait__status" role="status">${COPY.mintPhase[a.step] || COPY.mintPhase.network}</p>`;
    case "confirming":
      return html`<p class="mono trait__status trait__status--wait" role="status">${COPY.mintConfirming}</p>${txLink(a)}`;
    case "slow":
      return html`<p class="trait__note" role="status">${COPY.mintSlow}</p>${txLink(a)}`;
    case "minted":
      return html`<p class="sticker trait__saved" role="status">${CHECK}${COPY.mintDone}</p>${txLink(a)}${
        a.share ? html`<button class="btn trait__share" type="button" data-share-mine>${COPY.shareMine}</button><p class="mono trait__note">${COPY.shareMineNote(shortAddr(a.share))}</p>` : empty
      }`;
    case "held":
      return html`<p class="sticker trait__saved" role="status">${CHECK}${COPY.mintHeld}</p>`;
    case "reverted":
    case "dropped":
      return html`<p class="trait__error" role="alert">${a.phase === "reverted" ? COPY.mintReverted : COPY.mintDropped}</p>${txLink(a)}<button class="btn trait__mint" type="button" data-recheck>${COPY.checkAgain}</button>`;
    case "error": {
      const code = COPY.mintError[a.code] ? a.code : "failed";
      return html`<p class="trait__error" role="alert">${COPY.mintError[code]}</p>${RETRYABLE.has(code) ? html`<button class="btn trait__mint" type="button" data-mint>${COPY.tryAgain}</button>` : empty}`;
    }
    default:
      return saved();
  }
}

/** One card's markup. Unknown types render nothing (deckCards already drops them). */
export function renderCard(c, i, ctx) {
  const r = RENDER[c.type];
  return r ? r(c, i, ctx) : empty;
}

/** The whole lesson view: chrome, the stack of cards, desktop arrows. Focus moves to each new card, which names itself; there is no second announcement (review U11). */
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
</main>`;
}
