// The only way markup is built in the app. The `html` tag escapes every
// interpolated value unless it is a SafeHtml made by this module, so untrusted
// strings (everything in app.json) can never become markup or attributes.

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" };

/** Escape text for element content or a quoted attribute value. */
export function esc(value) {
  return String(value).replace(/[&<>"'`]/g, (c) => ESC[c]);
}

class SafeHtml {
  constructor(s) {
    this.s = s;
  }
  toString() {
    return this.s;
  }
}

// Not exported: only templates in this module can mint SafeHtml.
const trusted = (s) => new SafeHtml(s);

function part(v) {
  if (v instanceof SafeHtml) return v.s;
  if (Array.isArray(v)) return v.map(part).join("");
  if (v === null || v === undefined || v === false || v === true) return "";
  return esc(v);
}

/** html`<p>${text}</p>`: every interpolated value is escaped. */
export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += part(values[i]) + strings[i + 1];
  return trusted(out);
}

export const join = (list, sep = "") => trusted(list.map(part).join(part(sep)));
export const isSafe = (v) => v instanceof SafeHtml;
export const empty = trusted("");

const HTTPS = /^https:\/\/[^\s<>"'`\\{}]+$/;

/** An https URL or null. javascript:, data:, http:, relative and malformed URLs are refused. */
export function safeUrl(url) {
  if (typeof url !== "string" || url.length > 2048 || !HTTPS.test(url)) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname ? url : null;
  } catch {
    return null;
  }
}

/**
 * An external link. Returns empty when the URL is not https, so a bad URL
 * renders nothing rather than a dead or dangerous link.
 */
export function extLink(url, label, { cls = "", aria } = {}) {
  const href = safeUrl(url);
  if (!href) return empty;
  return html`<a class="${cls}" href="${href}" target="_blank" rel="noopener noreferrer"${aria ? html` aria-label="${aria}"` : empty}>${label}</a>`;
}

/**
 * Markup from the app's own SVG generators (art/, the stamp art, the QR
 * encoder) as SafeHtml, so it can be inlined. Those generators are pure and
 * escape any text they are given, but this still refuses anything that is not
 * one plain <svg> element: scripts, event handlers, foreign content, links,
 * external references, javascript:/data: URLs or <style>. `cls` replaces the
 * root's class (a safe token list). A refused piece renders nothing (fail
 * closed).
 */
export function svgMarkup(svg, cls = "") {
  let s = typeof svg === "string" ? svg.trim() : "";
  if (s.length > 64 * 1024 || !/^<svg[\s>]/.test(s) || !s.endsWith("</svg>")) return empty;
  if ((s.match(/<svg[\s>]/g) || []).length !== 1) return empty;
  if (/<(?:script|style|foreignObject|image|use|iframe|a|animate|animateTransform|animateMotion|set|feImage)\b/i.test(s)) return empty;
  if (/\son[a-z]+\s*=|\sstyle\s*=|(?:href|src)\s*=|javascript:|data:|https?:\/\/(?!www\.w3\.org\/2000\/svg")/i.test(s)) return empty;
  if (/url\((?!#[\w-]+\))/i.test(s)) return empty;
  if (cls) {
    if (!/^[a-z][a-z0-9_ -]*$/.test(cls)) return empty;
    const end = s.indexOf(">");
    const root = s.slice(0, end).replace(/\sclass="[^"]*"/, "");
    s = `<svg class="${cls}"${root.slice(4)}${s.slice(end)}`;
  }
  return trusted(s);
}

/** Fixed-precision number for SVG attributes. */
export function num(n) {
  const r = Math.round(n * 100) / 100;
  return Object.is(r, -0) ? "0" : String(r);
}

/**
 * *emphasis* → <em>. The only inline markup the contract allows. Unpaired
 * asterisks are kept as text. Everything is escaped.
 */
export function rich(text) {
  const s = String(text ?? "");
  const out = [];
  const re = /\*([^*\n]+)\*/g;
  let last = 0;
  let m;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    out.push(html`<em>${m[1]}</em>`);
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  return join(out);
}

/** Visible text of a string with *emphasis* markers removed (for labels). */
export const plain = (text) => String(text ?? "").replace(/\*([^*\n]+)\*/g, "$1");

/** Word count, as the contract's validator counts. */
export const words = (t) => (typeof t === "string" ? t.split(/\s+/).filter(Boolean).length : 0);
