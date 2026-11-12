// A1 + A2, the DOM half of a lesson: mounts the deck, applies stack poses,
// wires gestures, keyboard, focus, progress, the video players and the
// "more" sheet, and remembers the reader's place.

import { createDeck, step, resumeIndex, isFinishedAt, stackPose, settle, keyAction } from "./deck.mjs";
import { renderDeck } from "./cards.mjs";
import { renderSheet } from "./work.mjs";
import { bindGestures } from "./gesture.mjs";
import { createPlayer, canPlayNativeHls } from "./player.mjs";
import { paintIn } from "./paint.mjs";
import { COPY } from "./copy.mjs";
import { deckModel } from "./model.mjs";

export function mountDeck(root, { app, lessonId, store, reduced = false, navigate }) {
  const s0 = store.get();
  const model = deckModel(app, lessonId, s0);
  if (!model) return null;
  const { cards, ctx } = model;
  const { lesson, trait } = ctx;

  root.innerHTML = String(renderDeck(ctx, cards));
  paintIn(root);
  const deck = root.querySelector(".deck");
  const stage = deck.querySelector(".deck__stage");
  const slides = [...stage.querySelectorAll(".card")];
  const segs = [...deck.querySelectorAll(".seg")];
  const bar = deck.querySelector(".segs");
  const announce = deck.querySelector("[data-announce]");
  const doc = root.ownerDocument;
  const nativeHls = canPlayNativeHls(doc);
  const players = new Map(); // slide index → player
  let state = createDeck(cards.length, resumeIndex(s0.pos[lesson.id], cards.length));
  let width = 0;
  let peek = 16;
  let sheet = null;
  let held = false;
  deck.classList.toggle("is-reduced", reduced);

  const measure = () => {
    width = slides[0]?.offsetWidth || stage.clientWidth || 1;
    peek = parseFloat(getComputedStyle(deck).getPropertyValue("--peek")) || 16;
  };

  function apply(dx = 0, animate = true) {
    deck.classList.toggle("is-dragging", !animate);
    slides.forEach((el, i) => {
      if (reduced) {
        el.classList.toggle("is-active", i === state.index);
        el.classList.toggle("is-hidden", i !== state.index);
        return;
      }
      const p = stackPose(i, state.index, dx, width, cards.length, peek);
      el.style.transform = `translate3d(${p.x.toFixed(1)}px,0,0) rotate(${p.rot.toFixed(2)}deg)`;
      el.style.zIndex = String(p.z);
      el.classList.toggle("is-hidden", !p.shown);
      el.classList.toggle("is-active", i === state.index);
    });
  }

  function playerFor(i) {
    const c = cards[i];
    if (c?.type !== "lead" || c.work.kind !== "video") return null;
    if (players.has(i)) return players.get(i);
    const frame = slides[i].querySelector(".vframe");
    const seg = segs[i];
    const pl = createPlayer(frame, c.work.video, {
      doc,
      nativeHls,
      onState: (s) => syncSound(frame, pl, s),
      onTime: (f) => seg.style.setProperty("--p", f.toFixed(3)),
    });
    players.set(i, pl);
    return pl;
  }

  function syncSound(frame, pl, s) {
    const btn = frame.querySelector("[data-sound]");
    if (!btn || !pl) return;
    btn.setAttribute("aria-pressed", pl.muted ? "false" : "true");
    btn.querySelector(".vframe__sound-label").textContent = pl.muted ? COPY.unmute : COPY.mute;
    frame.classList.toggle("is-paused", s === "paused" && held);
  }

  function media(prev) {
    if (prev >= 0) players.get(prev)?.pause();
    const pl = playerFor(state.index);
    if (pl && !held) pl.play({ muted: !store.get().sound });
  }

  function progress() {
    segs.forEach((el, i) => {
      const st = i < state.index ? "done" : i === state.index ? "active" : "todo";
      if (el.dataset.state !== st || st === "active") {
        el.dataset.state = st;
        if (st === "active") {
          // restart the reading fill for the new card
          const secs = Number(slides[i].dataset.read) || 0;
          el.style.setProperty("--read", `${reduced ? 0 : secs}s`);
          el.dataset.video = cards[i].type === "lead" && cards[i].work.kind === "video" ? "true" : "false";
          el.dataset.timed = secs > 0 ? "true" : "false";
          el.classList.remove("is-filling");
          void el.offsetWidth;
          el.classList.add("is-filling");
        }
      }
    });
    bar.setAttribute("aria-valuenow", String(state.index + 1));
    bar.setAttribute("aria-valuetext", COPY.cardOf(state.index + 1, cards.length));
  }

  function update(prev, { focus = true } = {}) {
    apply(0, true);
    slides.forEach((el, i) => {
      const on = i === state.index;
      el.toggleAttribute("inert", !on);
      el.setAttribute("aria-hidden", on ? "false" : "true");
    });
    progress();
    const c = cards[state.index];
    announce.textContent = `${COPY.cardOf(state.index + 1, cards.length)}: ${COPY.cardName[c.type] ?? c.type}`;
    if (focus) slides[state.index].focus({ preventScroll: true });
    store.visit(lesson.id, { index: state.index, count: cards.length, finished: isFinishedAt(cards, state.index) });
    media(prev);
    const active = slides[state.index];
    if (c.type === "trait") {
      active.classList.remove("is-earned");
      void active.offsetWidth;
      active.classList.add("is-earned");
    }
    deck.dataset.at = c.type;
  }

  function go(i, opts) {
    const prev = state.index;
    state = step(state, { type: "goto", index: i });
    if (state.index === prev) return apply(0, true);
    update(prev, opts);
  }
  const next = () => go(state.index + 1);
  const prev = () => go(state.index - 1);

  // --- input ---------------------------------------------------------------
  const unbind = bindGestures(stage, {
    onDrag: (dx) => {
      if (!reduced && !sheet) apply(dx, false);
    },
    onRelease: ({ dx, vx }) => {
      if (sheet) return;
      const to = settle({ dx, vx, width, index: state.index, count: cards.length });
      if (to !== state.index) go(to);
      else apply(0, true);
    },
    onTap: (zone) => {
      if (sheet) return;
      if (zone === "prev") prev();
      else if (zone === "next") next();
      else {
        const pl = players.get(state.index);
        if (pl) pl.state === "playing" ? pl.pause() : pl.play({ muted: pl.muted });
      }
    },
    onHoldStart: () => {
      held = true;
      deck.classList.add("is-held");
      const pl = players.get(state.index);
      if (pl?.state === "playing" || pl?.state === "loading") {
        pl.pause();
        slides[state.index].querySelector(".vframe")?.classList.add("is-paused");
      }
    },
    onHoldEnd: () => {
      held = false;
      deck.classList.remove("is-held");
      const frame = slides[state.index].querySelector(".vframe.is-paused");
      if (frame) {
        frame.classList.remove("is-paused");
        players.get(state.index)?.play({ muted: players.get(state.index).muted });
      }
    },
  });

  const onClick = (e) => {
    const t = e.target.closest("button, a");
    if (!t || !deck.contains(t)) return;
    if (t.dataset.nav === "prev") return prev();
    if (t.dataset.nav === "next") return next();
    if (t.matches(".step")) {
      const s = store.tick(t.dataset.tickKey, Number(t.dataset.step));
      const on = (s.ticks[t.dataset.tickKey] || []).includes(Number(t.dataset.step));
      t.setAttribute("aria-pressed", on ? "true" : "false");
      return;
    }
    if (t.hasAttribute("data-sound")) {
      const pl = players.get(state.index);
      if (!pl) return;
      pl.setMuted(!pl.muted);
      store.setSound(!pl.muted);
      if (pl.state !== "playing") pl.play({ muted: pl.muted });
      syncSound(t.closest(".vframe"), pl, pl.state);
      return;
    }
    if (t.hasAttribute("data-play")) {
      const pl = players.get(state.index) || playerFor(state.index);
      pl?.play({ muted: store.get().sound ? false : pl.muted });
      return;
    }
    if (t.dataset.open) return openSheet(t.dataset.open, t);
    if (t.hasAttribute("data-close-sheet")) return closeSheet();
  };
  deck.addEventListener("click", onClick);

  const onKey = (e) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    if (sheet) {
      if (e.key === "Escape") {
        e.preventDefault();
        closeSheet();
      }
      return;
    }
    const tgt = e.target;
    const onControl = tgt?.closest?.("button, a, input, textarea, select");
    if (onControl && (e.key === " " || e.key === "Enter")) return;
    const a = keyAction(e.key, { shift: e.shiftKey });
    if (!a) return;
    e.preventDefault();
    if (a === "next") next();
    else if (a === "prev") prev();
    else if (a === "first") go(0);
    else if (a === "last") go(cards.length - 1);
    else if (a === "close") navigate("#/");
  };
  doc.addEventListener("keydown", onKey);

  // --- the "more" sheet ------------------------------------------------------
  let sheetPlayer = null;
  let sheetReturn = null;
  function openSheet(id, from) {
    const c = cards[state.index];
    const work = c.type === "more" ? c.works.find((w) => w.id === id) : null;
    if (!work) return;
    players.get(state.index)?.pause();
    sheetReturn = from;
    deck.insertAdjacentHTML("beforeend", String(renderSheet(app, lesson, work, { hue: trait.hue, uid: `sheet-${lesson.id}` })));
    sheet = deck.lastElementChild;
    paintIn(sheet);
    for (const el of deck.children) if (el !== sheet) el.toggleAttribute("inert", true);
    const frame = sheet.querySelector(".vframe");
    sheetPlayer = createPlayer(frame, work.video, { doc, nativeHls, onState: (s) => syncSound(frame, sheetPlayer, s) });
    sheetPlayer.play({ muted: false });
    sheet.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      if (b.hasAttribute("data-sound")) {
        sheetPlayer.setMuted(!sheetPlayer.muted);
        syncSound(frame, sheetPlayer, sheetPlayer.state);
      } else if (b.hasAttribute("data-play")) sheetPlayer.play({ muted: sheetPlayer.muted });
    });
    sheet.querySelector("[data-close-sheet]").focus();
  }
  function closeSheet() {
    if (!sheet) return;
    sheetPlayer?.destroy();
    sheetPlayer = null;
    sheet.remove();
    sheet = null;
    for (const el of deck.children) el.toggleAttribute("inert", false);
    slides.forEach((el, i) => el.toggleAttribute("inert", i !== state.index));
    sheetReturn?.focus();
  }

  const onResize = () => {
    measure();
    apply(0, false);
  };
  doc.defaultView.addEventListener("resize", onResize);

  measure();
  apply(0, false);
  update(-1);
  // let the first frame paint without transitions, then enable them
  doc.defaultView.requestAnimationFrame(() => deck.classList.add("is-ready"));

  return {
    lessonId: lesson.id,
    get index() {
      return state.index;
    },
    go,
    destroy() {
      closeSheet();
      unbind();
      deck.removeEventListener("click", onClick);
      doc.removeEventListener("keydown", onKey);
      doc.defaultView.removeEventListener("resize", onResize);
      for (const p of players.values()) p.destroy();
      players.clear();
    },
  };
}
