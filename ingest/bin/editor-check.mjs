#!/usr/bin/env node
// The editor's pull-request rules (docs/REFRESH.md; review S9, S16, S17, V4, V5, V25). Used by
// .github/workflows/editor.yml (read-only check of the pull request) and by
// .github/workflows/editor-merge.yml, which runs main's copy of this file, so a
// pull request cannot change the rules it is judged by.
//
//   node ingest/bin/editor-check.mjs paths --branch <editor/yyyymmdd-hhmm> --diff <rev>..<rev> | <rev>...<rev>
//       Every change between the two revisions (git diff --raw, no rename detection)
//       must add or modify a regular file content/lessons/<slug>.json or
//       content/seed/works.json; a lesson file may be deleted, except the four
//       founding lessons. Nothing else: no workflows, code, build output or links.
//   node ingest/bin/editor-check.mjs current --base <rev> --head <rev>
//       <head> contains <base> (main's head), so the tree checked at <head> is
//       exactly what a squash-merge onto <base> publishes (review V4).
//   node ingest/bin/editor-check.mjs pr --file <pull.json> --commits <commits.json> --repo <owner/name>
//                                      --branch <b> --head-sha <sha> --editor <login> [--base main]
//       The pull request (GitHub REST JSON) is open, not a draft, from this
//       repository's <b> at <sha> into <base>, opened by <login>, and every one of
//       its commits (GET /pulls/N/commits) was authored by <login> (review V25).
//   node ingest/bin/editor-check.mjs ready --base <rev> --head <rev> [--out <file>]
//       May the pull request merge without a person? Only if <head> still contains
//       <base> (main has not moved since the check, review V4) and every link in
//       each added or changed lesson file and in works.json is https to a host on
//       LINK_HOSTS (review V5). Exit 0: merge. Exit 1: hold it for a person; the
//       reasons ("needs review: <hosts>") go to stderr and, as the pull-request
//       comment, to <file>.
//
// Exit 0 and "editor-check: ok …" when every rule holds; exit 1 listing each
// broken rule otherwise; exit 2 on bad arguments or an unreadable repository.
// Reads only git objects and JSON: it never runs anything from the pull request.

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

export const FOUNDING_LESSONS = Object.freeze(["own-your-exit", "friend-speech", "vote-with-your-feet", "what-lasts"]);
export const WORKS_PATH = "content/seed/works.json";
const LESSON_PATH = /^content\/lessons\/([a-z0-9]+(?:-[a-z0-9]+)*)\.json$/;
const BRANCH = /^editor\/\d{8}-\d{4}$/;
const SHA = /^[0-9a-f]{40}$/;
const REV = /^[0-9A-Za-z][0-9A-Za-z^~/._-]*$/;
/** GitHub's own committer for commits made through its API or web UI (the editor's connector, "Update branch"). */
export const GITHUB_COMMITTER = "web-flow";
/** One page of GET /pulls/N/commits; a longer pull request is never the editor's. */
export const MAX_COMMITS = 100;
/** A lesson file or works.json larger than this is not read: it waits for a person. */
const MAX_FILE_BYTES = 1024 * 1024;

/**
 * Hosts an editor pull request may link to and still merge without a person (review V5).
 * "example.org" matches example.org and every host under it (en.example.org);
 * "*.gov" matches every host under .gov but not "gov" itself. Matching is on whole
 * labels of the hostname the WHATWG URL parser gives, which is what a browser opens:
 * lower case, an internationalized name as punycode ("xn--…"), no user info, no port.
 * The four founding lessons' sources are all covered (en.wikipedia.org, arxiv.org,
 * gdpr-info.eu, media.cadc.uscourts.gov, rcrwireless.com, census.gov, doi.org,
 * www.gutenberg.org, www.hup.harvard.edu, www.nybooks.com). Change this list on main,
 * by a person's pull request: the editor's paths can never touch this file.
 */
export const LINK_HOSTS = Object.freeze([
  "wikipedia.org",
  "*.gov",
  "*.gov.uk",
  "*.edu",
  "*.ac.uk",
  "*.uscourts.gov",
  "archive.org",
  "arxiv.org",
  "doi.org",
  "jstor.org",
  "gutenberg.org",
  "law.justia.com",
  "gdpr-info.eu",
  "eur-lex.europa.eu",
  "hup.harvard.edu",
  "press.princeton.edu",
  "global.oup.com",
  "cambridge.org",
  "nature.com",
  "rcrwireless.com",
  "nybooks.com",
]);

/** The editor's branch name: editor/<yyyymmdd-hhmm>. */
export function checkBranch(name) {
  return typeof name === "string" && BRANCH.test(name) ? [] : [`branch ${JSON.stringify(String(name)).slice(0, 80)} is not editor/<yyyymmdd-hhmm>`];
}

/**
 * Parse `git diff --raw -z --no-renames --no-abbrev` output into
 * [{ oldMode, newMode, oldSha, newSha, status, path }]. Throws on anything it cannot read.
 */
export function parseRawDiff(text) {
  const parts = String(text).split("\0");
  if (parts.at(-1) === "") parts.pop();
  const out = [];
  for (let i = 0; i < parts.length; i += 2) {
    const m = /^:(\d{6}) (\d{6}) ([0-9a-f]+) ([0-9a-f]+) ([A-Z])\d*$/.exec(parts[i]);
    if (!m || i + 1 >= parts.length) throw new Error(`unreadable diff record: ${JSON.stringify(parts[i]).slice(0, 80)}`);
    out.push({ oldMode: m[1], newMode: m[2], oldSha: m[3], newSha: m[4], status: m[5], path: parts[i + 1] });
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

/**
 * Every rule the pull request's commits (GitHub REST GET /pulls/N/commits) break (review V25):
 * each was authored by the editor and committed by the editor or by GitHub on its behalf
 * (its API, "Update branch"); the checked head is one of them; they fit in one page.
 * A commit anyone else added to the branch means a person merges it.
 */
export function checkCommits(commits, { editor, headSha }) {
  if (!Array.isArray(commits) || commits.length === 0) return ["GitHub listed no commits for the pull request"];
  if (commits.length >= MAX_COMMITS) return [`${commits.length} commits or more: more than the editor ever makes`];
  const errs = [];
  const who = (c, k) => JSON.stringify(String(c?.[k]?.login)).slice(0, 60);
  for (const c of commits) {
    const sha = String(c?.sha).slice(0, 12);
    if (typeof editor !== "string" || !editor.trim() || c?.author?.login !== editor) errs.push(`commit ${sha} was authored by ${who(c, "author")}, not the editor ${editor}`);
    if (c?.committer?.login !== editor && c?.committer?.login !== GITHUB_COMMITTER) errs.push(`commit ${sha} was committed by ${who(c, "committer")}, not the editor ${editor} or GitHub`);
  }
  if (!SHA.test(String(headSha)) || !commits.some((c) => c?.sha === headSha)) errs.push(`the checked head ${String(headSha).slice(0, 40)} is not one of the pull request's commits`);
  return errs;
}

/** Is `host` (a WHATWG URL hostname: lower-case ASCII, IDN as punycode) on the allow-list? Whole labels only. */
export function hostAllowed(host, list = LINK_HOSTS) {
  if (typeof host !== "string" || host.length > 253) return false;
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(host)) return false;
  if (/^[0-9.]+$/.test(host)) return false;
  return list.some((entry) => {
    const wildcard = entry.startsWith("*.");
    const suffix = wildcard ? entry.slice(2) : entry;
    return (!wildcard && host === suffix) || host.endsWith(`.${suffix}`);
  });
}

/** Why a link may not merge without a person, or null when it may: { host, why }. */
export function linkProblem(raw, list = LINK_HOSTS) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return { host: String(raw).slice(0, 60), why: "not a readable link" };
  }
  if (u.protocol !== "https:") return { host: `${u.protocol}//${u.hostname}`, why: "not https" };
  if (u.username || u.password) return { host: u.hostname, why: "user info before the host" };
  if (u.port) return { host: `${u.hostname}:${u.port}`, why: "a port" };
  if (!hostAllowed(u.hostname, list)) return { host: u.hostname, why: "not on the allow-list" };
  return null;
}

/** A scheme://… or www.… run inside any text: what a reader could copy or a renderer could link. */
const URLISH = /[a-z][a-z0-9+.-]*:\/\/[^\s"'<>`]*|\bwww\.[^\s"'<>`]*/giu;
/** Keys whose whole value is a link (sources[].url, and any other *url/*href/*src/*link field). */
const URL_KEY = /(?:url|uri|href|src|link)$/i;
const SAFE_KEY = /^[A-Za-z0-9_]{1,40}$/;

/** Every link in a parsed JSON document (keys and values, any depth): [{ where, url }]. */
export function findLinks(doc) {
  const out = [];
  const walk = (v, where, key) => {
    if (typeof v === "string") {
      if (key !== undefined && URL_KEY.test(key)) out.push({ where, url: v });
      else {
        for (const m of v.matchAll(URLISH)) {
          const url = m[0].replace(/[.,;:!?)\]]+$/u, ""); // sentence punctuation after a link, as a linkifier reads it
          out.push({ where, url: /^www\./i.test(url) ? `https://${url}` : url });
        }
      }
    } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${where}[${i}]`));
    else if (v !== null && typeof v === "object") {
      for (const k of Object.keys(v)) {
        const at = `${where}.${SAFE_KEY.test(k) ? k : "?"}`;
        walk(k, at); // a link hidden in a key
        walk(v[k], at, k);
      }
    }
  };
  walk(doc, "");
  return out.map((l) => ({ ...l, where: l.where.replace(/^\./, "") || "(the file)" }));
}

/** Every link in a file's text that needs a person: [{ file, where, host, why }]. */
export function checkFileLinks(file, text, list = LINK_HOSTS) {
  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    return [{ file, where: "(the file)", host: "(not valid JSON)", why: "not valid JSON" }];
  }
  const out = [];
  for (const { where, url } of findLinks(doc)) {
    const p = linkProblem(url, list);
    if (p) out.push({ file, where, ...p });
  }
  return out;
}

/** Text from a pull request, made safe to put inside `code` in a Markdown comment. */
const shown = (s) =>
  "`" +
  String(s)
    .slice(0, 120)
    .replace(/[^a-z0-9.:/_?[\]-]/giu, (c) => [...new TextEncoder().encode(c)].map((b) => `%${b.toString(16).toUpperCase().padStart(2, "0")}`).join("")) +
  "`";

/**
 * The merge decision (review V4, V5): { merge, hosts, body }. `behind` is main's new head
 * when the branch no longer contains it; `links` are checkFileLinks results. The body is
 * the pull-request comment; its first line is "needs review: <hosts>" when a link holds it.
 */
export function decideMerge({ behind = null, links = [] }) {
  const hosts = [...new Set(links.map((l) => l.host))].sort();
  if (!behind && hosts.length === 0) return { merge: true, hosts, body: "" };
  const lines = [];
  if (hosts.length) lines.push(`needs review: ${hosts.slice(0, 20).map(shown).join(", ")}${hosts.length > 20 ? `, and ${hosts.length - 20} more` : ""}`, "");
  else lines.push("not merged yet: main moved after this pull request was checked", "");
  lines.push("The editor check passed, but this pull request was not merged automatically:", "");
  if (hosts.length) {
    lines.push(`- it links to hosts that are not on the allow-list (\`LINK_HOSTS\` in \`ingest/bin/editor-check.mjs\`). Open each link and check it, then merge the pull request yourself or close it.`);
    for (const l of links.slice(0, 40)) lines.push(`  - ${shown(l.file)} ${shown(l.where)}: ${shown(l.host)} (${l.why})`);
  }
  if (behind) lines.push(`- main moved to ${String(behind).slice(0, 40)} after it was checked, so the checked files are not what a merge would publish. Bring the branch up to date with main (for example "Update branch"), and the next push checks it again.`);
  return { merge: false, hosts, body: `${lines.join("\n")}\n` };
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

const git = (argv, opts = {}) => execFileSync("git", argv, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"], ...opts });
const commitOf = (rev) => {
  const r = spawnSync("git", ["rev-parse", "--verify", "--quiet", "--end-of-options", `${rev}^{commit}`], { encoding: "utf8" });
  const sha = r.status === 0 ? r.stdout.trim() : "";
  if (!SHA.test(sha)) throw new Error(`${rev} is not a commit here`);
  return sha;
};
/** Does `head` contain `base`? */
function contains(base, head) {
  const r = spawnSync("git", ["merge-base", "--is-ancestor", base, head], { encoding: "utf8" });
  if (r.status === 0) return true;
  if (r.status === 1) return false;
  throw new Error(`git merge-base: ${String(r.stderr).trim().slice(0, 200)}`);
}
const rawDiff = (range) => parseRawDiff(git(["diff", "--raw", "-z", "--no-renames", "--no-abbrev", "--no-ext-diff", range, "--"]));

/** The links that hold a pull request, read from the git objects of every added or changed lesson file and works.json. */
function linksAt(base, head) {
  const out = [];
  for (const e of rawDiff(`${base}...${head}`)) {
    if (e.status !== "A" && e.status !== "M") continue;
    if (!LESSON_PATH.test(e.path) && e.path !== WORKS_PATH) continue;
    if (!SHA.test(e.newSha) || Number(git(["cat-file", "-s", e.newSha]).trim()) > MAX_FILE_BYTES) {
      out.push({ file: e.path, where: "(the file)", host: "(file too large to check)", why: "larger than 1 MB" });
      continue;
    }
    out.push(...checkFileLinks(e.path, git(["cat-file", "blob", e.newSha])));
  }
  return out;
}

const USAGE = [
  "usage: editor-check.mjs paths --branch <b> --diff <a>..<b>",
  "     | editor-check.mjs current --base <rev> --head <rev>",
  "     | editor-check.mjs pr --file <pull.json> --commits <commits.json> --repo <o/r> --branch <b> --head-sha <sha> --editor <login> [--base main]",
  "     | editor-check.mjs ready --base <rev> --head <rev> [--out <file>]",
].join("\n");

function main(argv) {
  let o;
  try {
    o = args(argv);
    if (o.cmd === "paths") {
      if (!o.diff || !/^[^.]+\.{2,3}[^.]+$/.test(o.diff) || !o.diff.split(/\.{2,3}/).every((r) => REV.test(r))) throw new Error("--diff <rev>..<rev> or <rev>...<rev> is required");
    } else if (o.cmd === "current" || o.cmd === "ready") {
      for (const k of ["base", "head"]) if (!o[k] || !REV.test(o[k]) || o[k].includes("..")) throw new Error(`--${k} <rev> is required`);
    } else if (o.cmd === "pr") {
      for (const k of ["file", "commits", "repo", "branch", "head-sha"]) if (!o[k]) throw new Error(`--${k} is required`);
    } else throw new Error("first argument: paths | current | pr | ready");
  } catch (err) {
    console.error(`editor-check: ${err.message}\n${USAGE}`);
    return 2;
  }
  let errs;
  try {
    if (o.cmd === "paths") {
      const entries = rawDiff(o.diff);
      errs = [...checkBranch(o.branch), ...checkChanges(entries)];
      if (!errs.length) console.log(`editor-check: ok — ${entries.length} change${entries.length === 1 ? "" : "s"}: ${entries.map((e) => `${e.status} ${e.path}`).join(", ")}`);
    } else if (o.cmd === "current") {
      const [base, head] = [commitOf(o.base), commitOf(o.head)];
      errs = contains(base, head) ? [] : [`the branch does not contain main's head ${base}, so what was checked is not what a merge would publish: bring it up to date with main (merge main into it, or start it again from main's head) and push`];
      if (!errs.length) console.log(`editor-check: ok — ${head} contains main's head ${base}`);
    } else if (o.cmd === "pr") {
      const pr = JSON.parse(readFileSync(o.file, "utf8"));
      const commits = JSON.parse(readFileSync(o.commits, "utf8"));
      errs = [...checkPull(pr, { repo: o.repo, branch: o.branch, headSha: o["head-sha"], editor: o.editor, base: o.base || "main" }), ...checkCommits(commits, { editor: o.editor, headSha: o["head-sha"] })];
      if (!errs.length) console.log(`editor-check: ok — pull request #${pr.number} by ${pr.user.login} at ${pr.head.sha}, ${commits.length} commit${commits.length === 1 ? "" : "s"} by the editor`);
    } else {
      const [base, head] = [commitOf(o.base), commitOf(o.head)];
      const d = decideMerge({ behind: contains(base, head) ? null : base, links: linksAt(base, head) });
      if (o.out) writeFileSync(o.out, d.body);
      if (d.merge) {
        console.log(`editor-check: ok — ready to merge: ${head} contains main's head ${base}, and every link is on the allow-list`);
        return 0;
      }
      console.error(`editor-check: HOLD for a person\n${d.body}`);
      return 1;
    }
  } catch (err) {
    console.error(`editor-check: cannot check: ${String(err.message).slice(0, 300)}`);
    return 2;
  }
  if (errs.length) console.error(`editor-check: FAILED\n  ${errs.join("\n  ")}`);
  return errs.length ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main(process.argv.slice(2)));
