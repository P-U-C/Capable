// A2, the DOM half: one <video> per frame, created on first play. HLS plays
// natively on Safari; elsewhere hls.js 1.5 is loaded once, lazily, from cdnjs
// the first time a stream needs it. Any failure shows the frame's poster and a
// "watch the original" link (the markup is already there; see work.mjs).
// Dependencies (document, window, loader) are injectable so tests can run it
// without a browser.

import { pickSource } from "./work.mjs";

export const HLS_URL = "https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.20/hls.min.js";

let pending = null;

/** Load hls.js once. Resolves to the Hls constructor; a failed load can be retried later. */
export function loadHls({ doc = globalThis.document, win = globalThis.window, url = HLS_URL, timeout = 15000 } = {}) {
  if (win?.Hls) return Promise.resolve(win.Hls);
  if (pending) return pending;
  pending = new Promise((resolve, reject) => {
    const s = doc.createElement("script");
    let timer = 0;
    const fail = (e) => {
      clearTimeout(timer);
      pending = null;
      s.remove?.();
      reject(e);
    };
    timer = setTimeout(() => fail(new Error("hls.js timed out")), timeout);
    s.addEventListener("load", () => {
      clearTimeout(timer);
      if (win?.Hls) resolve(win.Hls);
      else fail(new Error("hls.js missing"));
    });
    s.addEventListener("error", () => fail(new Error("hls.js failed to load")));
    s.src = url;
    s.async = true;
    s.crossOrigin = "anonymous";
    s.referrerPolicy = "no-referrer";
    doc.head.appendChild(s);
  });
  return pending;
}

/** Test hook: forget a cached loader promise. */
export const resetHlsLoader = () => {
  pending = null;
};

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
 * A player bound to one .vframe element.
 *   play({ muted })  start (muted autoplay when a card becomes active)
 *   pause()          stop, keep position
 *   setMuted(m)
 *   destroy()        release the element and any hls.js instance
 * onState(state) is called with "loading" | "playing" | "paused" | "error";
 * onTime(fraction) with playback progress.
 */
export function createPlayer(frame, video, { doc = globalThis.document, nativeHls = false, load = loadHls, onState = () => {}, onTime = () => {} } = {}) {
  const src = pickSource(video, { nativeHls });
  let el = null;
  let hls = null;
  let want = false;
  let muted = true;
  let state = "idle";
  let dead = false;

  const set = (s) => {
    if (state === s || state === "error") return;
    state = s;
    frame.classList.toggle("is-playing", s === "playing");
    frame.classList.toggle("is-loading", s === "loading");
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
    el.loop = true;
    el.playsInline = true;
    el.preload = "metadata";
    el.setAttribute("playsinline", "");
    el.setAttribute("webkit-playsinline", "");
    el.setAttribute("disableremoteplayback", "");
    el.addEventListener("error", fail);
    el.addEventListener("playing", () => set("playing"));
    el.addEventListener("waiting", () => want && set("loading"));
    el.addEventListener("pause", () => set("paused"));
    el.addEventListener("timeupdate", () => {
      if (el?.duration > 0) onTime(el.currentTime / el.duration);
    });
    frame.insertBefore(el, frame.firstChild);
    if (src.mode === "native" || src.mode === "file") {
      el.src = src.url;
    } else if (src.mode === "hlsjs") {
      load()
        .then((Hls) => {
          if (dead || state === "error") return;
          if (!Hls?.isSupported?.()) return fail();
          hls = new Hls({ enableWorker: true, capLevelToPlayerSize: true, maxBufferLength: 20, startLevel: -1 });
          hls.on(Hls.Events.ERROR, (_e, data) => {
            if (data?.fatal) fail();
          });
          hls.loadSource(src.url);
          hls.attachMedia(el);
          attempt();
        })
        .catch(fail);
    }
    return el;
  }

  return {
    get mode() {
      return src.mode;
    },
    get state() {
      return state;
    },
    get muted() {
      return muted;
    },
    play({ muted: m = true } = {}) {
      if (dead || state === "error") return;
      if (src.mode === "external" || src.mode === "none") return fail();
      want = true;
      muted = m;
      frame.classList.toggle("is-muted", m);
      ensure();
      set("loading");
      attempt();
    },
    pause() {
      want = false;
      el?.pause?.();
    },
    setMuted(m) {
      muted = !!m;
      frame.classList.toggle("is-muted", muted);
      if (el) el.muted = muted;
    },
    destroy() {
      dead = true;
      want = false;
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
}
