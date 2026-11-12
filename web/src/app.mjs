// The UI layer: reads the inlined Book, renders views into #app, wires events
// by delegation, keeps progress in localStorage, applies the live overlay.
// The clock (Date.now) is read here and passed down; views stay pure.

import { model, neighbours, EDITORS, PUBLISHED, countdown } from "./model.mjs";
import { parse, format } from "./router.mjs";
import { renderPage, popover, youNowSection, tocNav } from "./views.mjs";
import { load, save, markRead, markUnread, DEPTHS } from "./progress.mjs";
import { readOverlay, mergeOverlay } from "./overlay.mjs";

const SECTION_DEPTH = { essay: 3, source: 4, voices: 5 };
const SECTION_FOR_DEPTH = { 1: null, 2: null, 3: "essay", 4: "source", 5: "voices" };
const reduceMotion = () => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return true;
  }
};

function storage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readHash() {
  try {
    return window.location.hash || "";
  } catch {
    return "";
  }
}

export function start({ media = "link", play = null, onReady = null } = {}) {
  const root = document.getElementById("app");
  const pop = document.getElementById("pop");
  let book;
  try {
    book = JSON.parse(document.getElementById("book").textContent);
  } catch {
    root.textContent = "This copy of Primer is damaged: its book data could not be read.";
    return;
  }
  let m = model(book);
  const store = storage();
  let state = load(store);
  const ui = { filter: null, voiceFilter: "all", newCount: 0, overlay: null, depthOverride: null, hash: readHash() };
  let route = parse(ui.hash, new Set(m.byId.keys()));
  let observer = null;
  let readTimer = null;
  let popAnchor = null;

  const ctx = () => ({
    m,
    route,
    state,
    depth: ui.depthOverride || state.depth,
    path: state.path,
    filter: ui.filter,
    voiceFilter: ui.voiceFilter,
    newCount: ui.newCount,
    overlay: ui.overlay,
    now: Date.now(),
    media,
    mapWidth: mapWidth(),
  });

  function mapWidth() {
    const w = document.documentElement.clientWidth || window.innerWidth || 390;
    return Math.min(1024, w - (w < 600 ? 40 : 48));
  }

  const persist = () => save(store, state);

  function sectionTarget() {
    if (route.view !== "idea") return null;
    if (route.section === "end") return document.getElementById("s-end");
    if (route.section) return document.getElementById(`s-${route.section}`);
    return null;
  }

  function render({ keepScroll = false } = {}) {
    const y = window.scrollY;
    const active = document.activeElement;
    const key = active && active.getAttribute && (active.getAttribute("data-key") || active.id);
    closePop(false);
    root.innerHTML = String(renderPage(ctx()));
    const ch = route.view === "idea" ? m.byId.get(route.id) : null;
    document.title = ch ? `${ch.title} · Primer` : route.view === "cover" ? "Primer" : `${route.view[0].toUpperCase()}${route.view.slice(1)} · Primer`;
    if (keepScroll) {
      window.scrollTo(0, y);
      if (key) {
        const el = root.querySelector(`[data-key="${CSS.escape(key)}"]`) || document.getElementById(key);
        if (el) el.focus({ preventScroll: true });
      }
    }
    watchEnd();
  }

  function onRoute({ initial = false } = {}) {
    route = parse(ui.hash, new Set(m.byId.keys()));
    ui.voiceFilter = "all";
    ui.depthOverride = null;
    if (route.view === "idea") {
      const need = SECTION_DEPTH[route.section] || 0;
      if (need > state.depth) ui.depthOverride = need;
      if (state.last !== route.id) {
        state = { ...state, last: route.id };
        persist();
      }
    }
    render();
    const target = sectionTarget();
    if (target) target.scrollIntoView({ block: "start" });
    else window.scrollTo(0, 0);
    if (!initial) {
      const main = document.getElementById("main");
      if (main) main.focus({ preventScroll: true });
    }
  }

  function go(hash) {
    ui.hash = hash;
    try {
      window.history.pushState(null, "", hash);
    } catch {
      /* sandboxed document: the route lives in memory */
    }
    onRoute();
  }

  function replaceHash(hash) {
    ui.hash = hash;
    try {
      window.history.replaceState(null, "", hash);
    } catch {
      /* ignore */
    }
  }

  /* ----- reading progress ----- */

  function refreshProgressParts() {
    const ch = route.view === "idea" ? m.byId.get(route.id) : null;
    if (!ch) return;
    const c = ctx();
    const you = root.querySelector(".you-now");
    const focusedKey = document.activeElement && document.activeElement.getAttribute && document.activeElement.getAttribute("data-key");
    if (you) you.outerHTML = String(youNowSection(c, ch));
    const toc = root.querySelector(".toc");
    if (toc) toc.outerHTML = String(tocNav(c, ch));
    if (focusedKey) {
      const el = root.querySelector(`[data-key="${CSS.escape(focusedKey)}"]`);
      if (el) el.focus({ preventScroll: true });
    }
  }

  function setRead(id, read) {
    const was = state.reads.includes(id);
    if (read === was) return;
    state = read ? markRead(state, id) : markUnread(state, id);
    persist();
    refreshProgressParts();
  }

  function watchEnd() {
    if (observer) observer.disconnect();
    observer = null;
    clearTimeout(readTimer);
    const end = root.querySelector("#s-end");
    if (!end || typeof IntersectionObserver !== "function") return;
    const id = end.getAttribute("data-end");
    observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.some((e) => e.isIntersecting);
        clearTimeout(readTimer);
        if (visible && !state.reads.includes(id)) readTimer = setTimeout(() => setRead(id, true), 1200);
      },
      { threshold: 0.15 },
    );
    observer.observe(end);
  }

  /* ----- depth ----- */

  function setDepth(d) {
    if (!(d >= 1 && d <= 5)) return;
    state = { ...state, depth: d };
    ui.depthOverride = null;
    persist();
    const article = root.querySelector(".idea");
    if (!article) return;
    const apply = () => {
      article.setAttribute("data-depth", String(d));
      for (const b of root.querySelectorAll(".depth-btn")) {
        const on = Number(b.getAttribute("data-depth")) === d;
        b.setAttribute("aria-pressed", on ? "true" : "false");
        if (on) b.setAttribute("aria-current", "true");
        else b.removeAttribute("aria-current");
      }
      const target = d <= 1 ? root.querySelector(".idea-head") : root.querySelector(`#s-${DEPTHS[d - 1]}`);
      if (target) target.scrollIntoView({ block: "start", behavior: reduceMotion() ? "auto" : "smooth" });
    };
    if (reduceMotion()) apply();
    else {
      article.classList.add("is-fading");
      setTimeout(() => {
        apply();
        article.classList.remove("is-fading");
      }, 160);
    }
    const section = SECTION_FOR_DEPTH[d];
    replaceHash(format({ view: "idea", id: route.id, section }));
    route = { ...route, section };
  }

  /* ----- popover ----- */

  function openPop(anchor, hash) {
    const content = String(popover(ctx(), hash));
    if (!content) return;
    pop.innerHTML = content;
    pop.hidden = false;
    popAnchor = anchor;
    const narrow = window.innerWidth < 640;
    pop.classList.toggle("pop--sheet", narrow);
    if (!narrow) {
      const r = anchor.getBoundingClientRect();
      const w = Math.min(360, window.innerWidth - 32);
      const left = Math.max(16, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 16));
      pop.style.width = `${w}px`;
      pop.style.left = `${left + window.scrollX}px`;
      pop.style.top = `${r.bottom + window.scrollY + 8}px`;
    } else {
      pop.style.width = "";
      pop.style.left = "";
      pop.style.top = "";
    }
    pop.focus({ preventScroll: true });
  }

  function closePop(restore = true) {
    if (!pop || pop.hidden) return;
    pop.hidden = true;
    pop.innerHTML = "";
    if (restore && popAnchor && document.contains(popAnchor)) popAnchor.focus({ preventScroll: true });
    popAnchor = null;
  }

  /* ----- events ----- */

  function onClick(e) {
    const t = e.target instanceof Element ? e.target : null;
    if (!t) return;
    const link = t.closest("a[href^='#']");
    if (link && !e.defaultPrevented && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      closePop(false);
      go(link.getAttribute("href"));
      return;
    }
    const el = t.closest("[data-act]");
    if (!el) {
      if (pop && !pop.hidden && !pop.contains(t)) closePop();
      return;
    }
    const act = el.getAttribute("data-act");
    if (act === "cite") {
      e.preventDefault();
      if (!pop.hidden && popAnchor === el) closePop();
      else openPop(el, el.getAttribute("data-sub"));
    } else if (act === "close-pop") closePop();
    else if (act === "depth") setDepth(Number(el.getAttribute("data-depth")));
    else if (act === "read") setRead(el.getAttribute("data-id"), true);
    else if (act === "unread") setRead(el.getAttribute("data-id"), false);
    else if (act === "path") {
      const p = el.getAttribute("data-path") === PUBLISHED ? PUBLISHED : EDITORS;
      state = { ...state, path: p };
      persist();
      render({ keepScroll: true });
    } else if (act === "filter") {
      const id = el.getAttribute("data-strand") || null;
      const fromMap = !!el.closest(".map");
      ui.filter = ui.filter === id && fromMap ? null : id;
      render({ keepScroll: true });
      if (fromMap) {
        const idx = document.getElementById("index");
        if (idx) idx.scrollIntoView({ block: "start", behavior: reduceMotion() ? "auto" : "smooth" });
      }
    } else if (act === "vfilter") {
      ui.voiceFilter = el.getAttribute("data-f") || "all";
      const list = root.querySelector(".voices");
      if (list) list.setAttribute("data-f", ui.voiceFilter);
      for (const b of root.querySelectorAll("[data-act='vfilter']")) b.setAttribute("aria-pressed", b === el ? "true" : "false");
    } else if (act === "skip") {
      const main = document.getElementById("main");
      if (main) main.focus();
    } else if (act === "scrollto") {
      const target = document.getElementById(el.getAttribute("data-target") || "");
      if (target) {
        target.setAttribute("tabindex", "-1");
        target.scrollIntoView({ block: "start" });
        target.focus({ preventScroll: true });
      }
    } else if (act === "play" && play) {
      play(el);
    }
  }

  function onKey(e) {
    if (e.key === "Escape" && pop && !pop.hidden) {
      closePop();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT|VIDEO)$/.test(t.tagName))) return;
    if (route.view !== "idea") return;
    if (/^[1-5]$/.test(e.key)) {
      e.preventDefault();
      setDepth(Number(e.key));
    } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      if (t && t.closest && t.closest(".map-scroll, .vfilter, .pathswitch")) return;
      const nb = neighbours(m, state.path, route.id);
      const to = e.key === "ArrowLeft" ? nb.prev : nb.next;
      if (to) {
        e.preventDefault();
        go(`#${to.id}`);
      }
    }
  }

  function onMapHover(e) {
    const t = e.target instanceof Element ? e.target : null;
    const node = t && t.closest(".node");
    const svg = root.querySelector(".map-svg");
    if (!svg) return;
    const id = node ? node.getAttribute("data-node") : null;
    for (const g of svg.querySelectorAll(".edge")) {
      const on = !!id && (g.getAttribute("data-from") === id || g.getAttribute("data-to") === id);
      g.classList.toggle("is-on", on);
    }
    svg.classList.toggle("has-focus", !!id);
  }

  root.addEventListener("click", onClick);
  pop.addEventListener("click", onClick);
  document.addEventListener("click", (e) => {
    if (pop.hidden) return;
    const t = e.target instanceof Element ? e.target : null;
    if (t && !pop.contains(t) && !root.contains(t)) closePop();
  });
  document.addEventListener("keydown", onKey);
  root.addEventListener("mouseover", onMapHover);
  root.addEventListener("focusin", onMapHover);
  root.addEventListener("mouseleave", onMapHover);
  window.addEventListener("hashchange", () => {
    const h = readHash();
    if (h === ui.hash) return;
    ui.hash = h;
    onRoute();
  });
  window.addEventListener("popstate", () => {
    const h = readHash();
    if (h === ui.hash) return;
    ui.hash = h;
    onRoute();
  });

  // The map lays out for the frame's width; re-lay it out when that changes a lot.
  let lastMapWidth = mapWidth();
  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const w = mapWidth();
      if (route.view === "cover" && Math.abs(w - lastMapWidth) > 40) {
        lastMapWidth = w;
        render({ keepScroll: true });
      }
    }, 200);
  });

  // Live countdowns: the only ticking thing on the page.
  setInterval(() => {
    const now = Date.now();
    for (const el of root.querySelectorAll(".countdown[data-deadline]")) {
      const left = countdown(el.getAttribute("data-deadline"), now);
      el.textContent = left || "deadline passed";
    }
  }, 30_000);

  onRoute({ initial: true });
  if (onReady) {
    try {
      onReady();
    } catch {
      /* the host may not be a mini app client */
    }
  }

  // The overlay: read once, merge, re-render in place.
  let asked = false;
  const tryOverlay = () => {
    if (asked) return;
    const claude = window.claude;
    if (!claude || typeof claude.use !== "function") return;
    asked = true;
    readOverlay(claude).then((ov) => {
      if (!ov) return;
      const r = mergeOverlay(book, ov);
      ui.overlay = { added: r.added, replaced: r.replaced, dropped: r.dropped };
      if (!r.added && !r.replaced && !r.refreshedAt) return;
      book = r.book;
      m = model(book);
      ui.newCount = r.added;
      if (route.view === "idea" && !m.byId.has(route.id)) route = parse(ui.hash, new Set(m.byId.keys()));
      // A route that named an idea only the overlay knows becomes reachable now.
      route = parse(ui.hash, new Set(m.byId.keys()));
      render({ keepScroll: true });
    });
  };
  tryOverlay();
  if (!asked) {
    window.addEventListener("load", tryOverlay, { once: true });
    setTimeout(tryOverlay, 1500);
  }
}
