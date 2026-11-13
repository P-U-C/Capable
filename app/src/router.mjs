// Hash routes. Pure: parse a hash into a view, and back.
//   #/            home
//   #/you         home, scrolled to the "you" panel
//   #/l/<id>      a lesson deck (opens at the remembered card)
//   #/passport    your passport (v3)
//   #/p/<0x…>     anyone's public passport, read from chain (v3); a bad address goes home

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export function parseRoute(hash) {
  const h = String(hash || "").replace(/^#/, "");
  const parts = h.split("/").filter(Boolean);
  if (parts[0] === "l" && ID.test(parts[1] || "")) return { view: "lesson", id: parts[1] };
  if (parts[0] === "you") return { view: "home", focus: "you" };
  if (parts[0] === "passport" && parts.length === 1) return { view: "passport" };
  if (parts[0] === "p" && parts.length === 2 && ADDRESS.test(parts[1])) return { view: "public", address: parts[1].toLowerCase() };
  return { view: "home" };
}

export const lessonHref = (id) => `#/l/${id}`;
export const PASSPORT_HREF = "#/passport";
export const publicHref = (address) => `#/p/${String(address).toLowerCase()}`;
