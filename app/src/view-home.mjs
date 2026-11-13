// A3, the DOM half of home: render, colour, and scroll to the "you" panel
// when asked. Remembers the feed's scroll position between visits.

import { renderHome } from "./home.mjs";
import { paintIn } from "./paint.mjs";
import { wirePfp } from "./view-passport.mjs";

let lastScroll = 0;

export function mountHome(root, { app, store, focus, from, who = {} }) {
  root.innerHTML = String(renderHome(app, store.get(), { who }));
  paintIn(root);
  wirePfp(root);
  const doc = root.ownerDocument;
  const win = doc.defaultView;
  const scroller = doc.scrollingElement || doc.documentElement;
  if (focus === "you") {
    const you = root.querySelector("#you");
    you?.scrollIntoView({ block: "start" });
    you?.focus({ preventScroll: true });
  } else if (from) {
    // returning from a lesson: put the reader back at its tile
    const t = root.querySelector(`.tile[data-lesson="${from}"]`);
    if (t) {
      t.scrollIntoView({ block: "center" });
      t.focus({ preventScroll: true });
    } else scroller.scrollTop = lastScroll;
  } else scroller.scrollTop = lastScroll;
  const onScroll = () => (lastScroll = scroller.scrollTop);
  win.addEventListener("scroll", onScroll, { passive: true });
  return {
    destroy() {
      lastScroll = scroller.scrollTop;
      win.removeEventListener("scroll", onScroll);
    },
  };
}
