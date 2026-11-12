// Runtime validator for contract/book.d.ts. Planner-owned. No dependencies.
// Every function returns an array of error strings; [] means valid.
// Used by ingest (before writing book.json), editorial (gate), and web (overlay).

const HASH = /^0x[0-9a-f]{40}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const KINDS = new Set(["prologue", "chapter", "coda"]);
const STATUS = new Set(["published", "draft"]);
const PLACES = new Set(["1st", "2nd", "hm"]);
const SUB_KINDS = new Set(["video", "site", "link"]);
const PRIZE_STATUS = new Set(["open", "judging", "closed", "awarded"]);
const CONNECTION_KINDS = new Set(["builds-on", "in-tension-with", "instance-of", "precondition-for", "echoes"]);
const RESERVED_IDS = new Set(["settings", "sidebar", "customize", "upgrade", "downloads", "cover", "glossary", "credits", "about"]);

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isStr = (v) => typeof v === "string";
const isHttps = (v) => isStr(v) && /^https:\/\/[^\s<>"']+$/.test(v);

export function words(text) {
  return isStr(text) ? text.replace(/\{\{sub:0x[0-9a-f]{40}\}\}/g, "").split(/\s+/).filter(Boolean).length : 0;
}

/** Inline markup rules. Links must be https; citation chips must be full hashes. */
export function validateInline(text, path, { maxLen = 20000, allowParagraphs = true } = {}) {
  const e = [];
  if (!isStr(text)) return [`${path}: must be a string`];
  if (!text.trim()) e.push(`${path}: empty`);
  if (text.length > maxLen) e.push(`${path}: longer than ${maxLen} chars`);
  if (!allowParagraphs && text.includes("\n")) e.push(`${path}: line breaks not allowed`);
  if (/<[a-z!/]/i.test(text)) e.push(`${path}: contains HTML-like markup; use plain text`);
  for (const m of text.matchAll(/\[([^\]]*)\]\(([^)]*)\)/g)) {
    if (!isHttps(m[2])) e.push(`${path}: link target must be https: ${m[2].slice(0, 80)}`);
    if (!m[1].trim()) e.push(`${path}: link label empty`);
  }
  for (const m of text.matchAll(/\{\{([^}]*)\}\}/g)) {
    if (!/^sub:0x[0-9a-f]{40}$/.test(m[1])) e.push(`${path}: bad citation {{${m[1].slice(0, 60)}}}`);
  }
  return e;
}

export function citations(text) {
  return isStr(text) ? [...text.matchAll(/\{\{sub:(0x[0-9a-f]{40})\}\}/g)].map((m) => m[1]) : [];
}

function req(o, key, path, check, e) {
  if (!(key in o) || o[key] === undefined) {
    e.push(`${path}.${key}: required`);
    return false;
  }
  if (check && !check(o[key])) {
    e.push(`${path}.${key}: invalid`);
    return false;
  }
  return true;
}

export function validateSubmission(s, path = "submission") {
  const e = [];
  if (!isObj(s)) return [`${path}: must be an object`];
  req(s, "hash", path, (v) => HASH.test(v), e);
  req(s, "fid", path, (v) => Number.isInteger(v) && v > 0, e);
  req(s, "postedAt", path, (v) => ISO.test(v), e);
  req(s, "chapter", path, (v) => SLUG.test(v), e);
  req(s, "kind", path, (v) => SUB_KINDS.has(v), e);
  if (req(s, "gloss", path, isStr, e)) e.push(...validateInline(s.gloss, `${path}.gloss`, { maxLen: 400, allowParagraphs: false }));
  req(s, "embeds", path, (v) => Array.isArray(v) && v.every(isHttps), e);
  req(s, "url", path, (v) => isHttps(v) && v.startsWith("https://farcaster.xyz/"), e);
  if ("seconds" in s && !(Number.isInteger(s.seconds) && s.seconds > 0 && s.seconds < 3600)) e.push(`${path}.seconds: invalid`);
  if ("ai" in s && typeof s.ai !== "boolean") e.push(`${path}.ai: must be boolean`);
  if ("place" in s && !PLACES.has(s.place)) e.push(`${path}.place: invalid`);
  for (const k of ["site", "repo", "voucher"]) if (k in s && !isHttps(s[k])) e.push(`${path}.${k}: must be https`);
  if ("name" in s && !(isStr(s.name) && s.name.length <= 80)) e.push(`${path}.name: invalid`);
  return e;
}

export function validatePrize(p, path = "prize") {
  const e = [];
  if (!isObj(p)) return [`${path}: must be an object`];
  req(p, "id", path, (v) => SLUG.test(v), e);
  req(p, "kind", path, (v) => v === "prize" || v === "announcement", e);
  req(p, "castHash", path, (v) => HASH.test(v), e);
  req(p, "authorFid", path, (v) => Number.isInteger(v) && v > 0, e);
  req(p, "postedAt", path, (v) => ISO.test(v), e);
  req(p, "headline", path, (v) => isStr(v) && v.length > 0 && v.length <= 200, e);
  if ("chapter" in p && !SLUG.test(p.chapter)) e.push(`${path}.chapter: invalid`);
  if ("parentHash" in p && !HASH.test(p.parentHash)) e.push(`${path}.parentHash: invalid`);
  if ("deadline" in p && !ISO.test(p.deadline)) e.push(`${path}.deadline: invalid`);
  if ("status" in p && !PRIZE_STATUS.has(p.status)) e.push(`${path}.status: invalid`);
  if ("strands" in p && !(Array.isArray(p.strands) && p.strands.every((x) => SLUG.test(x)))) e.push(`${path}.strands: slugs only`);
  for (const k of ["gloss", "deliverable"]) if (k in p) e.push(...validateInline(p[k], `${path}.${k}`, { maxLen: 1200 }));
  if (p.kind === "prize") {
    req(p, "deadline", path, null, e);
    req(p, "chapter", path, null, e);
  }
  if ("results" in p) {
    const r = p.results;
    if (!isObj(r)) e.push(`${path}.results: must be an object`);
    else {
      req(r, "castHash", `${path}.results`, (v) => HASH.test(v), e);
      req(r, "postedAt", `${path}.results`, (v) => ISO.test(v), e);
      req(r, "places", `${path}.results`, Array.isArray, e);
      (r.places || []).forEach((pl, i) => {
        if (!PLACES.has(pl?.place)) e.push(`${path}.results.places[${i}].place: invalid`);
        if (!HASH.test(pl?.submission || "")) e.push(`${path}.results.places[${i}].submission: invalid`);
      });
    }
  }
  return e;
}

export function validateStrand(t, path = "strand") {
  const e = [];
  if (!isObj(t)) return [`${path}: must be an object`];
  req(t, "id", path, (v) => SLUG.test(v), e);
  req(t, "name", path, (v) => isStr(v) && v.length > 0 && v.length <= 40, e);
  if (req(t, "line", path, isStr, e)) e.push(...validateInline(t.line, `${path}.line`, { maxLen: 240, allowParagraphs: false }));
  if (req(t, "facet", path, isObj, e)) {
    if (!(isStr(t.facet.name) && t.facet.name.length > 0 && t.facet.name.length <= 30)) e.push(`${path}.facet.name: invalid`);
    e.push(...validateInline(t.facet.grant, `${path}.facet.grant`, { maxLen: 200, allowParagraphs: false }));
  }
  return e;
}

export function validatePerson(p, path = "person") {
  const e = [];
  if (!isObj(p)) return [`${path}: must be an object`];
  req(p, "fid", path, (v) => Number.isInteger(v) && v > 0, e);
  if ("username" in p && !(isStr(p.username) && /^[a-z0-9][a-z0-9._-]{0,63}$/.test(p.username))) e.push(`${path}.username: invalid`);
  if ("displayName" in p && !(isStr(p.displayName) && p.displayName.length <= 80)) e.push(`${path}.displayName: invalid`);
  return e;
}

/** Chapter rules. `strict` adds the editorial length/shape rules (used by the editorial gate). */
export function validateChapterDoc(c, path = "chapter", { strict = false } = {}) {
  const e = [];
  if (!isObj(c)) return [`${path}: must be an object`];
  req(c, "id", path, (v) => SLUG.test(v) && !RESERVED_IDS.has(v) && !/-(voices|essay|source|end)$/.test(v), e);
  req(c, "number", path, (v) => Number.isInteger(v) && v >= 0 && v <= 99, e);
  req(c, "kind", path, (v) => KINDS.has(v), e);
  req(c, "status", path, (v) => STATUS.has(v), e);
  req(c, "title", path, (v) => isStr(v) && v.length > 0 && v.length <= 40, e);
  req(c, "kicker", path, (v) => isStr(v) && v.length > 0 && v.length <= 60, e);
  if (req(c, "line", path, isStr, e)) e.push(...validateInline(c.line, `${path}.line`, { maxLen: 200, allowParagraphs: false }));
  if (req(c, "minute", path, isStr, e)) e.push(...validateInline(c.minute, `${path}.minute`, { maxLen: 2000 }));
  if (req(c, "essay", path, Array.isArray, e)) {
    c.essay.forEach((b, i) => {
      const bp = `${path}.essay[${i}]`;
      if (!isObj(b) || !["p", "h", "quote", "aside"].includes(b.type)) return e.push(`${bp}: bad block`);
      if (b.type === "h") {
        if (!(isStr(b.text) && b.text.length > 0 && b.text.length <= 80 && !b.text.includes("\n"))) e.push(`${bp}.text: heading ≤ 80 chars, one line`);
      } else e.push(...validateInline(b.text, `${bp}.text`, { maxLen: 4000 }));
      if (b.type === "quote") {
        if (!(isStr(b.cite) && b.cite.trim())) e.push(`${bp}.cite: required`);
        if (words(b.text) > 25) e.push(`${bp}: quotes must be ≤ 25 words`);
      }
    });
  }
  if ("source" in c) {
    const s = c.source;
    if (!isObj(s)) e.push(`${path}.source: must be an object`);
    else {
      req(s, "title", `${path}.source`, isStr, e);
      req(s, "author", `${path}.source`, isStr, e);
      req(s, "year", `${path}.source`, (v) => Number.isInteger(v) && v > 0 && v < 2100, e);
      if (req(s, "about", `${path}.source`, isStr, e)) e.push(...validateInline(s.about, `${path}.source.about`, { maxLen: 900 }));
      if ("read" in s && !isHttps(s.read)) e.push(`${path}.source.read: must be https`);
    }
  }
  req(c, "objections", path, Array.isArray, e);
  (c.objections || []).forEach((o, i) => {
    if (!isObj(o)) return e.push(`${path}.objections[${i}]: must be an object`);
    if (req(o, "claim", `${path}.objections[${i}]`, isStr, e)) e.push(...validateInline(o.claim, `${path}.objections[${i}].claim`, { maxLen: 900 }));
    if (req(o, "reply", `${path}.objections[${i}]`, isStr, e)) e.push(...validateInline(o.reply, `${path}.objections[${i}].reply`, { maxLen: 1200 }));
  });
  req(c, "terms", path, Array.isArray, e);
  (c.terms || []).forEach((t, i) => {
    if (!isObj(t) || !isStr(t.term) || !t.term.trim() || t.term.length > 60) return e.push(`${path}.terms[${i}].term: invalid`);
    e.push(...validateInline(t.def, `${path}.terms[${i}].def`, { maxLen: 400, allowParagraphs: false }));
    if (words(t.def) > 45) e.push(`${path}.terms[${i}].def: ≤ 45 words`);
  });
  if (req(c, "thread", path, isStr, e)) e.push(...validateInline(c.thread, `${path}.thread`, { maxLen: 900 }));
  if (req(c, "strands", path, (v) => Array.isArray(v) && v.length <= 2 && v.every((x) => SLUG.test(x)), e)) {
    if (new Set(c.strands).size !== c.strands.length) e.push(`${path}.strands: duplicates`);
  }
  if (req(c, "connections", path, Array.isArray, e)) {
    c.connections.forEach((x, i) => {
      const cp = `${path}.connections[${i}]`;
      if (!isObj(x)) return e.push(`${cp}: must be an object`);
      if (!SLUG.test(x.to || "")) e.push(`${cp}.to: invalid`);
      if (x.to === c.id) e.push(`${cp}.to: an idea cannot connect to itself`);
      if (!CONNECTION_KINDS.has(x.kind)) e.push(`${cp}.kind: one of ${[...CONNECTION_KINDS].join(", ")}`);
      e.push(...validateInline(x.why, `${cp}.why`, { maxLen: 240, allowParagraphs: false }));
    });
    if (new Set(c.connections.map((x) => x?.to)).size !== c.connections.length) e.push(`${path}.connections: one connection per target`);
  }
  if ("prize" in c && !SLUG.test(c.prize)) e.push(`${path}.prize: invalid`);
  if ("featured" in c && !(Array.isArray(c.featured) && c.featured.every((h) => HASH.test(h)))) e.push(`${path}.featured: full hashes only`);
  if ("practice" in c) {
    const p = c.practice;
    if (!isObj(p)) e.push(`${path}.practice: must be an object`);
    else {
      if (req(p, "prompt", `${path}.practice`, isStr, e)) e.push(...validateInline(p.prompt, `${path}.practice.prompt`, { maxLen: 900 }));
      if ("action" in p && !(isObj(p.action) && isStr(p.action.label) && isHttps(p.action.url))) e.push(`${path}.practice.action: label + https url`);
    }
  }
  if (strict && c.status === "published") {
    const mw = words(c.minute);
    if (mw < 110 || mw > 180) e.push(`${path}.minute: ${mw} words, want 110–180`);
    const ew = (c.essay || []).reduce((n, b) => n + (b.type === "h" ? 0 : words(b.text)), 0);
    const lo = c.kind === "chapter" ? 700 : 250;
    if (ew < lo || ew > 1400) e.push(`${path}.essay: ${ew} words, want ${lo}–1400`);
    const tw = words(c.thread);
    if (tw < 40 || tw > 90) e.push(`${path}.thread: ${tw} words, want 40–90`);
    if (c.kind === "chapter") {
      if ((c.objections || []).length < 1) e.push(`${path}.objections: at least 1`);
      if ((c.terms || []).length < 3) e.push(`${path}.terms: at least 3`);
      if (!c.source) e.push(`${path}.source: required for chapters`);
      if ((c.strands || []).length < 1) e.push(`${path}.strands: 1–2 required for published ideas`);
      if ((c.connections || []).length < 2) e.push(`${path}.connections: at least 2 for published ideas`);
      if (!c.prize) e.push(`${path}.prize: required for chapters`);
    }
  }
  return e;
}

export function validateBook(b, { strict = false } = {}) {
  const e = [];
  if (!isObj(b)) return ["book: must be an object"];
  if (b.version !== 1) e.push("book.version: must be 1");
  req(b, "generatedAt", "book", (v) => ISO.test(v), e);
  req(b, "title", "book", isStr, e);
  req(b, "subtitle", "book", isStr, e);
  if (req(b, "thesis", "book", isObj, e)) {
    e.push(...validateInline(b.thesis.line, "book.thesis.line", { maxLen: 300, allowParagraphs: false }));
    e.push(...validateInline(b.thesis.paragraph, "book.thesis.paragraph", { maxLen: 1500 }));
    if (!ISO.test(b.thesis.asOf || "")) e.push("book.thesis.asOf: ISO date required");
  }
  const strandIds = new Set();
  if (req(b, "strands", "book", Array.isArray, e)) {
    b.strands.forEach((t, i) => {
      e.push(...validateStrand(t, `book.strands[${i}]`));
      if (strandIds.has(t?.id)) e.push(`book.strands[${i}].id: duplicate`);
      strandIds.add(t?.id);
    });
  }
  const chapterIds = new Set();
  if (req(b, "chapters", "book", Array.isArray, e)) {
    b.chapters.forEach((c, i) => {
      e.push(...validateChapterDoc(c, `book.chapters[${i}]`, { strict }));
      if (chapterIds.has(c?.id)) e.push(`book.chapters[${i}].id: duplicate ${c.id}`);
      chapterIds.add(c?.id);
    });
    const nums = b.chapters.map((c) => c?.number);
    if (nums.some((n, i) => i > 0 && n <= nums[i - 1])) e.push("book.chapters: must be sorted by number, no duplicates");
  }
  if (req(b, "archetype", "book", isObj, e)) {
    req(b.archetype, "name", "book.archetype", isStr, e);
    if (req(b.archetype, "line", "book.archetype", isStr, e)) e.push(...validateInline(b.archetype.line, "book.archetype.line", { maxLen: 300 }));
  }
  if (req(b, "paths", "book", Array.isArray, e)) {
    if (!b.paths.some((p) => p?.id === "editors-path")) e.push('book.paths: "editors-path" required');
    b.paths.forEach((p, i) => {
      if (!isObj(p) || !SLUG.test(p.id || "") || !isStr(p.name)) return e.push(`book.paths[${i}]: id + name required`);
      e.push(...validateInline(p.line, `book.paths[${i}].line`, { maxLen: 300, allowParagraphs: false }));
      if (!Array.isArray(p.chapters) || !p.chapters.length) e.push(`book.paths[${i}].chapters: non-empty list required`);
      for (const id of p.chapters || []) if (!chapterIds.has(id)) e.push(`book.paths[${i}]: unknown chapter ${id}`);
    });
  }
  const prizeIds = new Set();
  if (req(b, "prizes", "book", Array.isArray, e)) {
    b.prizes.forEach((p, i) => {
      e.push(...validatePrize(p, `book.prizes[${i}]`));
      prizeIds.add(p?.id);
    });
  }
  const subHashes = new Set();
  if (req(b, "submissions", "book", Array.isArray, e)) {
    b.submissions.forEach((s, i) => {
      e.push(...validateSubmission(s, `book.submissions[${i}]`));
      if (subHashes.has(s?.hash)) e.push(`book.submissions[${i}].hash: duplicate`);
      subHashes.add(s?.hash);
    });
  }
  if (req(b, "people", "book", isObj, e)) {
    for (const [k, p] of Object.entries(b.people)) {
      e.push(...validatePerson(p, `book.people.${k}`));
      if (String(p?.fid) !== k) e.push(`book.people.${k}: key must equal String(fid)`);
    }
  }
  if (req(b, "provenance", "book", isObj, e)) {
    req(b.provenance, "nodes", "book.provenance", (v) => Array.isArray(v) && v.every(isHttps), e);
    req(b.provenance, "refreshedAt", "book.provenance", (v) => ISO.test(v), e);
  }
  // Cross-references: every citation and featured hash must exist; every chapter prize must exist.
  for (const c of b.chapters || []) {
    if (c?.prize && !prizeIds.has(c.prize)) e.push(`book: chapter ${c.id} references unknown prize ${c.prize}`);
    for (const t of c?.strands || []) if (!strandIds.has(t)) e.push(`book: chapter ${c.id} uses unknown strand ${t}`);
    for (const x of c?.connections || []) if (!chapterIds.has(x?.to)) e.push(`book: chapter ${c.id} connects to unknown chapter ${x?.to}`);
    for (const h of c?.featured || []) if (!subHashes.has(h)) e.push(`book: chapter ${c.id} features unknown submission ${h}`);
    const texts = [c?.line, c?.minute, c?.thread, ...(c?.essay || []).map((x) => x.text), ...(c?.objections || []).flatMap((o) => [o.claim, o.reply])];
    for (const t of texts) for (const h of citations(t)) if (!subHashes.has(h)) e.push(`book: chapter ${c.id} cites unknown submission ${h}`);
  }
  return e;
}

// CLI: node contract/validate.mjs <book.json | chapter.json ...> [--strict]
if (import.meta.url === `file://${process.argv[1]}`) {
  const { readFileSync } = await import("node:fs");
  const strict = process.argv.includes("--strict");
  let bad = 0;
  for (const f of process.argv.slice(2).filter((a) => !a.startsWith("--"))) {
    const doc = JSON.parse(readFileSync(f, "utf8"));
    const errs = "chapters" in doc ? validateBook(doc, { strict }) : validateChapterDoc(doc, f, { strict });
    console.log(errs.length ? `FAIL ${f}\n  ${errs.join("\n  ")}` : `PASS ${f}`);
    bad += errs.length ? 1 : 0;
  }
  process.exit(bad ? 1 : 0);
}
