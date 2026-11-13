// A small fake DOM for behavioural tests of the app's DOM halves (view-deck,
// view-home, the shell). Not a test file itself. It parses the app's own
// markup (well-formed, quoted attributes), supports the selectors the app
// uses (tag, #id, .class, [attr], [attr="v"], [attr^="v"], :not(), descendant
// and child combinators, lists), events with capture and bubbling, focus, a
// window with location, history and hashchange, and <video> elements that
// record what the player does to them. Nothing is laid out: sizes are fixed.

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) =>
    e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENT[e] ?? m),
  );

export class FakeEvent {
  constructor(type, init = {}) {
    Object.assign(this, { bubbles: false, cancelable: true, timeStamp: Date.now() }, init);
    this.type = type;
    this.defaultPrevented = false;
    this.stopped = false;
  }
  preventDefault() {
    if (this.cancelable) this.defaultPrevented = true;
  }
  stopPropagation() {
    this.stopped = true;
  }
}

class Target {
  constructor() {
    this.listeners = [];
  }
  addEventListener(type, fn, opts) {
    const capture = opts === true || !!opts?.capture;
    if (!this.listeners.some((l) => l.type === type && l.fn === fn && l.capture === capture)) this.listeners.push({ type, fn, capture });
  }
  removeEventListener(type, fn, opts) {
    const capture = opts === true || !!opts?.capture;
    this.listeners = this.listeners.filter((l) => !(l.type === type && l.fn === fn && l.capture === capture));
  }
  /** Count of listeners of a type (tests check that views clean up). */
  listenerCount(type) {
    return this.listeners.filter((l) => l.type === type).length;
  }
  dispatchEvent(ev) {
    ev.target = this;
    const path = [];
    for (let x = this; x; x = x.parentNode ?? (x.nodeType === 9 ? x.defaultView : null)) path.push(x);
    const fire = (node, phase) => {
      ev.currentTarget = node;
      for (const l of [...node.listeners]) {
        if (l.type !== ev.type) continue;
        if (phase === "capture" && !l.capture) continue;
        if (phase === "bubble" && l.capture) continue;
        l.fn.call(node, ev);
      }
    };
    for (const node of [...path].reverse().slice(0, -1)) if (!ev.stopped) fire(node, "capture");
    if (!ev.stopped) fire(this, "target");
    if (ev.bubbles) for (const node of path.slice(1)) if (!ev.stopped) fire(node, "bubble");
    return !ev.defaultPrevented;
  }
}

class Node extends Target {
  constructor(doc) {
    super();
    this.ownerDocument = doc;
    this.parentNode = null;
    this.childNodes = [];
  }
  get parentElement() {
    return this.parentNode?.nodeType === 1 ? this.parentNode : null;
  }
  get firstChild() {
    return this.childNodes[0] ?? null;
  }
  get children() {
    return this.childNodes.filter((n) => n.nodeType === 1);
  }
  get firstElementChild() {
    return this.children[0] ?? null;
  }
  get lastElementChild() {
    return this.children.at(-1) ?? null;
  }
  get textContent() {
    return this.childNodes.map((c) => c.textContent).join("");
  }
  set textContent(v) {
    for (const c of this.childNodes) c.parentNode = null;
    this.childNodes = [new Text(this.ownerDocument, String(v))];
    this.childNodes[0].parentNode = this;
  }
  appendChild(n) {
    n.remove?.();
    n.parentNode = this;
    this.childNodes.push(n);
    return n;
  }
  insertBefore(n, ref) {
    n.remove?.();
    const i = ref ? this.childNodes.indexOf(ref) : -1;
    n.parentNode = this;
    if (i < 0) this.childNodes.push(n);
    else this.childNodes.splice(i, 0, n);
    return n;
  }
  remove() {
    if (!this.parentNode) return;
    const sib = this.parentNode.childNodes;
    sib.splice(sib.indexOf(this), 1);
    this.parentNode = null;
  }
  contains(n) {
    for (let x = n; x; x = x.parentNode) if (x === this) return true;
    return false;
  }
  get isConnected() {
    let x = this;
    while (x.parentNode) x = x.parentNode;
    return x.nodeType === 9;
  }
  *descendants() {
    for (const c of this.childNodes)
      if (c.nodeType === 1) {
        yield c;
        yield* c.descendants();
      }
  }
  querySelectorAll(sel) {
    const m = compile(sel);
    return [...this.descendants()].filter((el) => m(el));
  }
  querySelector(sel) {
    const m = compile(sel);
    for (const el of this.descendants()) if (m(el)) return el;
    return null;
  }
}

class Text extends Node {
  constructor(doc, data) {
    super(doc);
    this.nodeType = 3;
    this.data = data;
  }
  get textContent() {
    return this.data;
  }
  set textContent(v) {
    this.data = String(v);
  }
}

class Style {
  constructor() {
    this.props = new Map();
  }
  setProperty(k, v) {
    this.props.set(k, String(v));
  }
  getPropertyValue(k) {
    return this.props.get(k) ?? "";
  }
  removeProperty(k) {
    this.props.delete(k);
  }
}

const dataAttr = (k) => `data-${String(k).replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

export class Element extends Node {
  constructor(doc, tag) {
    super(doc);
    this.nodeType = 1;
    this.localName = String(tag).toLowerCase();
    this.tagName = String(tag).toUpperCase();
    this.attrs = new Map();
    this.style = new Style();
    this.scrollTop = 0;
    this.layout = { width: 360, height: 600, scrollHeight: null };
    const el = this;
    this.dataset = new Proxy(
      {},
      {
        get: (_, k) => (typeof k === "string" ? (el.getAttribute(dataAttr(k)) ?? undefined) : undefined),
        set: (_, k, v) => (el.setAttribute(dataAttr(k), v), true),
        has: (_, k) => el.hasAttribute(dataAttr(k)),
        deleteProperty: (_, k) => (el.removeAttribute(dataAttr(k)), true),
      },
    );
    const list = () => (el.getAttribute("class") || "").split(/\s+/).filter(Boolean);
    const write = (cs) => el.setAttribute("class", [...new Set(cs)].join(" "));
    this.classList = {
      add: (...cs) => write([...list(), ...cs]),
      remove: (...cs) => write(list().filter((c) => !cs.includes(c))),
      contains: (c) => list().includes(c),
      toggle: (c, force) => {
        const on = force === undefined ? !list().includes(c) : !!force;
        write(on ? [...list(), c] : list().filter((x) => x !== c));
        return on;
      },
    };
  }
  getAttribute(n) {
    return this.attrs.has(n) ? this.attrs.get(n) : null;
  }
  setAttribute(n, v) {
    this.attrs.set(n, String(v));
  }
  removeAttribute(n) {
    this.attrs.delete(n);
  }
  hasAttribute(n) {
    return this.attrs.has(n);
  }
  toggleAttribute(n, force) {
    const on = force === undefined ? !this.attrs.has(n) : !!force;
    if (on) this.attrs.set(n, this.attrs.get(n) ?? "");
    else this.attrs.delete(n);
    return on;
  }
  get id() {
    return this.getAttribute("id") || "";
  }
  get className() {
    return this.getAttribute("class") || "";
  }
  set className(v) {
    this.setAttribute("class", v);
  }
  get inert() {
    return this.hasAttribute("inert");
  }
  get value() {
    return this._value ?? this.getAttribute("value") ?? "";
  }
  set value(v) {
    this._value = String(v);
  }
  set innerHTML(markup) {
    for (const c of this.childNodes) c.parentNode = null;
    this.childNodes = [];
    parseInto(this, String(markup));
  }
  insertAdjacentHTML(where, markup) {
    if (where !== "beforeend") throw new Error(`fake DOM: insertAdjacentHTML(${where}) not supported`);
    parseInto(this, String(markup));
  }
  matches(sel) {
    return compile(sel)(this);
  }
  closest(sel) {
    const m = compile(sel);
    for (let x = this; x && x.nodeType === 1; x = x.parentNode) if (m(x)) return x;
    return null;
  }
  focus() {
    this.ownerDocument.activeElement = this;
  }
  blur() {
    if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = this.ownerDocument.body;
  }
  click() {
    return this.dispatchEvent(new FakeEvent("click", { bubbles: true, button: 0 }));
  }
  scrollIntoView() {}
  setPointerCapture() {}
  releasePointerCapture() {}
  get offsetWidth() {
    return this.layout.width;
  }
  get clientWidth() {
    return this.layout.width;
  }
  get clientHeight() {
    return this.layout.height;
  }
  get scrollHeight() {
    return this.layout.scrollHeight ?? this.layout.height;
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, x: 0, y: 0, width: this.layout.width, height: this.layout.height, right: this.layout.width, bottom: this.layout.height };
  }
}

/** A <video> that records play/pause/load and keeps src as an attribute, as the real one does. */
export class VideoElement extends Element {
  constructor(doc, tag) {
    super(doc, tag);
    this.muted = false;
    this.paused = true;
    this.currentTime = 0;
    this.duration = 60;
    this.preload = "auto";
    this.loop = false;
    this.playsInline = false;
    this.playCalls = [];
    this.loads = 0;
  }
  get src() {
    return this.getAttribute("src") ?? "";
  }
  set src(v) {
    this.setAttribute("src", v);
  }
  canPlayType(type) {
    return this.ownerDocument.defaultView?.nativeHls && /mpegurl/i.test(type) ? "maybe" : "";
  }
  play() {
    this.playCalls.push({ muted: this.muted });
    this.paused = false;
    queueMicrotask(() => !this.paused && this.dispatchEvent(new FakeEvent("playing")));
    return Promise.resolve();
  }
  pause() {
    if (this.paused) return;
    this.paused = true;
    queueMicrotask(() => this.dispatchEvent(new FakeEvent("pause")));
  }
  load() {
    this.loads++;
  }
}

class Document extends Node {
  constructor(win) {
    super(null);
    this.ownerDocument = this;
    this.nodeType = 9;
    this.defaultView = win;
    this.title = "";
    this.fonts = { ready: Promise.resolve() };
    this.documentElement = this.createElement("html");
    this.head = this.createElement("head");
    this.body = this.createElement("body");
    this.appendChild(this.documentElement);
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(this.body);
    this.activeElement = this.body;
  }
  createElement(tag) {
    return String(tag).toLowerCase() === "video" ? new VideoElement(this, tag) : new Element(this, tag);
  }
  createTextNode(data) {
    return new Text(this, data);
  }
  getElementById(id) {
    for (const el of this.descendants()) if (el.getAttribute("id") === id) return el;
    return null;
  }
  get scrollingElement() {
    return this.documentElement;
  }
  getSelection() {
    const doc = this;
    return {
      removeAllRanges() {
        doc.selectionCleared = (doc.selectionCleared || 0) + 1;
      },
    };
  }
}

// ---- markup ----------------------------------------------------------------

const TOKEN = /<!--[\s\S]*?-->|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)|</g;
const ATTR = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

function parseInto(parent, markup) {
  const doc = parent.ownerDocument;
  const stack = [parent];
  for (const m of markup.matchAll(TOKEN)) {
    const top = stack.at(-1);
    if (m[0].startsWith("<!--")) continue;
    if (m[1]) {
      const name = m[1].toLowerCase();
      for (let k = stack.length - 1; k > 0; k--)
        if (stack[k].localName === name) {
          stack.length = k;
          break;
        }
    } else if (m[2]) {
      const el = doc.createElement(m[2]);
      for (const a of m[3].matchAll(ATTR)) el.setAttribute(a[1], decode(a[2] ?? a[3] ?? a[4] ?? ""));
      top.appendChild(el);
      if (!m[4] && !VOID.has(el.localName)) stack.push(el);
    } else top.appendChild(new Text(doc, decode(m[5] ?? "<")));
  }
}

// ---- selectors -------------------------------------------------------------

const cache = new Map();

function splitTop(s, seps) {
  const out = [];
  let depth = 0;
  let quote = null;
  let cur = "";
  for (const ch of s) {
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "[" || ch === "(") depth++;
    else if (ch === "]" || ch === ")") depth--;
    else if (depth === 0 && seps.includes(ch)) {
      out.push(cur, ch);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function compound(src) {
  const s = src.trim();
  const tests = [];
  let i = 0;
  const tag = /^[a-zA-Z*][\w-]*/.exec(s);
  if (tag) {
    i = tag[0].length;
    if (tag[0] !== "*") tests.push((el) => el.localName === tag[0].toLowerCase());
  }
  while (i < s.length) {
    const rest = s.slice(i);
    let m;
    if ((m = /^#([\w-]+)/.exec(rest))) tests.push(((id) => (el) => el.getAttribute("id") === id)(m[1]));
    else if ((m = /^\.([\w-]+)/.exec(rest))) tests.push(((c) => (el) => el.classList.contains(c))(m[1]));
    else if ((m = /^\[\s*([\w:-]+)\s*(?:([~^$*|]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+))\s*)?(?:\s+i)?\]/.exec(rest))) {
      const [, name, op, a, b, c] = m;
      const v = a ?? b ?? c;
      tests.push((el) => {
        const got = el.getAttribute(name);
        if (got === null) return false;
        if (!op) return true;
        if (op === "=") return got === v;
        if (op === "^=") return got.startsWith(v);
        if (op === "$=") return got.endsWith(v);
        if (op === "*=") return got.includes(v);
        if (op === "~=") return got.split(/\s+/).includes(v);
        return got === v || got.startsWith(`${v}-`);
      });
    } else if (rest.startsWith(":not(")) {
      let depth = 0;
      let end = 4;
      for (; end < rest.length; end++) {
        if (rest[end] === "(") depth++;
        else if (rest[end] === ")" && --depth === 0) break;
      }
      const inner = compile(rest.slice(5, end));
      tests.push((el) => !inner(el));
      m = [rest.slice(0, end + 1)];
    } else throw new Error(`fake DOM: unsupported selector "${src}"`);
    i += m[0].length;
  }
  return (el) => el.nodeType === 1 && tests.every((t) => t(el));
}

function complex(src) {
  const parts = splitTop(src.trim().replace(/\s*>\s*/g, ">"), [" ", ">"]).filter((x) => x !== "");
  const steps = [];
  let comb = " ";
  for (const p of parts) {
    if (p === " " || p === ">") comb = p === ">" || comb === ">" ? ">" : " ";
    else {
      steps.push({ test: compound(p), comb });
      comb = " ";
    }
  }
  const from = (el, i) => {
    if (i === 0) return true;
    const prev = steps[i - 1].test;
    if (steps[i].comb === ">") {
      const p = el.parentElement;
      return !!p && prev(p) && from(p, i - 1);
    }
    for (let p = el.parentElement; p; p = p.parentElement) if (prev(p) && from(p, i - 1)) return true;
    return false;
  };
  return (el) => steps.at(-1).test(el) && from(el, steps.length - 1);
}

function compile(sel) {
  if (!cache.has(sel)) {
    const list = splitTop(sel, [","])
      .filter((x) => x !== ",")
      .map(complex);
    cache.set(sel, (el) => list.some((f) => f(el)));
  }
  return cache.get(sel);
}

// ---- window ----------------------------------------------------------------

/** In-memory localStorage. */
export function memStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    map: m,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

/**
 * A window with a document, location, history (hash changes push entries and
 * fire hashchange asynchronously, as browsers do), matchMedia and navigator.
 */
export function fakeWindow({ url = "https://app.example/Capable/", nativeHls = true, connection, reducedMotion = false, storage = memStorage() } = {}) {
  const win = new Target();
  win.nativeHls = nativeHls;
  win.window = win;
  win.document = new Document(win);
  win.localStorage = storage;
  win.navigator = connection ? { connection } : {};
  win.matchMedia = (q) => ({ media: q, matches: /reduced-motion/.test(q) ? reducedMotion : false, addEventListener() {}, removeEventListener() {} });
  win.getComputedStyle = () => ({ getPropertyValue: () => "" });
  win.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  win.scrollTo = () => {};
  let cur = new URL(url);
  const fireHash = (oldURL) => setTimeout(() => win.dispatchEvent(new FakeEvent("hashchange", { oldURL, newURL: cur.href })), 0);
  const entries = [{ url: cur.href, state: null }];
  let index = 0;
  win.location = {
    get href() {
      return cur.href;
    },
    get hash() {
      return cur.hash;
    },
    set hash(h) {
      const next = new URL(cur.href);
      next.hash = h;
      if (next.href === cur.href) return;
      const old = cur.href;
      cur = next;
      entries.splice(index + 1);
      entries.push({ url: cur.href, state: null });
      index = entries.length - 1;
      fireHash(old);
    },
    get pathname() {
      return cur.pathname;
    },
    get protocol() {
      return cur.protocol;
    },
    get hostname() {
      return cur.hostname;
    },
    get origin() {
      return cur.origin;
    },
  };
  const go = (to) => {
    if (to < 0 || to >= entries.length) return;
    const old = cur.href;
    index = to;
    cur = new URL(entries[index].url);
    if (new URL(old).hash !== cur.hash) fireHash(old);
  };
  win.history = {
    entries,
    get index() {
      return index;
    },
    get length() {
      return entries.length;
    },
    get state() {
      return entries[index].state;
    },
    pushState(state, _t, u) {
      if (u !== undefined) cur = new URL(u, cur.href);
      entries.splice(index + 1);
      entries.push({ url: cur.href, state: state ?? null });
      index = entries.length - 1;
    },
    replaceState(state, _t, u) {
      if (u !== undefined) cur = new URL(u, cur.href);
      entries[index] = { url: cur.href, state: state ?? null };
    },
    back: () => go(index - 1),
    forward: () => go(index + 1),
    go: (n = 0) => go(index + n),
  };
  return win;
}

/** Let queued tasks run (hashchange, requestAnimationFrame, promise callbacks). */
export const settle = () => new Promise((r) => setTimeout(r, 5));

/** Press a key on the focused element (or the document). */
export function press(doc, key, init = {}) {
  const ev = new FakeEvent("keydown", { bubbles: true, key, ...init });
  (doc.activeElement || doc).dispatchEvent(ev);
  return ev;
}

/** Fire a pointer sequence on an element: a tap (down, up) or a drag by dx. */
export function pointer(el, type, init = {}) {
  const ev = new FakeEvent(type, { bubbles: true, pointerId: 1, pointerType: "touch", button: 0, clientX: 0, clientY: 0, ...init });
  el.dispatchEvent(ev);
  return ev;
}
