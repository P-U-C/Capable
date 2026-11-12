// Runtime validator for contract/app.d.ts (v2, the swipe app). Planner-owned. No dependencies.
// Every function returns an array of error strings; [] means valid.

const HASH = /^0x[0-9a-f]{40}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isStr = (v) => typeof v === "string";
export const isHttps = (v) => isStr(v) && v.length <= 2048 && /^https:\/\/[^\s<>"'{}\[\]\\]+$/.test(v);
export const words = (t) => (isStr(t) ? t.split(/\s+/).filter(Boolean).length : 0);

/** Words that must never appear in reader-facing lesson text (the app is about ideas, not the platform or the contest). */
export const BANNED = /\b(farcaster|warpcast|network\s+schools?|network\s+states?|balaji|bount(?:y|ies)|prizes?|contests?|competitions?|competing\s+entr(?:y|ies)|winners?|winning\s+entr(?:y|ies)|runners?[- ]ups?|honou?rable\s+mentions?|1st\s+place|2nd\s+place|placed\s+(?:first|second|third)|submissions?|submitted\s+entr(?:y|ies)|judg(?:e|ed|es|ing|ment|ments|ements?)|rankings?|ranked|deadlines?|usdc|neynar|snapchain|hypersnap)\b/i;

export function validateText(t, path, { maxWords, maxLen = 1200, banned = true } = {}) {
  const e = [];
  if (!isStr(t) || !t.trim()) return [`${path}: non-empty string required`];
  if (t.length > maxLen) e.push(`${path}: longer than ${maxLen} chars`);
  if (maxWords && words(t) > maxWords) e.push(`${path}: ${words(t)} words, max ${maxWords}`);
  if (/<[a-z!/]/i.test(t)) e.push(`${path}: no HTML`);
  if (/\[[^\]]*\]\([^)]*\)|\{\{/.test(t)) e.push(`${path}: no links or citation markup (plain text and *em* only)`);
  if (banned && BANNED.test(t)) e.push(`${path}: mentions "${t.match(BANNED)[0]}" — the app is about ideas, not the platform or the contest`);
  return e;
}

const CARD_RULES = {
  cover: () => [],
  idea: (c, p) => validateText(c.text, `${p}.text`, { maxWords: 30 }),
  story: (c, p) => [
    ...(isStr(c.heading) && c.heading.trim() && c.heading.length <= 40 ? validateText(c.heading, `${p}.heading`) : [`${p}.heading: ≤ 40 chars`]),
    ...validateText(c.text, `${p}.text`, { maxWords: 70 }),
  ],
  term: (c, p) => [
    ...(isStr(c.term) && c.term.trim() && c.term.length <= 40 ? validateText(c.term, `${p}.term`) : [`${p}.term: ≤ 40 chars`]),
    ...validateText(c.def, `${p}.def`, { maxWords: 35 }),
  ],
  counter: (c, p) => [...validateText(c.claim, `${p}.claim`, { maxWords: 45 }), ...validateText(c.reply, `${p}.reply`, { maxWords: 55 })],
  question: (c, p) => validateText(c.text, `${p}.text`, { maxWords: 25 }),
  practice: (c, p) => {
    const e = validateText(c.prompt, `${p}.prompt`, { maxWords: 35 });
    if (!Array.isArray(c.steps) || c.steps.length < 1 || c.steps.length > 4) e.push(`${p}.steps: 1–4 steps`);
    else c.steps.forEach((s, i) => e.push(...validateText(s, `${p}.steps[${i}]`, { maxWords: 18 })));
    return e;
  },
  work: (c, p) => (c.role === "lead" || c.role === "more" ? [] : [`${p}.role: "lead" or "more"`]),
  trait: () => [],
  deeper: () => [],
};

export function validateSource(s, path) {
  const e = [];
  if (!isObj(s)) return [`${path}: object required`];
  if (!(isStr(s.title) && s.title.trim())) e.push(`${path}.title: required`);
  if (!(isStr(s.author) && s.author.trim())) e.push(`${path}.author: required`);
  if (!(Number.isInteger(s.year) && s.year > 0 && s.year < 2100)) e.push(`${path}.year: invalid`);
  e.push(...validateText(s.note, `${path}.note`, { maxWords: 30 }));
  for (const k of ["title", "author"]) if (isStr(s[k]) && BANNED.test(s[k])) e.push(`${path}.${k}: mentions "${s[k].match(BANNED)[0]}"`);
  if ("url" in s && !isHttps(s.url)) e.push(`${path}.url: https only`);
  if ("url" in s && isStr(s.url) && /farcaster|warpcast|snapchain|hypersnap|neynar|ns\.com|thenetworkstate/i.test(s.url)) e.push(`${path}.url: a source link must not point at the platform (it can show as a domain)`);
  return e;
}

export function validateLessonDoc(l, path = "lesson", { strict = false } = {}) {
  const e = [];
  if (!isObj(l)) return [`${path}: object required`];
  if (!SLUG.test(l.id || "")) e.push(`${path}.id: kebab-case`);
  if (!(Number.isInteger(l.number) && l.number >= 1 && l.number <= 999)) e.push(`${path}.number: 1–999`);
  if (!["ready", "draft"].includes(l.status)) e.push(`${path}.status: ready | draft`);
  if (!(isStr(l.title) && l.title.trim() && l.title.length <= 32)) e.push(`${path}.title: ≤ 32 chars`);
  else e.push(...validateText(l.title, `${path}.title`));
  e.push(...validateText(l.promise, `${path}.promise`, { maxLen: 90 }));
  if (!SLUG.test(l.trait || "")) e.push(`${path}.trait: trait id`);
  if (!(Number.isInteger(l.minutes) && l.minutes >= 1 && l.minutes <= 15)) e.push(`${path}.minutes: 1–15`);
  if (!SLUG.test(l.topic || "")) e.push(`${path}.topic: kebab-case subject key`);
  if (!Array.isArray(l.cards)) e.push(`${path}.cards: array required`);
  else {
    l.cards.forEach((c, i) => {
      const p = `${path}.cards[${i}]`;
      if (!isObj(c) || !CARD_RULES[c.type]) return e.push(`${p}: unknown card type ${c?.type}`);
      e.push(...CARD_RULES[c.type](c, p));
    });
    const types = l.cards.map((c) => c?.type);
    const count = (t) => types.filter((x) => x === t).length;
    const has = (role) => l.cards.some((c) => c?.type === "work" && c.role === role);
    if (types[0] !== "cover") e.push(`${path}.cards: must start with cover`);
    if (count("cover") !== 1) e.push(`${path}.cards: exactly one cover`);
    if (count("trait") !== 1) e.push(`${path}.cards: exactly one trait card`);
    if (!has("lead") || !has("more")) e.push(`${path}.cards: needs a work slot "lead" and a work slot "more"`);
    if (l.status === "ready") {
      if (types.at(-1) !== "deeper" || types.at(-2) !== "trait") e.push(`${path}.cards: must end with trait, then deeper`);
      if (count("idea") < 3) e.push(`${path}.cards: ≥ 3 idea cards`);
      if (count("story") < 1) e.push(`${path}.cards: ≥ 1 story card`);
      if (count("term") < 1) e.push(`${path}.cards: ≥ 1 term card`);
      if (count("counter") !== 1) e.push(`${path}.cards: exactly 1 counter card`);
      if (count("practice") < 1) e.push(`${path}.cards: ≥ 1 practice card`);
      if (l.cards.length < 8 || l.cards.length > 16) e.push(`${path}.cards: 8–16 cards, has ${l.cards.length}`);
      if (!Array.isArray(l.sources) || l.sources.length < 1) e.push(`${path}.sources: ≥ 1`);
    }
  }
  (l.sources || []).forEach((s, i) => e.push(...validateSource(s, `${path}.sources[${i}]`)));
  if (strict && l.status === "ready") {
    const total = l.cards.reduce((n, c) => n + words(c.text) + words(c.heading) + words(c.def) + words(c.claim) + words(c.reply) + words(c.prompt) + (c.steps || []).reduce((m, s) => m + words(s), 0), 0);
    if (total < 250 || total > 700) e.push(`${path}: ${total} words across cards, want 250–700`);
  }
  return e;
}

export function validateWork(w, path = "work") {
  const e = [];
  if (!isObj(w)) return [`${path}: object required`];
  if (!HASH.test(w.id || "")) e.push(`${path}.id: full cast hash`);
  if (!(Number.isInteger(w.fid) && w.fid > 0)) e.push(`${path}.fid: invalid`);
  if (!["lead", "more"].includes(w.role)) e.push(`${path}.role: lead | more`);
  if (!["video", "build"].includes(w.kind)) e.push(`${path}.kind: video | build`);
  e.push(...validateText(w.caption, `${path}.caption`, { maxLen: 120 }));
  if (w.kind === "video") {
    const v = w.video;
    if (!isObj(v) || !["hls", "mp4", "external"].some((k) => isHttps(v[k]))) e.push(`${path}.video: one https hls/mp4/external url`);
    else for (const k of Object.keys(v)) if (!isHttps(v[k])) e.push(`${path}.video.${k}: https only`);
  }
  if (w.kind === "build") {
    const b = w.build;
    if (!isObj(b) || !["site", "repo"].some((k) => isHttps(b[k]))) e.push(`${path}.build: one https site/repo url`);
  }
  if (!isHttps(w.original)) e.push(`${path}.original: https`);
  if (!ISO.test(w.postedAt || "")) e.push(`${path}.postedAt: ISO date`);
  return e;
}

export function validateApp(a, { strict = false } = {}) {
  const e = [];
  if (!isObj(a)) return ["app: object required"];
  if (a.version !== 2) e.push("app.version: 2");
  if (!ISO.test(a.generatedAt || "")) e.push("app.generatedAt: ISO");
  if (!(isStr(a.name) && a.name.trim() && a.name.length <= 40)) e.push("app.name: ≤ 40 chars");
  if (!isObj(a.citizen) || !isStr(a.citizen.name)) e.push("app.citizen.name: required");
  else e.push(...validateText(a.citizen.line, "app.citizen.line", { maxWords: 40 }));
  const traitIds = new Set();
  if (!Array.isArray(a.traits) || !a.traits.length) e.push("app.traits: non-empty");
  else a.traits.forEach((t, i) => {
    if (!SLUG.test(t?.id || "") || !isStr(t?.name)) e.push(`app.traits[${i}]: id + name`);
    e.push(...validateText(t?.grant, `app.traits[${i}].grant`, { maxWords: 20 }));
    if (!(Number.isInteger(t?.hue) && t.hue >= 0 && t.hue < 360)) e.push(`app.traits[${i}].hue: 0–359`);
    if ("color" in t && !/^#[0-9A-F]{6}$/.test(t.color)) e.push(`app.traits[${i}].color: #RRGGBB uppercase`);
    if ("emblem" in t && !(Number.isInteger(t.emblem) && t.emblem >= 0 && t.emblem <= 255)) e.push(`app.traits[${i}].emblem: 0..255`);
    if ("stampId" in t && !(Number.isInteger(t.stampId) && t.stampId >= 0 && t.stampId <= 255)) e.push(`app.traits[${i}].stampId: 0..255`);
    if ("stampId" in t && a.traits.some((u, j) => j < i && u?.stampId === t.stampId)) e.push(`app.traits[${i}].stampId: duplicate`);
    if (!/^[A-Z][A-Z ]{0,11}$/.test(String(t?.name || "").toUpperCase())) e.push(`app.traits[${i}].name: 1–12 letters or spaces (it is printed on stamps)`);
    traitIds.add(t?.id);
  });
  const ids = new Set();
  if (!Array.isArray(a.lessons)) e.push("app.lessons: array");
  else a.lessons.forEach((l, i) => {
    e.push(...validateLessonDoc(l, `app.lessons[${i}]`, { strict }));
    if (ids.has(l?.id)) e.push(`app.lessons[${i}].id: duplicate`);
    ids.add(l?.id);
    if (!traitIds.has(l?.trait)) e.push(`app.lessons[${i}].trait: unknown ${l?.trait}`);
    if (!Array.isArray(l?.work)) e.push(`app.lessons[${i}].work: array`);
    else l.work.forEach((w, j) => e.push(...validateWork(w, `app.lessons[${i}].work[${j}]`)));
    if (i > 0 && !(a.lessons[i - 1].number < l.number)) e.push("app.lessons: sorted by number, unique");
  });
  if ("stamps" in a) {
    const st = a.stamps;
    if (!isObj(st) || !Number.isInteger(st.chainId) || st.chainId <= 0) e.push("app.stamps.chainId: positive integer");
    else if (!(st.address === null || /^0x[0-9a-fA-F]{40}$/.test(st.address))) e.push("app.stamps.address: null or 0x + 40 hex");
  }
  if (!isObj(a.creators)) e.push("app.creators: object");
  else for (const [k, c] of Object.entries(a.creators)) {
    if (String(c?.fid) !== k) e.push(`app.creators.${k}: key must equal fid`);
    if ("username" in c && !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(c.username)) e.push(`app.creators.${k}.username: invalid`);
    if ("displayName" in c && !(isStr(c.displayName) && c.displayName.trim() && c.displayName.length <= 80 && !/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/.test(c.displayName)))
      e.push(`app.creators.${k}.displayName: 1–80 chars, no control or format characters`); // the app escapes it like all text
  }
  return e;
}

// CLI: node contract/validate-app.mjs <app.json | lesson.json ...> [--strict]
if (import.meta.url === `file://${process.argv[1]}`) {
  const { readFileSync } = await import("node:fs");
  const strict = process.argv.includes("--strict");
  let bad = 0;
  for (const f of process.argv.slice(2).filter((x) => !x.startsWith("--"))) {
    const doc = JSON.parse(readFileSync(f, "utf8"));
    const errs = "lessons" in doc ? validateApp(doc, { strict }) : validateLessonDoc(doc, f, { strict });
    console.log(errs.length ? `FAIL ${f}\n  ${errs.join("\n  ")}` : `PASS ${f}`);
    bad += errs.length ? 1 : 0;
  }
  process.exit(bad ? 1 : 0);
}
