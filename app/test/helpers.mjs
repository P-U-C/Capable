// Shared test fixtures. Not a test file itself (no .test. in the name).
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
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

/** Decode an 8-bit RGB or RGBA, non-interlaced PNG: { width, height, channels, px }. */
export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  let off = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[12] !== 0) throw new Error("only 8-bit, non-interlaced");
      channels = { 2: 3, 6: 4 }[data[9]];
      if (!channels) throw new Error(`colour type ${data[9]}`);
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const px = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x];
      const a = x >= channels ? px[y * stride + x - channels] : 0;
      const b = y > 0 ? px[(y - 1) * stride + x] : 0;
      const c = x >= channels && y > 0 ? px[(y - 1) * stride + x - channels] : 0;
      const p = a + b - c;
      const pr = Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c;
      px[y * stride + x] = (v + [0, a, b, (a + b) >> 1, pr][f]) & 0xff;
    }
  }
  return { width, height, channels, px };
}
