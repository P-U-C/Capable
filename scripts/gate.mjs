#!/usr/bin/env node
// Agent-facing gate. Planner-owned. One line per step; last line is the verdict.
//   node scripts/gate.mjs --lane <ingest|web|editorial-a|editorial-b|review> [--base main] [--repeat N]
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const LANES = {
  ingest: [/^ingest\//, /^\.github\/workflows\//, /^content\/build\//],
  web: [/^web\//, /^docs\/WEB\.md$/],
  "editorial-a": [/^content\/chapters\/(prologue|exit|friend-speech)\.json$/],
  "editorial-b": [/^content\/chapters\/(feet|what-lasts|next-pick)\.json$/],
  review: [/^docs\/reviews\//],
  // v2: the swipe app
  "lessons-a": [/^content\/lessons\/(own-your-exit|friend-speech)\.json$/],
  "lessons-b": [/^content\/lessons\/(vote-with-your-feet|what-lasts)\.json$/],
  app: [/^app\//, /^docs\/APP\.md$/],
};
const PLANNER_ONLY = [
  /^contract\//, /^content\/seed\//, /^content\/book\.meta\.json$/, /^scripts\//, /^AGENTS\.md$/,
  /^docs\/(SPEC|DESIGN|SWARM|READINESS|SPEC-APP|READINESS-APP|REFRESH|REFRESH-PROMPT)\.md$/, /^content\/app\.meta\.json$/, /^package\.json$/, /^\.gitignore$/,
];
const PRIZES = { exit: "clients", "friend-speech": "civility", feet: "tiebout", "what-lasts": "nordhoff" };

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const lane = opt("--lane");
const base = opt("--base", "main");
const repeat = Number(opt("--repeat", "1"));
if (!LANES[lane]) {
  console.error(`usage: gate.mjs --lane <${Object.keys(LANES).join("|")}>`);
  process.exit(2);
}

const results = [];
const record = (status, step, detail = "", extra = []) => {
  results.push(status);
  console.log(`${status.padEnd(5)} ${step}${detail ? " — " + detail : ""}`);
  for (const x of extra.slice(0, 15)) console.log(`        ${x}`);
};
const git = (...a) => execFileSync("git", a, { cwd: ROOT, encoding: "utf8" }).trim();

function changedFiles() {
  let mergeBase;
  try { mergeBase = git("merge-base", base, "HEAD"); } catch { mergeBase = base; }
  const committed = git("diff", "--name-only", `${mergeBase}`, "--").split("\n");
  const untracked = git("ls-files", "--others", "--exclude-standard").split("\n");
  return [...new Set([...committed, ...untracked].filter(Boolean))];
}

function guards() {
  const files = changedFiles();
  const planner = files.filter((f) => PLANNER_ONLY.some((p) => p.test(f)));
  const outside = files.filter((f) => !LANES[lane].some((p) => p.test(f)) && !planner.includes(f));
  if (planner.length) record("HOLD", "guard:planner-only", "needs the planner", planner);
  else record("PASS", "guard:planner-only", "none touched");
  if (outside.length) record("FAIL", "guard:lane", `outside the ${lane} lane`, outside);
  else record("PASS", "guard:lane", `${files.length} changed files, all in ${lane}`);
  // Test integrity: no .skip/.only, no deleted tests.
  let mergeBase;
  try { mergeBase = git("merge-base", base, "HEAD"); } catch { mergeBase = base; }
  const deleted = git("diff", "--name-only", "--diff-filter=D", mergeBase, "--").split("\n").filter((f) => /\/test\//.test(f));
  const skipped = files.filter((f) => /\.test\.m?[jt]s$/.test(f) && existsSync(join(ROOT, f)))
    .filter((f) => /\b(it|test|describe)\.(skip|only)\b|\{\s*skip:\s*true|\btodo:\s*true/.test(readFileSync(join(ROOT, f), "utf8")));
  if (deleted.length || skipped.length) record("FAIL", "guard:test-integrity", "tests removed or skipped", [...deleted, ...skipped]);
  else record("PASS", "guard:test-integrity");
}

function run(step, cmd, argv, cwd = ROOT, env = {}) {
  const outs = [];
  for (let i = 0; i < repeat; i++) {
    const r = spawnSync(cmd, argv, { cwd, encoding: "utf8", env: { ...process.env, CI: "true", TZ: "UTC", ...env }, timeout: 600_000 });
    outs.push({ ok: r.status === 0, out: (r.stdout || "") + (r.stderr || "") });
  }
  const passes = outs.filter((o) => o.ok).length;
  if (passes === outs.length) record("PASS", step, repeat > 1 ? `${repeat}/${repeat}` : "");
  else if (passes > 0) record("FLAKY", step, `${passes}/${outs.length} passed`, tail(outs.find((o) => !o.ok).out));
  else record("FAIL", step, "", tail(outs[0].out));
}
const tail = (s) => s.trim().split("\n").slice(-15);

async function editorialChecks(files) {
  const v = await import(join(ROOT, "contract/validate.mjs"));
  const subs = JSON.parse(readFileSync(join(ROOT, "content/seed/submissions.json"), "utf8"));
  const prizes = JSON.parse(readFileSync(join(ROOT, "content/seed/prizes.json"), "utf8"));
  const subByHash = new Map(subs.map((s) => [s.hash, s]));
  const prizeIds = new Set(prizes.map((p) => p.id));
  const meta = JSON.parse(readFileSync(join(ROOT, "content/book.meta.json"), "utf8"));
  const strandIds = new Set(meta.strands.map((t) => t.id));
  const knownIds = new Set(["prologue", "next-pick", ...prizes.filter((p) => p.chapter).map((p) => p.chapter)]);
  for (const f of files) {
    const path = join(ROOT, "content/chapters", f);
    if (!existsSync(path)) { record("FAIL", `editorial:${f}`, "missing"); continue; }
    let doc;
    try { doc = JSON.parse(readFileSync(path, "utf8")); } catch (err) { record("FAIL", `editorial:${f}`, `bad JSON: ${err.message}`); continue; }
    const errs = v.validateChapterDoc(doc, f, { strict: true });
    const id = f.replace(/\.json$/, "");
    if (doc.id !== id) errs.push(`id must equal file name (${id})`);
    if ("facet" in doc) errs.push("facet is gone: facets live on strands; use strands: [...]");
    for (const t of doc.strands || []) if (!strandIds.has(t)) errs.push(`unknown strand ${t} (known: ${[...strandIds].join(", ")})`);
    for (const x of doc.connections || []) if (!knownIds.has(x.to)) errs.push(`connects to unknown idea ${x.to}`);
    const kinds = new Set((doc.connections || []).map((x) => x.kind));
    if (doc.kind === "chapter" && doc.status === "published" && kinds.size < 2) errs.push("use at least 2 different connection kinds");
    if (PRIZES[id] && doc.prize !== PRIZES[id]) errs.push(`prize must be ${PRIZES[id]}`);
    if (doc.prize && !prizeIds.has(doc.prize)) errs.push(`unknown prize ${doc.prize}`);
    const texts = [doc.line, doc.minute, doc.thread, ...(doc.essay || []).map((b) => b.text), ...(doc.objections || []).flatMap((o) => [o.claim, o.reply]), doc.practice?.prompt];
    const cited = texts.flatMap((t) => v.citations(t));
    for (const h of [...cited, ...(doc.featured || [])]) {
      const s = subByHash.get(h);
      if (!s) errs.push(`cites unknown submission ${h}`);
      else if (doc.kind === "chapter" && s.chapter !== id) errs.push(`cites ${h} from another chapter (${s.chapter})`);
    }
    if (doc.kind === "chapter" && new Set(cited).size < 4) errs.push(`essay cites ${new Set(cited).size} distinct submissions, want ≥ 4`);
    if (errs.length) record("FAIL", `editorial:${f}`, `${errs.length} problems`, errs);
    else record("PASS", `editorial:${f}`, `${(doc.essay || []).reduce((n, b) => n + (b.type === "h" ? 0 : v.words(b.text)), 0)} essay words, ${new Set(cited).size} voices cited, ${(doc.connections || []).length} connections`);
  }
}

async function lessonChecks(files) {
  const v = await import(join(ROOT, "contract/validate-app.mjs"));
  const meta = JSON.parse(readFileSync(join(ROOT, "content/app.meta.json"), "utf8"));
  const traits = new Set(meta.traits.map((t) => t.id));
  const want = { "own-your-exit": ["clients", "sovereign"], "friend-speech": ["civility", "civil"], "vote-with-your-feet": ["tiebout", "mobile"], "what-lasts": ["nordhoff", "enduring"] };
  for (const f of files) {
    const path = join(ROOT, "content/lessons", f);
    if (!existsSync(path)) { record("FAIL", `lesson:${f}`, "missing"); continue; }
    let doc;
    try { doc = JSON.parse(readFileSync(path, "utf8")); } catch (err) { record("FAIL", `lesson:${f}`, `bad JSON: ${err.message}`); continue; }
    const id = f.replace(/\.json$/, "");
    const errs = v.validateLessonDoc(doc, f, { strict: true });
    if (doc.id !== id) errs.push(`id must equal file name (${id})`);
    if (want[id] && (doc.topic !== want[id][0] || doc.trait !== want[id][1])) errs.push(`topic/trait must be ${want[id].join("/")}`);
    if (!traits.has(doc.trait)) errs.push(`unknown trait ${doc.trait}`);
    if (doc.status !== "ready") errs.push("status must be ready");
    const words = doc.cards?.reduce((n, c) => n + v.words(c.text) + v.words(c.heading) + v.words(c.def) + v.words(c.claim) + v.words(c.reply) + v.words(c.prompt) + (c.steps || []).reduce((m, x) => m + v.words(x), 0), 0);
    if (errs.length) record("FAIL", `lesson:${f}`, `${errs.length} problems`, errs);
    else record("PASS", `lesson:${f}`, `${doc.cards.length} cards, ${words} words`);
  }
}

console.log(`gate lane=${lane} base=${base} repeat=${repeat}`);
guards();
if (lane === "ingest") {
  run("ingest:test", "node", ["--test", "--test-reporter=dot", "ingest/test/"]);
  run("ingest:refresh-offline", "node", ["ingest/bin/refresh.mjs", "--offline", "--now", "2026-11-12T17:00:00Z", "--out", "/tmp/primer-gate-book.json"]);
  run("contract:book", "node", ["contract/validate.mjs", "/tmp/primer-gate-book.json"]);
} else if (lane === "web") {
  if (!existsSync(join(ROOT, "web/node_modules"))) run("web:install", "npm", ["ci", "--no-audit", "--no-fund"], join(ROOT, "web"));
  run("web:test", "npm", ["test", "--silent"], join(ROOT, "web"));
  run("web:build", "npm", ["run", "build", "--silent"], join(ROOT, "web"));
  const dist = join(ROOT, "web/dist/index.html");
  if (existsSync(dist)) {
    const size = statSync(dist).size;
    record(size < 3 * 1024 * 1024 ? "PASS" : "FAIL", "web:artifact-size", `${(size / 1024).toFixed(0)} KB`);
  } else record("FAIL", "web:artifact-size", "web/dist/index.html missing");
} else if (lane.startsWith("editorial")) {
  const mine = lane === "editorial-a" ? ["prologue.json", "exit.json", "friend-speech.json"] : ["feet.json", "what-lasts.json", "next-pick.json"];
  await editorialChecks(mine);
} else if (lane === "lessons-a" || lane === "lessons-b") {
  await lessonChecks(lane === "lessons-a" ? ["own-your-exit.json", "friend-speech.json"] : ["vote-with-your-feet.json", "what-lasts.json"]);
} else if (lane === "app") {
  if (!existsSync(join(ROOT, "app/node_modules"))) run("app:install", "npm", ["ci", "--no-audit", "--no-fund"], join(ROOT, "app"));
  run("app:test", "npm", ["test", "--silent"], join(ROOT, "app"));
  run("app:build", "npm", ["run", "build", "--silent"], join(ROOT, "app"));
  record(existsSync(join(ROOT, "app/dist/index.html")) ? "PASS" : "FAIL", "app:dist", "app/dist/index.html");
} else if (lane === "review") {
  const dir = join(ROOT, "docs/reviews");
  record(existsSync(dir) && readdirSync(dir).some((f) => f.endsWith(".md")) ? "PASS" : "FAIL", "review:report", "docs/reviews/*.md");
}

const verdict = results.includes("FAIL") || results.includes("FLAKY") ? "GATE FAIL" : results.includes("HOLD") ? "GATE HOLD" : "GATE PASS";
console.log(verdict);
process.exit(verdict === "GATE FAIL" ? 1 : 0);
