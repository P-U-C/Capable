// Shared test fixtures. Not a test file itself (no .test. in the name).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

export const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const ROOT = resolve(APP_DIR, "..");
export const FIXTURE_PATH = join(ROOT, "contract/fixtures/app.sample.json");

/** A fresh deep copy of the contract fixture. */
export const fixture = () => JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));

export const lessonOf = (app, id) => app.lessons.find((l) => l.id === id);

/** Visible text of markup: tags removed, entities decoded. */
export function visibleText(markup) {
  return String(markup)
    .replace(/<svg[\s\S]*?<\/svg>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#96;/g, "`")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** Values of an attribute across all tags in markup (decoded). */
export function attrValues(markup, name) {
  return [...String(markup).matchAll(new RegExp(`\\s${name}="([^"]*)"`, "g"))].map((m) =>
    m[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&"),
  );
}

/** All opening tags of an element type. */
export const tags = (markup, name) => [...String(markup).matchAll(new RegExp(`<${name}\\b[^>]*>`, "gi"))].map((m) => m[0]);

export const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return m ? m[1].replace(/&amp;/g, "&") : null;
};

/** A minimal fake of the DOM pieces player.mjs touches. */
export function fakeFrame() {
  const classes = new Set();
  const children = [];
  return {
    classes,
    children,
    get firstChild() {
      return children[0] ?? null;
    },
    insertBefore(el) {
      children.unshift(el);
      el.parent = this;
    },
    classList: {
      add: (...c) => c.forEach((x) => classes.add(x)),
      remove: (...c) => c.forEach((x) => classes.delete(x)),
      toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)),
      contains: (c) => classes.has(c),
    },
  };
}

export function fakeVideo({ playRejects = null } = {}) {
  const on = {};
  const v = {
    tag: "video",
    attrs: {},
    src: "",
    muted: false,
    paused: true,
    playCalls: [],
    duration: 59,
    currentTime: 0,
    addEventListener: (t, f) => ((on[t] ||= []).push(f)),
    emit: (t, e = {}) => (on[t] || []).forEach((f) => f(e)),
    setAttribute(k, val) {
      this.attrs[k] = val;
    },
    removeAttribute(k) {
      delete this.attrs[k];
      if (k === "src") this.src = "";
    },
    play() {
      this.playCalls.push({ muted: this.muted });
      if (playRejects && !this.muted) {
        const err = new Error("blocked");
        err.name = playRejects;
        return Promise.reject(err);
      }
      this.paused = false;
      return Promise.resolve();
    },
    pause() {
      this.paused = true;
    },
    load() {},
    remove() {
      this.removed = true;
    },
    canPlayType: () => "",
  };
  return v;
}

export function fakeDoc(opts) {
  const made = [];
  return {
    made,
    createElement(tag) {
      const el = tag === "video" ? fakeVideo(opts) : { tag, attrs: {}, setAttribute() {}, addEventListener() {}, remove() {} };
      made.push(el);
      return el;
    },
  };
}

/** A fake hls.js constructor that records what the player does with it. */
export function fakeHls({ supported = true } = {}) {
  const instances = [];
  class Hls {
    static isSupported() {
      return supported;
    }
    constructor(cfg) {
      this.cfg = cfg;
      this.handlers = {};
      instances.push(this);
    }
    on(ev, fn) {
      this.handlers[ev] = fn;
    }
    loadSource(url) {
      this.url = url;
    }
    stopLoad() {
      this.stopped = (this.stopped || 0) + 1;
    }
    startLoad(at) {
      (this.started ||= []).push(at);
    }
    attachMedia(el) {
      this.media = el;
    }
    destroy() {
      this.destroyed = true;
    }
  }
  Hls.Events = { ERROR: "hlsError" };
  return { Hls, instances };
}

export const tick = () => new Promise((r) => setTimeout(r, 0));
