// The only way HTML is built in Primer: the `html` tag escapes every
// interpolated value unless it is already a SafeHtml made by this module.
// Nothing else in the app concatenates markup with untrusted strings.

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" };

/** Escape text for use in element content or a double-quoted attribute. */
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

/** Marks a string produced by this module's own templates as safe. Not exported on purpose. */
const trusted = (s) => new SafeHtml(s);

function part(v) {
  if (v instanceof SafeHtml) return v.s;
  if (Array.isArray(v)) return v.map(part).join("");
  if (v === null || v === undefined || v === false || v === true) return "";
  return esc(v);
}

/** Tagged template: html`<p>${text}</p>` — every value is escaped. */
export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += part(values[i]) + strings[i + 1];
  return trusted(out);
}

/** Join a list of SafeHtml with a SafeHtml separator. */
export function join(list, sep = "") {
  return trusted(list.map(part).join(part(sep)));
}

export const isSafe = (v) => v instanceof SafeHtml;

/** The empty fragment. */
export const empty = trusted("");

const HTTPS = /^https:\/\/[^\s<>"'`\\]+$/;

/** An https URL or null. Anything else (javascript:, http:, data:, relative) is refused. */
export function safeUrl(url) {
  return typeof url === "string" && HTTPS.test(url) ? url : null;
}

/** A fixed-precision number for SVG attributes (keeps output deterministic and short). */
export function num(n) {
  const r = Math.round(n * 100) / 100;
  return Object.is(r, -0) ? "0" : String(r);
}
