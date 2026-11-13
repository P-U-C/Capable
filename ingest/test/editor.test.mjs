// S9 / S16 / S17: the editor's pull-request rules (ingest/bin/editor-check.mjs), on data and on real git diffs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkBranch, checkChanges, checkPull, FOUNDING_LESSONS, parseRawDiff, WORKS_PATH } from "../bin/editor-check.mjs";
import { ROOT } from "./helpers.mjs";

const SCRIPT = join(ROOT, "ingest/bin/editor-check.mjs");
const ok = (path, status = "M", newMode = "100644") => ({ oldMode: status === "A" ? "000000" : "100644", newMode: status === "D" ? "000000" : newMode, status, path });

test("branch names: editor/<yyyymmdd-hhmm> only", () => {
  assert.deepEqual(checkBranch("editor/20261112-1530"), []);
  for (const b of ["editor/x", "main", "editor/20261112-1530/x", "editor/2026111-1530", "editor/20261112-15300", "Editor/20261112-1530", "feature/20261112-1530", "", undefined, "editor/20261112-1530\n"]) assert.equal(checkBranch(b).length, 1, JSON.stringify(b));
});

test("paths: lesson files and works.json may be added or changed; nothing else", () => {
  assert.deepEqual(checkChanges([ok("content/lessons/know-your-exit.json", "A"), ok(WORKS_PATH), ok("content/lessons/own-your-exit.json")]), []);
  assert.deepEqual(checkChanges([ok("content/lessons/a-new-one.json", "D")]), [], "an editor-written lesson may be withdrawn");
  const bad = [
    ".github/workflows/refresh.yml",
    ".github/workflows/new.yml",
    "content/build/app.json",
    "content/build/book.json",
    "content/seed/prizes.json",
    "content/seed/people.json",
    "content/app.meta.json",
    "ingest/bin/editor-check.mjs",
    "contract/validate-app.mjs",
    "app/src/main.mjs",
    "scripts/gate.mjs",
    "docs/REFRESH.md",
    "package.json",
    "content/lessons/sub/x.json",
    "content/lessons/Bad_Name.json",
    "content/lessons/x.json.bak",
    "content/lessons/-x.json",
    "content/lessons/.json",
    "content/lessons/x.JSON",
    "content/lessons/../seed/prizes.json",
    "./content/lessons/x.json",
    "content/seed/works.json.tmp",
  ];
  for (const path of bad) {
    const errs = checkChanges([ok("content/lessons/fine.json", "A"), ok(path)]);
    assert.equal(errs.length, 1, path);
    assert.match(errs[0], /only content\/lessons\/<slug>\.json and content\/seed\/works\.json may change/, path);
  }
});

test("paths: no founding lesson or works.json is deleted; only regular files; no renames, copies or type changes", () => {
  for (const id of FOUNDING_LESSONS) assert.match(checkChanges([ok(`content/lessons/${id}.json`, "D")])[0], /a founding lesson may not be deleted/);
  assert.deepEqual(FOUNDING_LESSONS, ["own-your-exit", "friend-speech", "vote-with-your-feet", "what-lasts"]);
  assert.match(checkChanges([ok(WORKS_PATH, "D")])[0], /may not be deleted/);
  for (const mode of ["100755", "120000", "160000", "040000"]) assert.match(checkChanges([ok("content/lessons/x.json", "A", mode)])[0], new RegExp(`regular, non-executable file \\(mode ${mode}\\)`));
  for (const status of ["T", "R", "C", "U", "X"]) assert.match(checkChanges([{ ...ok("content/lessons/x.json"), status }])[0], /change type .* is not allowed/);
  assert.deepEqual(checkChanges([]), ["the pull request changes nothing"]);
  assert.deepEqual(checkChanges(undefined), ["the pull request changes nothing"]);
});

test("parseRawDiff reads git's -z records, and refuses what it cannot read", () => {
  const raw = ":100644 100644 aaaa bbbb M\0content/seed/works.json\0:000000 100644 0000 cccc A\0content/lessons/x y.json\0:100644 000000 dddd 0000 D\0content/lessons/z.json\0";
  assert.deepEqual(parseRawDiff(raw), [
    { oldMode: "100644", newMode: "100644", status: "M", path: "content/seed/works.json" },
    { oldMode: "000000", newMode: "100644", status: "A", path: "content/lessons/x y.json" },
    { oldMode: "100644", newMode: "000000", status: "D", path: "content/lessons/z.json" },
  ]);
  assert.deepEqual(parseRawDiff(""), []);
  assert.throws(() => parseRawDiff("garbage\0path\0"), /unreadable diff record/);
  assert.throws(() => parseRawDiff(":100644 100644 aaaa bbbb M\0"), /unreadable/);
});

/** A scratch repository on main with the founding lessons and works.json. */
function repo() {
  const dir = mkdtempSync(join(tmpdir(), "capable-editor-"));
  const git = (...a) => execFileSync("git", ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...a], { cwd: dir, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" } });
  git("init", "-q", "-b", "main");
  mkdirSync(join(dir, "content/lessons"), { recursive: true });
  mkdirSync(join(dir, "content/seed"), { recursive: true });
  for (const id of FOUNDING_LESSONS) writeFileSync(join(dir, `content/lessons/${id}.json`), `{"id":"${id}"}\n`);
  writeFileSync(join(dir, WORKS_PATH), "{}\n");
  git("add", "-A");
  git("commit", "-q", "-m", "base");
  git("checkout", "-q", "-b", "editor/20261112-1530");
  const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: dir, encoding: "utf8" });
  const commit = () => {
    git("add", "-A");
    git("commit", "-q", "-m", "edit");
  };
  return { dir, git, run, commit, done: () => rmSync(dir, { recursive: true, force: true }) };
}

test("CLI paths: a real editor branch passes; a workflow, a symlink, an executable or a deleted founding lesson fails it", () => {
  const r = repo();
  try {
    writeFileSync(join(r.dir, "content/lessons/know-your-exit.json"), '{"id":"know-your-exit"}\n');
    writeFileSync(join(r.dir, WORKS_PATH), '{"captions":{}}\n');
    r.commit();
    const good = r.run("paths", "--branch", "editor/20261112-1530", "--diff", "main...HEAD");
    assert.equal(good.status, 0, good.stderr);
    assert.match(good.stdout, /^editor-check: ok — 2 changes: A content\/lessons\/know-your-exit\.json, M content\/seed\/works\.json\n$/);
    assert.equal(r.run("paths", "--branch", "editor/20261112-1530", "--diff", "main..HEAD").status, 0, "two-dot form too");
    assert.equal(r.run("paths", "--branch", "main", "--diff", "main...HEAD").status, 1, "the branch name is checked too");
    const cases = [
      ["a workflow", () => (mkdirSync(join(r.dir, ".github/workflows"), { recursive: true }), writeFileSync(join(r.dir, ".github/workflows/x.yml"), "on: push\n")), /\.github\/workflows\/x\.yml.*only content\/lessons/],
      ["a symlink", () => symlinkSync("../seed/works.json", join(r.dir, "content/lessons/linked.json")), /linked\.json.*mode 120000/],
      ["an executable", () => (writeFileSync(join(r.dir, "content/lessons/run-me.json"), "{}\n"), chmodSync(join(r.dir, "content/lessons/run-me.json"), 0o755)), /run-me\.json.*mode 100755/],
      ["a deleted founding lesson", () => rmSync(join(r.dir, "content/lessons/what-lasts.json")), /what-lasts\.json.*founding lesson/],
      ["a renamed founding lesson", () => r.git("mv", "content/lessons/friend-speech.json", "content/lessons/friendly-speech.json"), /friend-speech\.json.*founding lesson/],
      ["build output", () => (mkdirSync(join(r.dir, "content/build"), { recursive: true }), writeFileSync(join(r.dir, "content/build/app.json"), "{}\n")), /content\/build\/app\.json/],
    ];
    for (const [what, change, why] of cases) {
      const base = r.git("rev-parse", "HEAD").trim();
      change();
      r.commit();
      const res = r.run("paths", "--branch", "editor/20261112-1530", "--diff", "main...HEAD");
      assert.equal(res.status, 1, `${what}: ${res.stdout}`);
      assert.match(res.stderr, /^editor-check: FAILED\n/, what);
      assert.match(res.stderr, why, what);
      r.git("reset", "-q", "--hard", base);
    }
  } finally {
    r.done();
  }
});

test("CLI: bad arguments exit 2 (a --diff that is not a revision range is never passed to git)", () => {
  const r = repo();
  try {
    for (const args of [[], ["nope"], ["paths"], ["paths", "--branch", "editor/20261112-1530"], ["paths", "--diff", "--output=/tmp/x..HEAD"], ["paths", "--diff", "main"], ["paths", "--diff", "main..HEAD;rm"], ["pr", "--file", "x.json"]]) {
      const res = r.run(...args);
      assert.equal(res.status, 2, args.join(" "));
      assert.match(res.stderr, /usage:/);
    }
  } finally {
    r.done();
  }
});

const pull = (over = {}) => ({
  number: 7,
  state: "open",
  draft: false,
  user: { login: "capable-editor" },
  base: { ref: "main" },
  head: { ref: "editor/20261112-1530", sha: "a".repeat(40), repo: { full_name: "P-U-C/Capable" } },
  ...over,
});
const expect = { repo: "P-U-C/Capable", branch: "editor/20261112-1530", headSha: "a".repeat(40), editor: "capable-editor" };

test("the pull request: opened by the editor, open, not a draft, from this repository's editor branch at the checked head, into main", () => {
  assert.deepEqual(checkPull(pull(), expect), []);
  const cases = [
    [pull({ user: { login: "someone-else" } }), expect, /not the editor capable-editor/],
    [pull(), { ...expect, editor: "" }, /no editor login is configured/],
    [pull(), { ...expect, editor: undefined }, /no editor login is configured/],
    [pull({ state: "closed" }), expect, /is closed, not open/],
    [pull({ draft: true }), expect, /a draft/],
    [pull({ base: { ref: "release" } }), expect, /targets release, not main/],
    [pull({ head: { ...pull().head, repo: { full_name: "fork/Capable" } } }), expect, /in fork\/Capable, not P-U-C\/Capable/],
    [pull({ head: { ...pull().head, repo: null } }), expect, /not P-U-C\/Capable/],
    [pull({ head: { ...pull().head, ref: "editor/20261112-1531" } }), expect, /not editor\/20261112-1530/],
    [pull({ head: { ...pull().head, ref: "evil" } }), { ...expect, branch: "evil" }, /is not editor\/<yyyymmdd-hhmm>/],
    [pull({ head: { ...pull().head, sha: "b".repeat(40) } }), expect, /not the checked a{40}/],
    [pull(), { ...expect, headSha: "short" }, /not the checked short/],
  ];
  for (const [pr, ex, why] of cases) {
    const errs = checkPull(pr, ex);
    assert.ok(errs.some((e) => why.test(e)), `${why}: ${errs.join(" | ")}`);
  }
});

test("CLI pr: reads the pull request JSON and exits 0 or 1", () => {
  const dir = mkdtempSync(join(tmpdir(), "capable-pr-"));
  try {
    const file = join(dir, "pull.json");
    const run = (pr, editor = "capable-editor") => {
      writeFileSync(file, JSON.stringify(pr));
      return spawnSync(process.execPath, [SCRIPT, "pr", "--file", file, "--repo", "P-U-C/Capable", "--branch", "editor/20261112-1530", "--head-sha", "a".repeat(40), "--editor", editor, "--base", "main"], { encoding: "utf8" });
    };
    const good = run(pull());
    assert.equal(good.status, 0, good.stderr);
    assert.match(good.stdout, /^editor-check: ok — pull request #7 by capable-editor at a{40}\n$/);
    const bad = run(pull({ user: { login: "mallory" } }));
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /opened by "mallory", not the editor capable-editor/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
