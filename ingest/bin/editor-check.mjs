#!/usr/bin/env node
// The editor's pull-request rules (docs/REFRESH.md; review S9, S16, S17). Used by
// .github/workflows/editor.yml (read-only check of the pull request) and by
// .github/workflows/editor-merge.yml, which runs main's copy of this file, so a
// pull request cannot change the rules it is judged by.
//
//   node ingest/bin/editor-check.mjs paths --branch <editor/yyyymmdd-hhmm> --diff <rev>..<rev> | <rev>...<rev>
//       Every change between the two revisions (git diff --raw, no rename detection)
//       must add or modify a regular file content/lessons/<slug>.json or
//       content/seed/works.json; a lesson file may be deleted, except the four
//       founding lessons. Nothing else: no workflows, code, build output or links.
//   node ingest/bin/editor-check.mjs pr --file <pull.json> --repo <owner/name> --branch <b>
//                                      --head-sha <sha> --editor <login> [--base main]
//       The pull request (GitHub REST JSON) is open, not a draft, from this
//       repository's <b> at <sha> into <base>, and opened by <login>.
//
// Exit 0 and "editor-check: ok …" when every rule holds; exit 1 listing each
// broken rule otherwise; exit 2 on bad arguments. Reads only git objects and
// JSON: it never runs anything from the pull request.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

export const FOUNDING_LESSONS = Object.freeze(["own-your-exit", "friend-speech", "vote-with-your-feet", "what-lasts"]);
export const WORKS_PATH = "content/seed/works.json";
const LESSON_PATH = /^content\/lessons\/([a-z0-9]+(?:-[a-z0-9]+)*)\.json$/;
const BRANCH = /^editor\/\d{8}-\d{4}$/;
const SHA = /^[0-9a-f]{40}$/;
const REV = /^[0-9A-Za-z][0-9A-Za-z^~/._-]*$/;

/** The editor's branch name: editor/<yyyymmdd-hhmm>. */
export function checkBranch(name) {
  return typeof name === "string" && BRANCH.test(name) ? [] : [`branch ${JSON.stringify(String(name)).slice(0, 80)} is not editor/<yyyymmdd-hhmm>`];
}

/**
 * Parse `git diff --raw -z --no-renames --no-abbrev` output into
 * [{ oldMode, newMode, status, path }]. Throws on anything it cannot read.
 */
export function parseRawDiff(text) {
  const parts = String(text).split("\0");
  if (parts.at(-1) === "") parts.pop();
  const out = [];
  for (let i = 0; i < parts.length; i += 2) {
    const m = /^:(\d{6}) (\d{6}) [0-9a-f]+ [0-9a-f]+ ([A-Z])\d*$/.exec(parts[i]);
    if (!m || i + 1 >= parts.length) throw new Error(`unreadable diff record: ${JSON.stringify(parts[i]).slice(0, 80)}`);
    out.push({ oldMode: m[1], newMode: m[2], status: m[3], path: parts[i + 1] });
  }
  return out;
}

/** Every rule a change list breaks ([] when the pull request may be merged). */
export function checkChanges(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return ["the pull request changes nothing"];
  const errs = [];
  for (const e of entries) {
    const path = String(e?.path);
    const shown = JSON.stringify(path).slice(0, 120);
    const lesson = LESSON_PATH.exec(path);
    if (!lesson && path !== WORKS_PATH) {
      errs.push(`${shown}: only content/lessons/<slug>.json and ${WORKS_PATH} may change`);
      continue;
    }
    if (e.status === "D") {
      if (!lesson) errs.push(`${shown}: may not be deleted`);
      else if (FOUNDING_LESSONS.includes(lesson[1])) errs.push(`${shown}: a founding lesson may not be deleted`);
      continue;
    }
    if (e.status !== "A" && e.status !== "M") {
      errs.push(`${shown}: change type ${String(e.status).slice(0, 4)} is not allowed (only add, modify, or delete a lesson)`);
      continue;
    }
    if (e.newMode !== "100644") errs.push(`${shown}: must be a regular, non-executable file (mode ${String(e.newMode).slice(0, 6)})`);
  }
  return errs;
}

/** Every rule the pull request's metadata breaks ([] when it may be merged). */
export function checkPull(pr, { repo, branch, headSha, editor, base = "main" }) {
  const errs = [];
  if (typeof editor !== "string" || !editor.trim()) errs.push("no editor login is configured (repository variable EDITOR_LOGIN)");
  else if (pr?.user?.login !== editor) errs.push(`opened by ${JSON.stringify(String(pr?.user?.login)).slice(0, 60)}, not the editor ${editor}`);
  if (pr?.state !== "open") errs.push(`the pull request is ${String(pr?.state).slice(0, 20)}, not open`);
  if (pr?.draft !== false) errs.push("the pull request is a draft");
  if (pr?.base?.ref !== base) errs.push(`it targets ${String(pr?.base?.ref).slice(0, 60)}, not ${base}`);
  if (pr?.head?.repo?.full_name !== repo) errs.push(`its branch is in ${String(pr?.head?.repo?.full_name).slice(0, 80)}, not ${repo}`);
  if (pr?.head?.ref !== branch) errs.push(`its branch is ${String(pr?.head?.ref).slice(0, 80)}, not ${branch}`);
  errs.push(...checkBranch(pr?.head?.ref));
  if (!SHA.test(String(headSha)) || pr?.head?.sha !== headSha) errs.push(`its head is ${String(pr?.head?.sha).slice(0, 40)}, not the checked ${String(headSha).slice(0, 40)}`);
  return errs;
}

function args(argv) {
  const [cmd, ...rest] = argv;
  const o = { cmd };
  for (let i = 0; i < rest.length; i += 2) {
    if (!/^--[a-z-]+$/.test(rest[i]) || rest[i + 1] === undefined) throw new Error(`bad argument ${rest[i]}`);
    o[rest[i].slice(2)] = rest[i + 1];
  }
  return o;
}

function main(argv) {
  let o;
  try {
    o = args(argv);
    if (o.cmd === "paths") {
      if (!o.diff || !/^[^.]+\.{2,3}[^.]+$/.test(o.diff) || !o.diff.split(/\.{2,3}/).every((r) => REV.test(r))) throw new Error("--diff <rev>..<rev> or <rev>...<rev> is required");
    } else if (o.cmd === "pr") {
      for (const k of ["file", "repo", "branch", "head-sha"]) if (!o[k]) throw new Error(`--${k} is required`);
    } else throw new Error("first argument: paths | pr");
  } catch (err) {
    console.error(`editor-check: ${err.message}\nusage: editor-check.mjs paths --branch <b> --diff <a>..<b> | pr --file <pull.json> --repo <o/r> --branch <b> --head-sha <sha> --editor <login> [--base main]`);
    return 2;
  }
  let errs;
  if (o.cmd === "paths") {
    const raw = execFileSync("git", ["diff", "--raw", "-z", "--no-renames", "--no-abbrev", "--no-ext-diff", o.diff, "--"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    const entries = parseRawDiff(raw);
    errs = [...checkBranch(o.branch), ...checkChanges(entries)];
    if (!errs.length) console.log(`editor-check: ok — ${entries.length} change${entries.length === 1 ? "" : "s"}: ${entries.map((e) => `${e.status} ${e.path}`).join(", ")}`);
  } else {
    const pr = JSON.parse(readFileSync(o.file, "utf8"));
    errs = checkPull(pr, { repo: o.repo, branch: o.branch, headSha: o["head-sha"], editor: o.editor, base: o.base || "main" });
    if (!errs.length) console.log(`editor-check: ok — pull request #${pr.number} by ${pr.user.login} at ${pr.head.sha}`);
  }
  if (errs.length) console.error(`editor-check: FAILED\n  ${errs.join("\n  ")}`);
  return errs.length ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main(process.argv.slice(2)));
