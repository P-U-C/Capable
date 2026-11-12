// A1, the DOM half of input: pointer events on the deck stage become drags,
// taps (by third), and holds. All decisions use the pure arithmetic in
// deck.mjs. Listeners are passive; `touch-action: pan-y` on the stage keeps
// vertical scrolling inside long cards native while horizontal drags are ours.

import { SLOP, HOLD_MS, TAP_MS, tapZone } from "./deck.mjs";

const INTERACTIVE = "a, button, input, textarea, select, label, summary, video[controls], [data-no-tap]";

export function bindGestures(stage, { onDrag, onRelease, onTap, onHoldStart, onHoldEnd }) {
  let p = null; // the press being tracked
  let suppressClick = false;

  const down = (e) => {
    if (p || (e.pointerType === "mouse" && e.button !== 0)) return;
    p = { id: e.pointerId, x0: e.clientX, y0: e.clientY, t0: e.timeStamp, mode: "pending", samples: [[e.timeStamp, e.clientX]], target: e.target, hold: 0 };
    p.hold = setTimeout(() => {
      if (p && p.mode === "pending") {
        p.mode = "hold";
        onHoldStart?.(p.target);
      }
    }, HOLD_MS);
  };

  const move = (e) => {
    if (!p || e.pointerId !== p.id) return;
    const dx = e.clientX - p.x0;
    const dy = e.clientY - p.y0;
    if (p.mode === "pending" && Math.hypot(dx, dy) > SLOP) {
      clearTimeout(p.hold);
      if (Math.abs(dx) > Math.abs(dy)) {
        p.mode = "drag";
        try {
          stage.setPointerCapture(e.pointerId);
        } catch {
          /* pointer already gone */
        }
      } else p.mode = "scroll";
    }
    if (p.mode === "drag") {
      p.samples.push([e.timeStamp, e.clientX]);
      if (p.samples.length > 6) p.samples.shift();
      onDrag?.(dx);
    }
  };

  const velocity = (s) => {
    const [t1, x1] = s[s.length - 1];
    const first = s.find(([t]) => t1 - t <= 100) || s[0];
    const dt = t1 - first[0];
    return dt > 0 ? (x1 - first[1]) / dt : 0;
  };

  const up = (e) => {
    if (!p || e.pointerId !== p.id) return;
    clearTimeout(p.hold);
    const dx = e.clientX - p.x0;
    const ms = e.timeStamp - p.t0;
    const was = p;
    p = null;
    if (was.mode === "drag") {
      suppressClick = true;
      setTimeout(() => (suppressClick = false), 0);
      was.samples.push([e.timeStamp, e.clientX]);
      onRelease?.({ dx, vx: velocity(was.samples) });
    } else if (was.mode === "hold") {
      suppressClick = true;
      setTimeout(() => (suppressClick = false), 0);
      onHoldEnd?.();
    } else if (was.mode === "pending" && ms <= TAP_MS && !was.target.closest?.(INTERACTIVE)) {
      const r = stage.getBoundingClientRect();
      onTap?.(tapZone(e.clientX - r.left, r.width), was.target);
    }
  };

  const cancel = (e) => {
    if (!p || e.pointerId !== p.id) return;
    clearTimeout(p.hold);
    const was = p;
    p = null;
    if (was.mode === "drag") onRelease?.({ dx: 0, vx: 0 });
    else if (was.mode === "hold") onHoldEnd?.();
  };

  // A drag or hold that ends on a link or button must not also click it.
  const click = (e) => {
    if (suppressClick) {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  const menu = (e) => {
    if (e.target.closest?.(".card")) e.preventDefault();
  };

  const opts = { passive: true };
  stage.addEventListener("pointerdown", down, opts);
  stage.addEventListener("pointermove", move, opts);
  stage.addEventListener("pointerup", up, opts);
  stage.addEventListener("pointercancel", cancel, opts);
  stage.addEventListener("click", click, true);
  stage.addEventListener("contextmenu", menu);
  return () => {
    stage.removeEventListener("pointerdown", down, opts);
    stage.removeEventListener("pointermove", move, opts);
    stage.removeEventListener("pointerup", up, opts);
    stage.removeEventListener("pointercancel", cancel, opts);
    stage.removeEventListener("click", click, true);
    stage.removeEventListener("contextmenu", menu);
  };
}
