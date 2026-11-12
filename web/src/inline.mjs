// W1 — the safe inline renderer.
// Contract `Inline`: plain text plus exactly three markups:
//   *emphasis*            → <em>
//   [label](https://…)    → <a rel="noopener noreferrer" target="_blank">
//   {{sub:0x<40 hex>}}    → a citation chip (a button that opens the voice card)
// Paragraphs are separated by a blank line ("\n\n").
//
// The text is tokenized first and every piece is escaped on output, so nothing
// in the input can become markup except through the three forms above. A form
// that does not match exactly (http:, javascript:, unclosed, upper-case hash,
// short hash) stays literal text. Markup does not nest: the inside of an
// emphasis or a link label is plain text.

import { html, join, empty, esc } from "./html.mjs";

const SUB = String.raw`\{\{sub:(0x[0-9a-f]{40})\}\}`;
const LINK = String.raw`\[([^\[\]\n]+)\]\((https:\/\/[^\s<>"'\`()\[\]\\]+)\)`;
const EM = String.raw`\*([^*\s](?:[^*\n]*[^*\s])?)\*`;
const TOKEN = new RegExp(`${SUB}|${LINK}|${EM}`, "g");

/** Split inline text into tokens. Pure; exported for tests. */
export function tokens(text) {
  const s = typeof text === "string" ? text : "";
  const out = [];
  let last = 0;
  for (const m of s.matchAll(TOKEN)) {
    if (m.index > last) out.push({ t: "text", v: s.slice(last, m.index) });
    if (m[1]) out.push({ t: "sub", hash: m[1] });
    else if (m[2] !== undefined) out.push({ t: "link", label: m[2], url: m[3] });
    else out.push({ t: "em", v: m[4] });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ t: "text", v: s.slice(last) });
  return out;
}

/** Default chip when the caller gives no resolver: an inert-looking but keyboard-reachable button. */
function defaultChip(hash) {
  return html`<button type="button" class="chip" data-sub="${hash}" aria-label="Open the cited voice">·</button>`;
}

/**
 * Render one run of inline text (no paragraphs) to SafeHtml.
 * ctx.chip(hash) → SafeHtml renders a citation chip (views supply one that
 * shows the voice's monogram); ctx.links === false renders link labels only.
 */
export function inline(text, ctx = {}) {
  const chip = ctx.chip || defaultChip;
  return join(
    tokens(text).map((tk) => {
      if (tk.t === "text") return html`${tk.v}`;
      if (tk.t === "em") return html`<em>${tk.v}</em>`;
      if (tk.t === "link") {
        if (ctx.links === false) return html`${tk.label}`;
        return html`<a href="${tk.url}" rel="noopener noreferrer" target="_blank">${tk.label}<span class="sr-only"> (opens in a new tab)</span></a>`;
      }
      if (ctx.chips === false) return empty;
      return chip(tk.hash);
    }),
  );
}

/** Split on blank lines into paragraphs. Single newlines are spaces. */
export function paragraphs(text) {
  return (typeof text === "string" ? text : "")
    .split(/\n[ \t]*\n+/)
    .map((p) => p.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean);
}

/** Render text with "\n\n" paragraphs as <p> elements. */
export function paras(text, ctx = {}, cls = "") {
  return join(paragraphs(text).map((p) => (cls ? html`<p class="${cls}">${inline(p, ctx)}</p>` : html`<p>${inline(p, ctx)}</p>`)));
}

/** Plain text with markup removed: emphasis → its text, links → label, chips → nothing. */
export function plain(text) {
  return tokens(text)
    .map((tk) => (tk.t === "text" || tk.t === "em" ? tk.v : tk.t === "link" ? tk.label : ""))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

export { esc };
