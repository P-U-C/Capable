// A1 + A2, the DOM half of a lesson: mounts the deck, applies stack poses,
// wires gestures, keyboard, focus, progress, the video players and the
// "more" sheet, and remembers the reader's place. Leaving is the shell's job:
// the close button, Esc and the in-deck links call onClose / onLink, so the
// shell can keep the browser history tidy (review U4).

import { createDeck, step, resumeAt, isFinishedAt, stackPose, settle, keyAction } from "./deck.mjs";
import { renderDeck } from "./cards.mjs";
import { renderSheet } from "./work.mjs";
import { bindGestures } from "./gesture.mjs";
import { createPlayer, canPlayNativeHls, mayAutoplay } from "./player.mjs";
import { paintIn } from "./paint.mjs";
import { COPY } from "./copy.mjs";
import { deckModel } from "./model.mjs";
import { fitCard } from "./fit.mjs";
import { mountStamp, stampInitial } from "./mint.mjs";
import { previewHolder } from "./citizen.mjs";

const isVideo = (c) => c?.type === "lead" && c.work?.kind === "video";

export function mountDeck(root, { app, lessonId, store, reduced = false, onClose = () => {}, onLink = () => {}, loadHls, identity = null, stamps = null, citizen = null } = {}) {
  const model = deckModel(app, lessonId, store.get());
  if (!model) return null;
  const { cards, ctx } = model;
  const { lesson, trait } = ctx;
  // progress saved by an older version (card indexes) becomes card keys now that the cards are known
  const s0 = store.migrate ? store.migrate(lesson.id, cards) : store.get();

  // the trait card's stamp: previewed for the reader's address when one is known (v3)
  const stampCtx = { ...ctx, ticks: s0.ticks || {}, holder: previewHolder(identity?.current?.(), citizen), act: stampInitial({ lesson, trait, citizen }), ...(stamps?.preview ? { preview: stamps.preview } : {}) };
  root.innerHTML = String(renderDeck(stampCtx, cards));
  paintIn(root);
  const deck = root.querySelector(".deck");
  const stage = deck.querySelector(".deck__stage");
  const slides = [...stage.querySelectorAll(".card")];
  const segs = [...deck.querySelectorAll(".seg")];
  const bar = deck.querySelector(".segs");
  const doc = root.ownerDocument;
  const win = doc.defaultView;
  const nativeHls = canPlayNativeHls(doc);
  const autoplay = mayAutoplay(win, { reduced });
  const players = new Map(); // slide index → player
  const traitSlide = slides.find((el) => el.dataset.type === "trait");
  const stamp = traitSlide && identity && stamps ? mountStamp(traitSlide, { app, lesson, trait, identity, stamps, citizen, ctx: stampCtx }) : null;
  let state = createDeck(cards.length, resumeAt(cards, s0.at?.[lesson.id]));
  let width = 0;
  let peek = 16;
  let sheet = null;
  let held = false;
  deck.classList.toggle("is-reduced", reduced);

  const measure = () => {
    width = slides[0]?.offsetWidth || stage.clientWidth || 1;
    peek = parseFloat(win.getComputedStyle?.(deck)?.getPropertyValue("--peek")) || 16;
  };
  const fitAll = () => slides.forEach((el) => fitCard(el));

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
    if (!isVideo(c)) return null;
    if (players.has(i)) return players.get(i);
    const frame = slides[i].querySelector(".vframe");
    const seg = segs[i];
    const pl = createPlayer(frame, c.work.video, {
      doc,
      nativeHls,
      ...(loadHls ? { load: loadHls } : {}),
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

  /** Play or pause the current card's video: Space, K, a middle tap. An explicit start may use sound. */
  function togglePlay() {
    const pl = playerFor(state.index);
    if (!pl) return;
    if (pl.state === "playing" || pl.state === "loading") pl.pause();
    else pl.play({ muted: pl.state === "idle" ? !store.get().sound : pl.muted });
  }

  function media(prev) {
    // the video a swipe leaves is paused (and stops downloading)
    if (prev >= 0 && prev !== state.index) players.get(prev)?.pause();
    // players more than one card away are released
    for (const [i, p] of players)
      if (Math.abs(i - state.index) > 1) {
        p.destroy();
        players.delete(i);
      }
    // a video may start on its own, always muted, unless motion or data should be spared (review U5, S14)
    if (!autoplay || held) return;
    playerFor(state.index)?.play({ muted: true });
  }

  function progress() {
    // the current segment is filled on arrival, not on a reading timer (review U21)
    segs.forEach((el, i) => {
      el.dataset.state = i < state.index ? "done" : i === state.index ? "active" : "todo";
      el.dataset.video = i === state.index && isVideo(cards[i]) ? "true" : "false";
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
    // focus moves to the card, which names itself ("Card 3 of 14: idea"); no live region repeats it
    if (focus) slides[state.index].focus({ preventScroll: true });
    // on short screens and zoomed pages the deck scrolls with the page: each card starts at its top
    if (doc.scrollingElement) doc.scrollingElement.scrollTop = 0;
    // only a ready lesson is ever recorded as finished (review S11)
    store.visit(lesson.id, { key: c.key, index: state.index, count: cards.length, finished: lesson.status === "ready" && isFinishedAt(cards, state.index) });
    media(prev);
    const active = slides[state.index];
    if (c.type === "trait") {
      active.classList.remove("is-earned");
      void active.offsetWidth;
      active.classList.add("is-earned");
      stamp?.activate();
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
      else if (isVideo(cards[state.index])) togglePlay();
    },
    // press-and-hold pauses a video; on text cards a long press is left to the
    // browser, to select text (review U16)
    onHoldStart: () => {
      if (!isVideo(cards[state.index])) return;
      held = true;
      deck.classList.add("is-held");
      const pl = players.get(state.index);
      if (pl?.state === "playing" || pl?.state === "loading") {
        pl.pause();
        slides[state.index].querySelector(".vframe")?.classList.add("is-paused");
      }
    },
    onHoldEnd: () => {
      if (!held) return;
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
    const t = e.target.closest?.("button, a");
    if (!t || !deck.contains(t)) return;
    const href = t.matches("a") ? t.getAttribute("href") || "" : "";
    if (href.startsWith("#/")) {
      // in-app links leave through the shell, which keeps history tidy
      e.preventDefault();
      return t.matches(".deck__close") ? onClose() : onLink(href);
    }
    if (t.dataset.nav === "prev") return prev();
    if (t.dataset.nav === "next") return next();
    if (t.matches(".step")) {
      const s = store.tick(t.dataset.tickKey, t.dataset.step);
      const on = (s.ticks[t.dataset.tickKey] || []).includes(t.dataset.step);
      t.setAttribute("aria-pressed", on ? "true" : "false");
      const card = t.closest(".card");
      const all = [...card.querySelectorAll(".step")].every((b) => b.getAttribute("aria-pressed") === "true");
      card.querySelector("[data-practice-done]")?.toggleAttribute("data-on", all);
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
      const pl = playerFor(state.index);
      pl?.play({ muted: !store.get().sound });
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
    // the scrub bar (and any field) keeps its own keys
    if (tgt?.closest?.("input, textarea, select") && e.key !== "Escape") return;
    const onControl = tgt?.closest?.("button, a");
    if (onControl && (e.key === " " || e.key === "Enter")) return;
    const a = keyAction(e.key, { shift: e.shiftKey, video: isVideo(cards[state.index]) });
    if (!a) return;
    e.preventDefault();
    if (a === "next") next();
    else if (a === "prev") prev();
    else if (a === "first") go(0);
    else if (a === "last") go(cards.length - 1);
    else if (a === "toggle") togglePlay();
    else if (a === "close") onClose();
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
    deck.classList.add("has-sheet");
    paintIn(sheet);
    for (const el of deck.children) if (el !== sheet) el.toggleAttribute("inert", true);
    const frame = sheet.querySelector(".vframe");
    sheetPlayer = createPlayer(frame, work.video, { doc, nativeHls, ...(loadHls ? { load: loadHls } : {}), onState: (s) => syncSound(frame, sheetPlayer, s) });
    // the reader tapped play: an explicit start, so sound is allowed
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
    deck.classList.remove("has-sheet");
    for (const el of deck.children) el.toggleAttribute("inert", false);
    slides.forEach((el, i) => el.toggleAttribute("inert", i !== state.index));
    sheetReturn?.focus();
  }

  const onResize = () => {
    measure();
    fitAll();
    apply(0, false);
  };
  win.addEventListener("resize", onResize);

  measure();
  fitAll();
  apply(0, false);
  update(-1);
  // web fonts swap in late; fit again once they have
  doc.fonts?.ready?.then(() => {
    if (deck.isConnected) fitAll();
  });
  // let the first frame paint without transitions, then enable them
  win.requestAnimationFrame(() => deck.classList.add("is-ready"));

  return {
    lessonId: lesson.id,
    title: lesson.title,
    get index() {
      return state.index;
    },
    get players() {
      return players;
    },
    go,
    get stamp() {
      return stamp;
    },
    destroy() {
      stamp?.destroy();
      closeSheet();
      unbind();
      deck.removeEventListener("click", onClick);
      doc.removeEventListener("keydown", onKey);
      win.removeEventListener("resize", onResize);
      for (const p of players.values()) p.destroy();
      players.clear();
    },
  };
}
