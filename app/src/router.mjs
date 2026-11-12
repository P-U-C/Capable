// Hash routes. Pure: parse a hash into a view, and back.
//   #/            home
//   #/you         home, scrolled to the "you" panel
//   #/l/<id>      a lesson deck (opens at the remembered card)

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function parseRoute(hash) {
  const h = String(hash || "").replace(/^#/, "");
  const parts = h.split("/").filter(Boolean);
  if (parts[0] === "l" && ID.test(parts[1] || "")) return { view: "lesson", id: parts[1] };
  if (parts[0] === "you") return { view: "home", focus: "you" };
  return { view: "home" };
}

export const lessonHref = (id) => `#/l/${id}`;
