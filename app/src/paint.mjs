// Applies trait colours to rendered markup. Markup carries only data-hue;
// colours are set here through CSSOM (element.style.setProperty), which a
// strict CSP allows, so no style="" attribute ever appears in the HTML.

import { traitVars } from "./art.mjs";

export function paintIn(root) {
  const els = [...(root.matches?.("[data-hue]") ? [root] : []), ...root.querySelectorAll("[data-hue]")];
  for (const el of els) {
    const hue = Number(el.dataset.hue);
    if (!Number.isFinite(hue)) continue;
    for (const [k, v] of Object.entries(traitVars(hue))) el.style.setProperty(k, v);
  }
}
