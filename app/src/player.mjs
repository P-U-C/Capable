// A2, the DOM half: one <video> per frame, created on first play. HLS plays
// natively on Safari; elsewhere hls.js is imported once, lazily, from a
// same-origin chunk built from the npm package (src/hls.mjs; review S6).
// Any failure shows the frame's poster and a "watch the original" link (the
// markup is already there; see work.mjs). Video is careful with data (S14):
// nothing loads before play, hls.js starts at its lowest level and stops
// loading while paused. Dependencies (document, loader) are injectable so
// tests can run it without a browser.

import { pickSource } from "./work.mjs";
import { COPY } from "./copy.mjs";

let pending = null;

/** Import hls.js once. Resolves to the Hls constructor; a failed load can be retried later. */
export function loadHls({ importer = () => import("./hls.mjs") } = {}) {
  if (pending) return pending;
  pending = Promise.resolve()
    .then(importer)
    .then((m) => {
      const Hls = m?.default ?? m?.Hls;
      if (typeof Hls !== "function") throw new Error("hls.js missing");
      return Hls;
    })
    .catch((err) => {
      pending = null;
      throw err;
    });
  return pending;
}

/** Test hook: forget a cached loader promise. */
export const resetHlsLoader = () => {
  pending = null;
};

/** hls.js settings: lowest level first, a short buffer, no worker (the CSP allows none from blob:). */
export const HLS_CONFIG = Object.freeze({ enableWorker: false, startLevel: 0, capLevelToPlayerSize: true, maxBufferLength: 10, maxMaxBufferLength: 30, backBufferLength: 30 });

/** Can this browser play HLS without hls.js? (Safari, iOS.) */
export function canPlayNativeHls(doc = globalThis.document) {
  try {
    const v = doc.createElement("video");
    return typeof v.canPlayType === "function" && /maybe|probably/.test(v.canPlayType("application/vnd.apple.mpegurl"));
  } catch {
    return false;
  }
}

/**
 * Should a video start on its own when its card shows? Never with sound (the
 * view always starts it muted), and not at all when the reader asked for less
 * motion or less data, or is on a slow or cellular connection.
 */
export function mayAutoplay(win = globalThis.window, { reduced = false } = {}) {
  if (reduced) return false;
  const c = win?.navigator?.connection;
  if (c?.saveData === true) return false;
  if (c && (c.type === "cellular" || /(^|-)2g$|^3g$/.test(String(c.effectiveType || "")))) return false;
  try {
    if (win?.matchMedia?.("(prefers-reduced-data: reduce)")?.matches) return false;
  } catch {
    /* not supported */
  }
  return true;
}

/**
 * A player bound to one .vframe element.
 *   play({ muted })  start (the view autoplays muted when a card becomes active)
 *   pause()          stop, keep position, stop fetching
 *   toggle()         play if paused, pause if playing
 *   seek(fraction)   jump to a point
 *   setMuted(m)
 *   destroy()        release the element and any hls.js instance
 * onState(state) is called with "loading" | "playing" | "paused" | "error";
 * onTime(fraction, seconds, duration) with playback progress. The frame's own
 * controls (play/pause button, scrub bar, clock) are kept in step here.
 */
export function createPlayer(frame, video, { doc = globalThis.document, nativeHls = false, load = loadHls, onState = () => {}, onTime = () => {} } = {}) {
  const src = pickSource(video, { nativeHls });
  const q = (sel) => frame.querySelector?.(sel) ?? null;
  const toggleBtn = q("[data-toggle]");
  const scrub = q("[data-scrub]");
  const clock = q(".vframe__time");
  let el = null;
  let hls = null;
  let want = false;
  let muted = true;
  let state = "idle";
  let dead = false;
  let stopped = false;
  let scrubbing = false;

  const showState = (s) => {
    const playing = s === "playing" || s === "loading";
    if (toggleBtn) {
      toggleBtn.setAttribute("aria-label", playing ? COPY.pause : COPY.play);
      toggleBtn.dataset.state = playing ? "playing" : "paused";
    }
  };
  const showTime = (cur, dur) => {
    if (scrub && !scrubbing) {
      scrub.value = String(dur > 0 ? Math.round((cur / dur) * 1000) : 0);
      scrub.setAttribute("aria-valuetext", COPY.timeA11y(cur, dur));
    }
    if (clock) clock.textContent = COPY.time(cur, dur);
  };

  const set = (s) => {
    if (state === s || state === "error") return;
    state = s;
    frame.classList.toggle("is-playing", s === "playing");
    frame.classList.toggle("is-loading", s === "loading");
    showState(s);
    onState(s);
  };
  const fail = () => {
    if (state === "error") return;
    want = false;
    try {
      hls?.destroy();
    } catch {
      /* already gone */
    }
    hls = null;
    el?.pause?.();
    el?.remove?.();
    el = null;
    state = "error";
    frame.classList.remove("is-playing", "is-loading");
    frame.classList.add("is-error");
    onState("error");
  };

  const attempt = () => {
    if (!el || !want || dead) return;
    el.muted = muted;
    const p = el.play();
    if (p && typeof p.catch === "function")
      p.catch((err) => {
        if (err?.name === "NotAllowedError" && !muted) {
          // Sound needs a gesture this browser hasn't seen: fall back to muted.
          muted = true;
          frame.classList.add("is-muted");
          attempt();
        } else if (err?.name === "NotAllowedError") set("paused");
        // AbortError: a pause() raced the play(); nothing to do.
      });
  };

  function ensure() {
    if (el || dead) return el;
    el = doc.createElement("video");
    el.className = "vframe__video";
    el.muted = true;
    el.loop = false;
    el.playsInline = true;
    el.preload = "none"; // nothing is fetched until the reader (or an allowed autoplay) starts it
    el.setAttribute("playsinline", "");
    el.setAttribute("webkit-playsinline", "");
    el.setAttribute("disableremoteplayback", "");
    el.setAttribute("aria-hidden", "true"); // the frame's own buttons are the controls
    el.addEventListener("error", fail);
    el.addEventListener("playing", () => set("playing"));
    el.addEventListener("waiting", () => want && set("loading"));
    el.addEventListener("pause", () => set("paused"));
    el.addEventListener("ended", () => set("paused"));
    el.addEventListener("timeupdate", () => {
      if (el?.duration > 0) {
        onTime(el.currentTime / el.duration, el.currentTime, el.duration);
        showTime(el.currentTime, el.duration);
      }
    });
    el.addEventListener("loadedmetadata", () => el && showTime(el.currentTime || 0, el.duration || 0));
    frame.insertBefore(el, frame.firstChild);
    if (src.mode === "native" || src.mode === "file") {
      el.src = src.url;
    } else if (src.mode === "hlsjs") {
      load()
        .then((Hls) => {
          if (dead || state === "error") return;
          if (!Hls?.isSupported?.()) return fail();
          hls = new Hls({ ...HLS_CONFIG });
          hls.on(Hls.Events.ERROR, (_e, data) => {
            if (data?.fatal) fail();
          });
          hls.loadSource(src.url);
          hls.attachMedia(el);
          if (!want) {
            hls.stopLoad?.();
            stopped = true;
          }
          attempt();
        })
        .catch(fail);
    }
    return el;
  }

  const api = {
    get mode() {
      return src.mode;
    },
    get state() {
      return state;
    },
    get muted() {
      return muted;
    },
    get element() {
      return el;
    },
    play({ muted: m = true } = {}) {
      if (dead || state === "error") return;
      if (src.mode === "external" || src.mode === "none") return fail();
      want = true;
      muted = m;
      frame.classList.toggle("is-muted", m);
      frame.classList.add("is-started");
      ensure();
      if (hls && stopped) {
        hls.startLoad?.(el?.currentTime > 0 ? el.currentTime : -1);
        stopped = false;
      }
      set("loading");
      attempt();
    },
    pause() {
      want = false;
      el?.pause?.();
      if (hls && !stopped) {
        hls.stopLoad?.(); // a paused or swiped-past video stops filling its buffer
        stopped = true;
      }
    },
    toggle({ muted: m } = {}) {
      if (state === "playing" || state === "loading") api.pause();
      else api.play({ muted: m ?? muted });
    },
    seek(fraction) {
      const f = Math.max(0, Math.min(1, Number(fraction) || 0));
      if (el && el.duration > 0) {
        el.currentTime = f * el.duration;
        showTime(el.currentTime, el.duration);
      }
    },
    setMuted(m) {
      muted = !!m;
      frame.classList.toggle("is-muted", muted);
      if (el) el.muted = muted;
    },
    destroy() {
      dead = true;
      want = false;
      unbind();
      try {
        hls?.destroy();
      } catch {
        /* already gone */
      }
      hls = null;
      if (el) {
        el.pause?.();
        el.removeAttribute?.("src");
        el.load?.();
        el.remove?.();
      }
      el = null;
    },
  };

  // the frame's own controls
  const onToggle = (e) => {
    e.preventDefault?.();
    api.toggle();
  };
  const onScrubStart = () => (scrubbing = true);
  const onScrub = () => api.seek(Number(scrub.value) / 1000);
  const onScrubEnd = () => {
    scrubbing = false;
    api.seek(Number(scrub.value) / 1000);
  };
  toggleBtn?.addEventListener("click", onToggle);
  scrub?.addEventListener("pointerdown", onScrubStart);
  scrub?.addEventListener("input", onScrub);
  scrub?.addEventListener("change", onScrubEnd);
  function unbind() {
    toggleBtn?.removeEventListener("click", onToggle);
    scrub?.removeEventListener("pointerdown", onScrubStart);
    scrub?.removeEventListener("input", onScrub);
    scrub?.removeEventListener("change", onScrubEnd);
  }

  return api;
}
