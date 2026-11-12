// W2 — hash router. Routes:
//   #cover (default) · #glossary · #credits · #about
//   #<ideaId> · #<ideaId>-essay · #<ideaId>-source · #<ideaId>-voices · #<ideaId>-end
// Only plain names (letters, digits, hyphens) are accepted. Anything else,
// including an idea id the book does not know, resolves to the cover.

export const PAGES = ["cover", "glossary", "credits", "about"];
export const SECTIONS = ["essay", "source", "voices", "end"];
const NAME = /^[A-Za-z0-9-]{1,80}$/;
const COVER = Object.freeze({ view: "cover" });

/**
 * Parse a location hash. `ideas` is a Set (or array) of known idea ids; when
 * given, an unknown id resolves to the cover.
 */
export function parse(hash, ideas) {
  const known = ideas instanceof Set ? ideas : ideas ? new Set(ideas) : null;
  let name = typeof hash === "string" ? hash : "";
  if (name.startsWith("#")) name = name.slice(1);
  if (!NAME.test(name)) return { ...COVER };
  const lower = name.toLowerCase();
  if (PAGES.includes(lower)) return { view: lower };
  const has = (id) => (known ? known.has(id) : /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id));
  for (const s of SECTIONS) {
    const suffix = `-${s}`;
    if (lower.endsWith(suffix)) {
      const id = lower.slice(0, -suffix.length);
      if (id && has(id)) return { view: "idea", id, section: s };
    }
  }
  if (has(lower)) return { view: "idea", id: lower, section: null };
  return { ...COVER };
}

/** Format a route as a hash ("#cover", "#exit", "#exit-voices"). */
export function format(route) {
  if (!route || typeof route !== "object") return "#cover";
  if (route.view === "idea" && typeof route.id === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(route.id)) {
    return SECTIONS.includes(route.section) ? `#${route.id}-${route.section}` : `#${route.id}`;
  }
  if (PAGES.includes(route.view)) return `#${route.view}`;
  return "#cover";
}

export const ideaHash = (id, section = null) => format({ view: "idea", id, section });
