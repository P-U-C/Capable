// W5 — views. Every function returns SafeHtml built with the escaping `html`
// tag. No DOM access and no clock here: `ctx.now` is passed in by the UI layer.

import { html, join, empty, safeUrl } from "./html.mjs";
import { inline, paras, plain } from "./inline.mjs";
import { ideaHash } from "./router.mjs";
import {
  ideaStrands, ideaConnections, incoming, prizeOf, neighbours, pathOrder, isUnplaced, voicesFor, prizeStatus,
  countdown, fmtDate, bookYear, person, duration, glossary, words, readingMinutes, KIND_LABEL, KIND_INCOMING,
  PLACE_LABEL, EDITORS, PUBLISHED,
} from "./model.mjs";
import { renderFigure, facets, figureStats, statsLine } from "./figure.mjs";
import { renderMap, UNPLACED } from "./map.mjs";
import { DEPTHS, DEPTH_LABEL, readSet } from "./progress.mjs";

export const UNOFFICIAL = "Unofficial · reads public Farcaster data";
const STATUS_LABEL = { open: "Open", judging: "Judging", closed: "Closed", awarded: "Awarded", draft: "Draft" };
const EXT = html`<span aria-hidden="true">&#8599;</span><span class="sr-only"> (opens in a new tab)</span>`;

/* ---------- small parts ---------- */

/** Inline-render context: chips show the cited voice's monogram. */
export function inlineCtx(ctx) {
  const { m } = ctx;
  return {
    chip(hash) {
      const s = m.subByHash.get(hash);
      if (!s) return html`<span class="chip chip--missing" title="This voice is not in this edition">·</span>`;
      const p = person(m, s.fid);
      return html`<button type="button" class="chip" data-act="cite" data-sub="${hash}" aria-haspopup="dialog" aria-label="${`Voice: ${p.label}`}">${p.monogram}</button>`;
    },
  };
}

function ext(url, label, cls = "") {
  const u = safeUrl(url);
  if (!u) return empty;
  return html`<a class="${cls}" href="${u}" rel="noopener noreferrer" target="_blank">${label} ${EXT}</a>`;
}

export function pill(status, extra = "") {
  if (!status || !STATUS_LABEL[status]) return empty;
  return html`<span class="${`pill pill--${status}${extra ? " " + extra : ""}`}">${STATUS_LABEL[status]}</span>`;
}

function prizeStatusBits(ctx, prize) {
  const status = prizeStatus(prize, ctx.now);
  if (!status) return empty;
  if (status === "open") {
    const left = countdown(prize.deadline, ctx.now);
    return html`${pill("open")} <span class="countdown mono" data-deadline="${prize.deadline || ""}">${left || "deadline passed"}</span>`;
  }
  return pill(status);
}

const strandNames = (m, ch) => ideaStrands(m, ch).map((id) => m.strandById.get(id).name);

function numeral(n) {
  return String(n);
}

/* ---------- voice card ---------- */

export function voiceCard(ctx, s, opts = {}) {
  const { m } = ctx;
  const p = person(m, s.fid);
  const year = bookYear(m);
  const metaBits = [fmtDate(s.postedAt, { year }), s.kind === "video" ? duration(s.seconds) : "", s.ai ? "AI-assisted" : ""].filter(Boolean);
  const place = s.place ? html`<span class="place">${PLACE_LABEL[s.place]}</span>` : empty;
  let actions;
  if (s.kind === "site") {
    actions = html`${ext(s.site, "Site")}${ext(s.repo, "Repo")}${ext(s.voucher, "Vouch")}${ext(s.url, "Cast")}`;
  } else if (s.kind === "video") {
    const src = (s.embeds || []).find((u) => /\.m3u8(\?|$)/i.test(u)) || (s.embeds || []).find((u) => /\.mp4(\?|$)/i.test(u));
    const play = ctx.media === "inline" && safeUrl(src)
      ? html`<button type="button" class="play" data-act="play" data-src="${src}" data-hash="${s.hash}" aria-label="${`Play the video by ${p.label} here`}">Play here</button>`
      : empty;
    actions = html`${play}${ext(s.url, "Watch on Farcaster")}`;
  } else {
    const link = (s.embeds || []).map(safeUrl).find(Boolean);
    actions = html`${link ? ext(link, "Open link") : empty}${ext(s.url, "Cast")}`;
  }
  const title = s.kind === "site" && s.name ? html`<span class="vname">${s.name}</span>` : empty;
  return html`<article class="voice" data-kind="${s.kind}"${s.place ? html` data-win="1"` : empty} id="${opts.idPrefix ? `${opts.idPrefix}${s.hash}` : `v-${s.hash}`}">
<span class="disc mono" aria-hidden="true">${p.monogram}</span>
<div class="vbody">
<p class="who"><span class="handle">${p.label}</span>${title}</p>
<p class="gloss"><span class="sr-only">Our summary: </span>${inline(s.gloss, { chips: false })}</p>
<p class="vmeta mono">${metaBits.join(" · ")}${s.place ? html`${metaBits.length ? " · " : ""}${place}` : empty}</p>
<p class="vact">${actions}</p>
<div class="player-slot" data-slot="${s.hash}"></div>
</div>
</article>`;
}

/* ---------- shell ---------- */

export function footer(ctx) {
  const { m } = ctx;
  const refreshed = fmtDate(m.book.provenance && m.book.provenance.refreshedAt, { time: true });
  const extra = ctx.newCount > 0 ? ` · ${ctx.newCount} new since snapshot` : "";
  return html`<footer class="foot" role="contentinfo">
<p class="foot-line mono" data-foot>${UNOFFICIAL}${refreshed ? ` · refreshed ${refreshed}` : ""}${extra}</p>
<nav class="foot-nav" aria-label="More"><a href="#cover">Cover</a><a href="#glossary">Glossary</a><a href="#credits">Credits</a><a href="#about">About</a></nav>
</footer>`;
}

function topbar(ctx, runhead) {
  return html`<header class="top" role="banner">
<a class="brand" href="#cover" aria-label="Primer, the cover">Primer</a>
<span class="runhead mono">${runhead}</span>
<nav class="top-nav" aria-label="Pages"><a href="#glossary"${ctx.route.view === "glossary" ? html` aria-current="page"` : empty}>Glossary</a><a href="#about"${ctx.route.view === "about" ? html` aria-current="page"` : empty}>About</a></nav>
</header>`;
}

function depthMeta(ctx, ch) {
  const essayWords = (ch.essay || []).reduce((n, b) => n + (b.type === "h" ? 0 : words(b.text)), 0) + (ch.objections || []).reduce((n, o) => n + words(o.claim) + words(o.reply), 0);
  const voices = (ctx.m.subsByChapter.get(ch.id) || []).length;
  const refs = (prizeOf(ctx.m, ch) || {}).references;
  return {
    line: "5 sec",
    minute: `${readingMinutes(words(ch.minute))} min`,
    essay: `${readingMinutes(essayWords)} min`,
    source: ch.source ? `${readingMinutes(words(ch.source.about))} min` : Array.isArray(refs) && refs.length && ch.status === "draft" ? `${refs.length} ${refs.length === 1 ? "link" : "links"}` : "—",
    voices: String(voices),
  };
}

function depthBar(ctx, ch) {
  const meta = depthMeta(ctx, ch);
  const cur = ctx.depth;
  return html`<nav class="depth" aria-label="Reading depth">
<ol class="depth-list">${DEPTHS.map(
    (d, i) => html`<li><button type="button" class="depth-btn" data-act="depth" data-depth="${i + 1}" aria-pressed="${cur === i + 1 ? "true" : "false"}"${cur === i + 1 ? html` aria-current="true"` : empty}><span class="depth-key mono" aria-hidden="true">${i + 1}</span><span class="depth-name">${DEPTH_LABEL[d]}</span><span class="depth-meta mono">${meta[d]}${d === "voices" ? html`<span class="sr-only"> voices</span>` : empty}</span></button></li>`,
  )}</ol>
<p class="keys mono"><span>1–5 set the depth</span><span>← → move along the path</span></p>
</nav>`;
}

export function tocNav(ctx, ch) {
  const { m } = ctx;
  const nb = neighbours(m, ctx.path, ch.id);
  const order = pathOrder(m, nb.path);
  const reads = readSet(ctx.state);
  return html`<nav class="toc" aria-label="Ideas on this path">
<p class="toc-h mono">${nb.path === PUBLISHED ? "As published" : "The editor's path"}</p>
<ol>${order.map((id) => {
    const c = m.byId.get(id);
    const here = id === ch.id;
    return html`<li><a href="${ideaHash(id)}"${here ? html` aria-current="page"` : empty}><span class="toc-num">${numeral(c.number)}</span><span class="toc-title">${c.title}</span>${reads.has(id) ? html`<span class="tick" aria-label="read">✓</span>` : empty}</a></li>`;
  })}</ol>
</nav>`;
}

/** The whole page for a route. */
export function renderPage(ctx) {
  const { m, route } = ctx;
  let main;
  let runhead = "";
  let rail = empty;
  if (route.view === "idea" && m.byId.has(route.id)) {
    const ch = m.byId.get(route.id);
    main = ideaView(ctx, ch);
    runhead = ch.kicker;
    rail = html`<aside class="rail" aria-label="Reading controls">${depthBar(ctx, ch)}${tocNav(ctx, ch)}</aside>`;
  } else if (route.view === "glossary") {
    main = glossaryView(ctx);
    runhead = "Glossary";
  } else if (route.view === "credits") {
    main = creditsView(ctx);
    runhead = "Credits";
  } else if (route.view === "about") {
    main = aboutView(ctx);
    runhead = "About";
  } else {
    main = coverView(ctx);
    runhead = "An atlas of ideas";
  }
  const view = route.view === "idea" && m.byId.has(route.id) ? "idea" : route.view === "idea" ? "cover" : route.view;
  return html`<div class="shell" data-view="${view}">
<button type="button" class="skip" data-act="skip">Skip to the text</button>
${topbar(ctx, runhead)}
<div class="frame">${rail}<main id="main" class="main" tabindex="-1">${main}</main></div>
${footer(ctx)}
</div>`;
}

/* ---------- cover ---------- */

function indexRow(ctx, ch, reads) {
  const { m } = ctx;
  const prize = prizeOf(m, ch);
  const names = strandNames(m, ch);
  const voices = (m.subsByChapter.get(ch.id) || []).length;
  const status = join(
    [ch.status === "draft" ? pill("draft") : empty, prize ? prizeStatusBits(ctx, prize) : empty].filter((x) => String(x)),
    " ",
  );
  const read = reads.has(ch.id);
  return html`<li class="row${read ? " is-read" : ""}" data-strands="${ideaStrands(m, ch).join(" ")}">
<span class="row-num" aria-hidden="true">${numeral(ch.number)}</span>
<div class="row-body">
<a class="row-title" href="${ideaHash(ch.id)}"><span class="sr-only">${`Idea ${ch.number}: `}</span>${ch.title}</a>
<p class="row-line">${inline(ch.line, { links: false, chips: false })}</p>
<p class="row-meta mono">${names.length ? html`<span class="row-strands">${names.join(" · ")}</span>` : empty}${String(status) ? html`<span class="row-status">${status}</span>` : empty}${voices ? html`<span>${`${voices} ${voices === 1 ? "voice" : "voices"}`}</span>` : empty}</p>
</div>
<span class="row-read" aria-label="${read ? "Read" : "Not read yet"}">${read ? "✓" : ""}</span>
</li>`;
}

function indexGroups(ctx) {
  const { m } = ctx;
  const reads = readSet(ctx.state);
  const filter = ctx.filter || null;
  const unplaced = m.chapters.filter((c) => isUnplaced(m, c));
  const placed = (ids) => ids.map((id) => m.byId.get(id)).filter((c) => c && !isUnplaced(m, c));
  const keep = (c) => !filter || (filter !== UNPLACED && ideaStrands(m, c).includes(filter));
  const groups = [];
  if (ctx.path === PUBLISHED) {
    groups.push({ key: "all", title: null, items: placed(m.published).filter(keep) });
  } else {
    const onPath = new Set(m.editorsPath);
    groups.push({ key: "path", title: null, items: placed(m.editorsPath).filter(keep) });
    groups.push({ key: "off", title: "Not on the editor's path yet", items: placed(m.published.filter((id) => !onPath.has(id))).filter(keep) });
  }
  if (!filter || filter === UNPLACED) groups.push({ key: "unplaced", title: "Just in · unplaced", items: unplaced });
  const shown = groups.filter((g) => g.items.length);
  if (!shown.length) return html`<p class="empty">No ideas on this strand yet. New picks land here as they are placed.</p>`;
  return join(
    shown.map(
      (g) => html`<div class="${`group group--${g.key}`}">${g.title ? html`<h3 class="group-h mono">${g.title}</h3>` : empty}<ol class="rows">${g.items.map((c) => indexRow(ctx, c, reads))}</ol></div>`,
    ),
  );
}

export function indexBlock(ctx) {
  const { m } = ctx;
  const editors = m.editorsPathInfo;
  const pathLine = ctx.path === PUBLISHED ? "Every idea in the order its prize was posted." : editors ? plain(editors.line) : "";
  const filter = ctx.filter || "";
  const chip = (id, name) =>
    html`<button type="button" class="chip-btn" data-act="filter" data-strand="${id}" aria-pressed="${filter === id ? "true" : "false"}">${name}</button>`;
  const hasUnplaced = m.chapters.some((c) => isUnplaced(m, c));
  return html`<section class="index" id="index" aria-labelledby="idx-h" data-index>
<h2 id="idx-h" class="sec-title">Index of ideas</h2>
<div class="pathswitch" role="group" aria-label="Reading order">
<button type="button" class="seg" data-act="path" data-path="${EDITORS}" aria-pressed="${ctx.path !== PUBLISHED ? "true" : "false"}">The editor's path</button>
<button type="button" class="seg" data-act="path" data-path="${PUBLISHED}" aria-pressed="${ctx.path === PUBLISHED ? "true" : "false"}">As published</button>
</div>
<p class="path-line">${pathLine}</p>
<div class="chips" role="group" aria-label="Filter by strand">${chip("", "All strands")}${m.strands.map((s) => chip(s.id, s.name))}${hasUnplaced ? chip(UNPLACED, "Unplaced") : empty}</div>
<div class="index-list" aria-live="polite">${indexGroups(ctx)}</div>
</section>`;
}

function facetList(ctx) {
  const fs = facets(ctx.m, ctx.state.reads);
  return html`<ul class="facets">${fs.map(
    (f) => html`<li class="${`facet-row facet-row--${f.state}`}"><span class="facet-name">${f.strand.facet.name}</span><span class="facet-strand">${f.strand.name}</span><span class="facet-count mono">${`${f.read} of ${f.total}`}</span></li>`,
  )}</ul>`;
}

export function coverView(ctx) {
  const { m } = ctx;
  const b = m.book;
  const first = m.editorsPath[0] || m.published[0];
  const last = ctx.state.last && m.byId.has(ctx.state.last) ? m.byId.get(ctx.state.last) : null;
  const hasProgress = ctx.state.reads.length > 0 || !!last;
  const st = figureStats(m, ctx.state.reads);
  const archetype = b.archetype || { name: "The Founder-Citizen", line: "" };
  return html`<div class="cover">
<header class="cover-head">
<h1 class="cover-title">${b.title || "Primer"}</h1>
<p class="cover-sub">${b.subtitle}</p>
</header>
<section class="note" aria-labelledby="note-h">
<h2 id="note-h" class="note-h mono">${`Editor's note · as of ${fmtDate(b.thesis.asOf)}`}</h2>
<p class="note-line">${inline(b.thesis.line, inlineCtx(ctx))}</p>
<details class="note-more"><summary><span>Read the whole note</span></summary><div class="note-para">${paras(b.thesis.paragraph, inlineCtx(ctx))}</div></details>
</section>
<section class="figure-block" aria-labelledby="fig-h">
<div class="fig-wrap">${renderFigure(m, ctx.state.reads, { idPrefix: "fig-cover", className: "fig--cover" })}</div>
<div class="fig-text">
<h2 id="fig-h" class="fig-name">${archetype.name}</h2>
<p class="fig-line">${inline(archetype.line, inlineCtx(ctx))}</p>
<p class="fig-stats mono" data-stats>${statsLine(st)}</p>
${facetList(ctx)}
<div class="actions">${first ? html`<a class="btn btn--primary" href="${ideaHash(first)}">Begin</a>` : empty}${hasProgress && last ? html`<a class="btn" href="${ideaHash(last.id)}">Continue<span class="btn-sub">${last.title}</span></a>` : empty}</div>
</div>
</section>
<section class="map-block" aria-labelledby="map-h">
<h2 id="map-h" class="sec-title">The map</h2>
<p class="sec-lede">Each strand is a band, read left to right in the order the prizes were posted. Choose an idea to open it, or a strand to filter the index.</p>
${renderMap(m, ctx.state.reads, { filter: ctx.filter, width: ctx.mapWidth })}
<ul class="legend mono" aria-label="Map key">
<li><svg viewBox="0 0 28 10" aria-hidden="true"><circle cx="5" cy="5" r="3.5" class="lg-dot"/></svg>Idea</li>
<li><svg viewBox="0 0 28 10" aria-hidden="true"><circle cx="5" cy="5" r="3.75" class="lg-draft"/></svg>Draft</li>
<li><svg viewBox="0 0 28 10" aria-hidden="true"><path d="M1 5h26" class="lg-line"/></svg>Connection</li>
<li><svg viewBox="0 0 28 10" aria-hidden="true"><path d="M1 5h26" class="lg-line lg-line--tension"/></svg>In tension</li>
<li><svg viewBox="0 0 28 10" aria-hidden="true"><path d="M3 5l2.5 2.5l5 -6" class="lg-check"/></svg>Read</li>
</ul>
</section>
${indexBlock(ctx)}
</div>`;
}

/* ---------- idea ---------- */

function essayBlocks(ctx, ch) {
  const ictx = inlineCtx(ctx);
  const out = [];
  const blocks = Array.isArray(ch.essay) ? ch.essay : [];
  const render = (b) => {
    if (b.type === "h") return html`<h3 class="essay-h">${b.text}</h3>`;
    if (b.type === "quote") return html`<blockquote class="quote"><p>${inline(b.text, ictx)}</p><footer class="quote-cite">${b.cite}</footer></blockquote>`;
    if (b.type === "aside") return html`<aside class="note-side"><span class="pilcrow" aria-hidden="true">¶</span>${inline(b.text, ictx)}</aside>`;
    return paras(b.text, ictx);
  };
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const nextAside = blocks[i + 1] && blocks[i + 1].type === "aside" && b.type !== "aside" ? blocks[i + 1] : null;
    if (nextAside) {
      out.push(html`<div class="with-note">${render(b)}${render(nextAside)}</div>`);
      i++;
    } else out.push(render(b));
  }
  return join(out);
}

function objections(ctx, ch) {
  const list = Array.isArray(ch.objections) ? ch.objections : [];
  if (!list.length) return empty;
  const ictx = inlineCtx(ctx);
  return html`<section class="objections" aria-labelledby="h-obj"><h3 id="h-obj" class="essay-h">${list.length === 1 ? "The strongest objection" : "The strongest objections"}</h3>${list.map(
    (o) => html`<div class="objection"><div class="claim">${paras(o.claim, ictx)}</div><p class="reply-h mono">The reply</p><div class="reply">${paras(o.reply, ictx)}</div></div>`,
  )}</section>`;
}

function deeper(ctx, ch, at) {
  if (at >= 5) return empty;
  const meta = depthMeta(ctx, ch);
  const next = DEPTHS[at];
  const what = { minute: "the minute", essay: "the essay", source: "the source", voices: "the voices" }[next];
  return html`<p class="deeper" data-at="${at}"><button type="button" class="deeper-btn" data-act="depth" data-depth="${at + 1}">Go deeper: ${what}<span class="mono">${next === "voices" ? `${meta.voices} voices` : meta[next]}</span></button></p>`;
}

function sourceSection(ctx, ch) {
  const ictx = inlineCtx(ctx);
  const s = ch.source;
  if (s) {
    return html`<p class="src-title"><cite>${s.title}</cite></p>
<p class="src-by mono">${`${s.author} · ${s.year}`}</p>
<div class="src-about">${paras(s.about, ictx)}</div>
${s.read && safeUrl(s.read) ? html`<p class="src-read">${ext(s.read, "Read it free", "action")}</p>` : empty}`;
  }
  const prize = prizeOf(ctx.m, ch);
  const refs = prize && Array.isArray(prize.references) ? prize.references : [];
  if (ch.status === "draft" && refs.length) {
    return html`<p class="muted">An editor hasn't chosen the source yet. The prize post pointed to:</p><ul class="refs">${refs.map((r) => {
      const u = safeUrl(r);
      if (u) {
        let host = u;
        try {
          host = new URL(u).hostname.replace(/^www\./, "");
        } catch {
          /* keep the url */
        }
        return html`<li>${ext(u, host)}</li>`;
      }
      return html`<li>${r}</li>`;
    })}</ul>`;
  }
  if (ch.kind !== "chapter") return html`<p class="muted">This part of the atlas has no single source. Each idea names its own.</p>`;
  return html`<p class="muted">An editor hasn't chosen the source for this idea yet.</p>`;
}

function voicesSection(ctx, ch) {
  const list = voicesFor(ctx.m, ch.id);
  if (!list.length) {
    return html`<p class="muted">${ch.kind === "chapter" ? "No voices yet. Replies to the prize post appear here as they arrive." : "Voices gather on the ideas themselves."}</p>`;
  }
  const f = ctx.voiceFilter || "all";
  const counts = { all: list.length, winners: list.filter((s) => s.place).length, video: list.filter((s) => s.kind === "video").length, site: list.filter((s) => s.kind === "site").length };
  const opts = [["all", "All"], ["winners", "Winners"], ["video", "Videos"], ["site", "Builds"]].filter(([k]) => k === "all" || counts[k] > 0);
  return html`<p class="sec-lede">Every entry to the prize, winners first, then newest. The one-line summaries are ours; the work is theirs.</p>
${opts.length > 2 || (opts.length === 2 && counts[opts[1][0]] !== counts.all)
    ? html`<div class="vfilter" role="group" aria-label="Filter voices">${opts.map(
        ([k, label]) => html`<button type="button" class="chip-btn" data-act="vfilter" data-f="${k}" aria-pressed="${f === k ? "true" : "false"}">${label} <span class="mono">${counts[k]}</span></button>`,
      )}</div>`
    : empty}
<div class="voices" data-f="${f}">${list.map((s) => voiceCard(ctx, s))}</div>`;
}

function featured(ctx, ch) {
  const { m } = ctx;
  let list = (Array.isArray(ch.featured) ? ch.featured : []).map((h) => m.subByHash.get(h)).filter(Boolean);
  if (!list.length) list = voicesFor(m, ch.id).slice(0, 2);
  if (!list.length) return empty;
  return html`<div class="featured" aria-label="Featured voices"><p class="featured-h mono">${list.length === 1 ? "Featured voice" : "Featured voices"}</p>${list.map((s) => voiceCard(ctx, s, { idPrefix: "f-" }))}</div>`;
}

function termsPiece(ctx, ch) {
  const list = Array.isArray(ch.terms) ? ch.terms : [];
  return html`<section class="end-sec" aria-labelledby="h-terms"><h2 id="h-terms" class="end-h">Terms</h2>${list.length
    ? html`<dl class="terms">${list.map((t) => html`<div class="term"><dt>${t.term}</dt><dd>${inline(t.def, inlineCtx(ctx))}</dd></div>`)}</dl>`
    : html`<p class="muted">${ch.status === "draft" ? "Terms arrive with the editor's write-up." : "No new terms here."} <a href="#glossary">The glossary</a> holds every term so far.</p>`}</section>`;
}

function connectionsPiece(ctx, ch) {
  const { m } = ctx;
  const out = ideaConnections(m, ch);
  const inc = incoming(m, ch.id).filter((x) => !out.some((o) => o.to === x.from));
  const item = (id, kindLabel, why) => {
    const t = m.byId.get(id);
    return html`<li class="link"><p class="link-head"><span class="kind mono">${kindLabel}</span> <a href="${ideaHash(id)}">${t.title}</a></p><p class="why">${inline(why, inlineCtx(ctx))}</p></li>`;
  };
  return html`<section class="end-sec" aria-labelledby="h-conn"><h2 id="h-conn" class="end-h">Connections</h2>
<div class="thread">${paras(ch.thread, inlineCtx(ctx))}</div>
${out.length ? html`<ul class="links">${out.map((x) => item(x.to, KIND_LABEL[x.kind], x.why))}</ul>` : ch.status === "draft" ? html`<p class="muted">An editor will connect this pick to the rest of the atlas.</p>` : empty}
${inc.length ? html`<p class="links-h mono">Linked from elsewhere</p><ul class="links links--in">${inc.map((x) => item(x.from, KIND_INCOMING[x.kind], x.why))}</ul>` : empty}
</section>`;
}

export function youNowSection(ctx, ch) {
  const { m } = ctx;
  const sids = ideaStrands(m, ch);
  const reads = readSet(ctx.state);
  const isRead = reads.has(ch.id);
  const fs = facets(m, ctx.state.reads).filter((f) => sids.includes(f.strand.id));
  const body = fs.length
    ? fs.map(
        (f) => html`<div class="you-facet"><p class="you-name">${f.strand.facet.name}</p><p class="you-grant">${inline(f.strand.facet.grant, inlineCtx(ctx))}</p><p class="you-count mono" data-progress="${f.strand.id}">${`${f.read} of ${f.total} ${f.total === 1 ? "idea" : "ideas"} in ${f.strand.name}`}</p></div>`,
      )
    : html`<div class="you-facet"><p class="you-name">${m.book.archetype ? m.book.archetype.name : "The Founder-Citizen"}</p><p class="you-grant">${inline(m.book.archetype ? m.book.archetype.line : "", inlineCtx(ctx))}</p><p class="you-count mono">${statsLine(figureStats(m, ctx.state.reads))}</p></div>`;
  return html`<section class="end-sec you-now" aria-labelledby="h-you"><h2 id="h-you" class="end-h">You, now</h2>
<div class="you-grid"><div class="you-fig">${renderFigure(m, ctx.state.reads, { idPrefix: `fig-you-${ch.id}`, highlight: sids, className: "fig--small" })}</div><div class="you-text">${body}</div></div>
<p class="you-act">${isRead ? html`<span class="you-done mono">✓ Read</span>` : empty}<button type="button" class="btn btn--small" data-act="${isRead ? "unread" : "read"}" data-id="${ch.id}" data-key="read-toggle">${isRead ? "Mark as unread" : "Mark as read"}</button></p>
</section>`;
}

function resultsList(ctx, prize) {
  const places = prize.results && Array.isArray(prize.results.places) ? prize.results.places : [];
  if (!places.length) return empty;
  return html`<ol class="results">${places.map((p) => {
    const s = ctx.m.subByHash.get(p.submission);
    const who = s ? person(ctx.m, s.fid).label : "";
    const label = p.label && p.label !== who ? p.label : "";
    return html`<li><span class="place mono">${PLACE_LABEL[p.place] || p.place}</span><span class="amt mono">${p.amount || ""}</span><span class="res-who">${label ? html`${label} ` : empty}${s ? html`<button type="button" class="linkish" data-act="cite" data-sub="${p.submission}" aria-haspopup="dialog">${who}</button>` : empty}</span></li>`;
  })}</ol>`;
}

function yourTurnPiece(ctx, ch) {
  const prize = prizeOf(ctx.m, ch);
  const ictx = inlineCtx(ctx);
  const practice = ch.practice || null;
  const actionUrl = (practice && practice.action && safeUrl(practice.action.url)) || (prize && prize.castHash ? `https://farcaster.xyz/~/conversations/${prize.castHash}` : null);
  const status = prize ? prizeStatus(prize, ctx.now) : null;
  const card = prize
    ? html`<div class="prize">
<p class="prize-head mono">${prize.headline}</p>
<dl class="prize-facts">
${prize.pool ? html`<div><dt class="mono">Pool</dt><dd>${prize.pool}</dd></div>` : empty}
${prize.deliverable ? html`<div><dt class="mono">Make</dt><dd>${inline(prize.deliverable, ictx)}</dd></div>` : empty}
<div><dt class="mono">Status</dt><dd class="prize-status">${prizeStatusBits(ctx, prize)}${prize.deadline ? html` <span class="mono deadline">${`${status === "open" ? "closes" : "closed"} ${fmtDate(prize.deadline, { time: true, year: bookYear(ctx.m) })}`}</span>` : empty}</dd></div>
</dl>
${status === "awarded" ? html`<p class="results-h mono">Results</p>${resultsList(ctx, prize)}` : empty}
</div>`
    : empty;
  const still = status && status !== "open" ? html`<p class="muted">The prize has closed. The prompt still stands as practice.</p>` : empty;
  return html`<section class="end-sec your-turn" aria-labelledby="h-turn"><h2 id="h-turn" class="end-h">Your turn</h2>
${practice ? html`<div class="practice">${paras(practice.prompt, ictx)}</div>` : empty}
${still}
${card}
${actionUrl ? html`<p class="turn-act">${ext(actionUrl, "Reply on Farcaster", "action")}</p>` : empty}
</section>`;
}

function pager(ctx, ch) {
  const nb = neighbours(ctx.m, ctx.path, ch.id);
  const pathName = nb.path === PUBLISHED ? "As published" : "The editor's path";
  const side = (c, rel) =>
    c
      ? html`<a class="${`pager-${rel}`}" href="${ideaHash(c.id)}" rel="${rel}"><span class="pager-dir mono">${rel === "prev" ? "Previous" : "Next"}</span><span class="pager-title"><span class="pager-num">${numeral(c.number)}</span> ${c.title}</span></a>`
      : html`<span class="${`pager-${rel} pager-none`}"></span>`;
  const off = ctx.path !== PUBLISHED && nb.path === PUBLISHED;
  return html`<nav class="pager" aria-label="${`Previous and next on ${pathName.toLowerCase()}`}">
<p class="pager-path mono">${off ? "Not on the editor's path yet · following as published" : `${pathName} · ${nb.position} of ${nb.length}`}</p>
<div class="pager-row">${side(nb.prev, "prev")}${side(nb.next, "next")}</div>
</nav>`;
}

export const DRAFT_BANNER = "Draft — this pick just dropped; an editor hasn't written it up yet. The voices below are live.";

export function ideaView(ctx, ch) {
  const { m } = ctx;
  const ictx = inlineCtx(ctx);
  const names = strandNames(m, ch);
  const depth = ctx.depth;
  return html`<article class="idea" data-depth="${depth}" data-id="${ch.id}" aria-labelledby="idea-title">
${ch.status === "draft" ? html`<div class="draft-banner" role="note"><p>${DRAFT_BANNER}</p></div>` : empty}
<header class="idea-head">
<p class="kicker mono">${ch.kicker}</p>
<p class="numeral" aria-hidden="true">${numeral(ch.number)}</p>
<h1 id="idea-title" class="idea-title"><span class="sr-only">${`Idea ${ch.number}: `}</span>${ch.title}</h1>
${names.length ? html`<p class="idea-strands mono">${names.join(" · ")}</p>` : isUnplaced(m, ch) ? html`<p class="idea-strands mono">Not yet placed on a strand</p>` : empty}
</header>
<section class="dsec" id="s-line" data-d="1" aria-label="The line"><p class="the-line">${inline(ch.line, ictx)}</p>${deeper(ctx, ch, 1)}</section>
<section class="dsec" id="s-minute" data-d="2" aria-labelledby="h-minute"><h2 id="h-minute" class="sec-h"><span class="sec-n mono" aria-hidden="true">2</span>The minute</h2><div class="prose">${paras(ch.minute, ictx)}</div>${featured(ctx, ch)}${deeper(ctx, ch, 2)}</section>
<section class="dsec" id="s-essay" data-d="3" aria-labelledby="h-essay"><h2 id="h-essay" class="sec-h"><span class="sec-n mono" aria-hidden="true">3</span>The essay</h2><div class="prose essay">${essayBlocks(ctx, ch)}${objections(ctx, ch)}</div>${deeper(ctx, ch, 3)}</section>
<section class="dsec" id="s-source" data-d="4" aria-labelledby="h-source"><h2 id="h-source" class="sec-h"><span class="sec-n mono" aria-hidden="true">4</span>The source</h2><div class="prose">${sourceSection(ctx, ch)}</div>${deeper(ctx, ch, 4)}</section>
<section class="dsec" id="s-voices" data-d="5" aria-labelledby="h-voices"><h2 id="h-voices" class="sec-h"><span class="sec-n mono" aria-hidden="true">5</span>The voices</h2>${voicesSection(ctx, ch)}</section>
<div class="endmatter" id="s-end" data-end="${ch.id}">
${termsPiece(ctx, ch)}
${connectionsPiece(ctx, ch)}
${youNowSection(ctx, ch)}
${yourTurnPiece(ctx, ch)}
</div>
${pager(ctx, ch)}
</article>`;
}

/* ---------- glossary, credits, about ---------- */

export function glossaryView(ctx) {
  const all = glossary(ctx.m);
  const byLetter = new Map();
  for (const t of all) {
    const ch = t.term.trim()[0] || "#";
    const L = /[a-z]/i.test(ch) ? ch.toUpperCase() : "#";
    if (!byLetter.has(L)) byLetter.set(L, []);
    byLetter.get(L).push(t);
  }
  const letters = [...byLetter.keys()];
  return html`<div class="page glossary">
<header class="page-head"><p class="kicker mono">Glossary</p><h1 class="page-title">Terms</h1><p class="page-lede">Every term the ideas introduce, from A to Z. Each one links back to where it first appears.</p></header>
${letters.length ? html`<nav class="az" aria-label="Jump to a letter">${letters.map((L) => html`<button type="button" class="az-btn" data-act="scrollto" data-target="${`g-${L}`}">${L}</button>`)}</nav>` : html`<p class="muted">No terms yet. They arrive with each idea's write-up.</p>`}
${letters.map(
    (L) => html`<section class="letter" aria-labelledby="${`g-${L}`}"><h2 id="${`g-${L}`}" class="letter-h">${L}</h2><dl class="terms">${byLetter.get(L).map(
      (t) => html`<div class="term"><dt>${t.term}</dt><dd>${inline(t.def, inlineCtx(ctx))} <a class="from" href="${ideaHash(t.id)}">${`from ${t.title}`}</a></dd></div>`,
    )}</dl></section>`,
  )}
</div>`;
}

export function creditsView(ctx) {
  const { m } = ctx;
  const everyone = new Set(m.subs.map((s) => s.fid));
  const n = everyone.size;
  const rank = { "1st": 0, "2nd": 1, hm: 2 };
  const groups = m.chapters
    .map((c) => {
      const best = new Map();
      for (const s of m.subsByChapter.get(c.id) || []) {
        const cur = best.get(s.fid);
        if (!cur || (s.place && (!cur.place || rank[s.place] < rank[cur.place]))) best.set(s.fid, s);
      }
      const people = [...best.values()].map((s) => ({ ...person(m, s.fid), place: s.place || null }));
      people.sort((a, b) => (a.place ? rank[a.place] : 9) - (b.place ? rank[b.place] : 9) || a.label.localeCompare(b.label, "en", { numeric: true }));
      return { c, people };
    })
    .filter((g) => g.people.length);
  return html`<div class="page credits">
<header class="page-head"><p class="kicker mono">Credits</p><h1 class="page-title">${`This atlas was written by ${n} ${n === 1 ? "person" : "people"}`}</h1><p class="page-lede">Everyone who answered a prize with work of their own, grouped by idea. Winners are marked.</p></header>
${groups.map(
    (g) => html`<section class="credit" aria-labelledby="${`c-${g.c.id}`}"><h2 id="${`c-${g.c.id}`}" class="credit-h"><span class="credit-num">${numeral(g.c.number)}</span> <a href="${ideaHash(g.c.id)}">${g.c.title}</a></h2><ul class="names">${g.people.map(
      (p) => html`<li>${p.label}${p.place ? html` <span class="place mono">${PLACE_LABEL[p.place]}</span>` : empty}</li>`,
    )}</ul></section>`,
  )}
</div>`;
}

export function aboutView(ctx) {
  const { m } = ctx;
  const p = m.book.provenance || {};
  const fids = Array.isArray(p.watchedFids) ? p.watchedFids : [];
  return html`<div class="page about">
<header class="page-head"><p class="kicker mono">About</p><h1 class="page-title">What this is</h1></header>
<div class="prose">
<p>Primer reads the prize threads posted on Farcaster and lays them out as an atlas of ideas. Each prize becomes one idea you can read at five depths: a line, a minute, an essay, the source, and every voice that answered. Ideas hang on a few broad strands and link to each other with typed, explained connections.</p>
<h2 class="about-h">Unofficial</h2>
<p>Primer is not made by, endorsed by or connected to Farcaster or Network School. It reads public protocol data and nothing else. The one-line summaries of each entry are ours; the work belongs to the people who made it.</p>
<h2 class="about-h">Where the data comes from</h2>
<dl class="prov">
<div><dt class="mono">Nodes read</dt><dd>${(Array.isArray(p.nodes) ? p.nodes : []).map((u) => html`<span class="mono url">${u}</span> `)}</dd></div>
<div><dt class="mono">Last refreshed</dt><dd>${fmtDate(p.refreshedAt, { time: true, year: 0 })}</dd></div>
<div><dt class="mono">Watched accounts</dt><dd>${join(fids.map((f) => html`<span>${person(m, f).username ? `${person(m, f).label} (fid ${f})` : `fid ${f}`}</span>`), ", ")}</dd></div>
<div><dt class="mono">Snapshot built</dt><dd>${fmtDate(m.book.generatedAt, { time: true, year: 0 })}</dd></div>
${ctx.overlay ? html`<div><dt class="mono">Live update</dt><dd>${`${ctx.overlay.added} new, ${ctx.overlay.replaced} updated since the snapshot${ctx.overlay.dropped ? `; ${ctx.overlay.dropped} left out because ${ctx.overlay.dropped === 1 ? "it" : "they"} failed the format checks` : ""}`}</dd></div>` : empty}
</dl>
${p.note ? paras(p.note, inlineCtx(ctx)) : empty}
<h2 class="about-h">How it stays current</h2>
<p>The page carries a snapshot of the whole atlas, so it opens anywhere, signed in or not. When it can, it also reads newer prizes and replies once, at load, and adds them on top; anything that fails the format checks is left out. A new prize appears as a draft idea with its voices live until an editor writes it up. A new reply appears as a new voice.</p>
<p>Your reading progress and depth stay in this browser only.</p>
<h2 class="about-h">License</h2>
<p>The code is MIT licensed. Entries and casts belong to their authors.</p>
</div>
</div>`;
}

/* ---------- popover ---------- */

export function popover(ctx, hash) {
  const s = ctx.m.subByHash.get(hash);
  if (!s) return empty;
  const c = ctx.m.byId.get(s.chapter);
  return html`<div class="pop-inner">${voiceCard(ctx, s, { idPrefix: "p-" })}${c ? html`<p class="pop-from mono">${`From ${c.title}`}</p>` : empty}<button type="button" class="pop-close" data-act="close-pop" aria-label="Close">Close</button></div>`;
}
