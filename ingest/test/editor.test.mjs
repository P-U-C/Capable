// S9 / S16 / S17 / V4 / V5 / V25: the editor's pull-request rules (ingest/bin/editor-check.mjs), on data and on real git diffs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkBranch, checkChanges, checkCommits, checkFileLinks, checkPull, decideMerge, findLinks, FOUNDING_LESSONS, GITHUB_COMMITTER, hostAllowed, LINK_HOSTS, linkProblem, parseRawDiff, WORKS_PATH } from "../bin/editor-check.mjs";
import { ROOT, runCli } from "./helpers.mjs";

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
    { oldMode: "100644", newMode: "100644", oldSha: "aaaa", newSha: "bbbb", status: "M", path: "content/seed/works.json" },
    { oldMode: "000000", newMode: "100644", oldSha: "0000", newSha: "cccc", status: "A", path: "content/lessons/x y.json" },
    { oldMode: "100644", newMode: "000000", oldSha: "dddd", newSha: "0000", status: "D", path: "content/lessons/z.json" },
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
  const commit = (message = "edit") => {
    git("add", "-A");
    git("commit", "-q", "-m", message);
    return git("rev-parse", "HEAD").trim();
  };
  const write = (path, content) => {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), typeof content === "string" ? content : `${JSON.stringify(content, null, 2)}\n`);
  };
  /** Run fn with main checked out, commit what it wrote to main, and come back to the editor branch. */
  const onMain = (fn, message = "main moves") => {
    git("checkout", "-q", "main");
    fn();
    const sha = commit(message);
    git("checkout", "-q", "editor/20261112-1530");
    return sha;
  };
  return { dir, git, run, commit, write, onMain, done: () => rmSync(dir, { recursive: true, force: true }) };
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
      // The reviewer's gitprobe (review v3): a gitlink and a path with a newline in it.
      ["a gitlink (submodule)", () => (mkdirSync(join(r.dir, "content/lessons/sub.json")), r.git("update-index", "--add", "--cacheinfo", `160000,${r.git("rev-parse", "main").trim()},content/lessons/sub.json`)), /sub\.json.*mode 160000/],
      ["a path with a newline", () => writeFileSync(join(r.dir, "content/lessons/evil.json\nx"), "{}\n"), /"content\/lessons\/evil\.json\\nx": only content\/lessons/],
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
    for (const args of [[], ["nope"], ["paths"], ["paths", "--branch", "editor/20261112-1530"], ["paths", "--diff", "--output=/tmp/x..HEAD"], ["paths", "--diff", "main"], ["paths", "--diff", "main..HEAD;rm"], ["pr", "--file", "x.json"], ["pr", "--file", "x.json", "--repo", "P-U-C/Capable", "--branch", "editor/20261112-1530", "--head-sha", "a".repeat(40)], ["current", "--base", "main"], ["current", "--base", "--upload-pack=x", "--head", "HEAD"], ["current", "--base", "main..HEAD", "--head", "HEAD"], ["ready", "--head", "HEAD"], ["ready", "--base", "-x", "--head", "HEAD"]]) {
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

const commit = (sha, author = "capable-editor", committer = author) => ({ sha, author: author === null ? null : { login: author }, committer: committer === null ? null : { login: committer } });

test("V25: every commit on the pull request was authored by the editor (committed by it, or by GitHub on its behalf)", () => {
  const ex = { editor: "capable-editor", headSha: "a".repeat(40) };
  assert.deepEqual(checkCommits([commit("a".repeat(40))], ex), []);
  assert.deepEqual(checkCommits([commit("b".repeat(40), "capable-editor", GITHUB_COMMITTER), commit("a".repeat(40))], ex), [], "made through the API, or an \"Update branch\" merge");
  assert.equal(GITHUB_COMMITTER, "web-flow");
  const cases = [
    [[commit("b".repeat(40), "mallory"), commit("a".repeat(40))], /commit bbbbbbbbbbbb was authored by "mallory", not the editor capable-editor/],
    [[commit("b".repeat(40), "mallory", "capable-editor"), commit("a".repeat(40))], /authored by "mallory"/],
    [[commit("b".repeat(40), "capable-editor", "mallory"), commit("a".repeat(40))], /committed by "mallory", not the editor capable-editor or GitHub/],
    [[commit("b".repeat(40), null), commit("a".repeat(40))], /authored by "undefined"/, "an email GitHub cannot tie to an account"],
    [[commit("b".repeat(40))], /the checked head a{40} is not one of the pull request's commits/],
    [[commit("a".repeat(40), GITHUB_COMMITTER)], /authored by "web-flow"/, "GitHub only ever commits for the editor, it never authors"],
    [[], /listed no commits/],
    [undefined, /listed no commits/],
    [Array.from({ length: 100 }, (_, i) => commit(i ? String(i).padStart(40, "0") : "a".repeat(40))), /100 commits or more/],
  ];
  for (const [commits, why, what] of cases) {
    const errs = checkCommits(commits, ex);
    assert.ok(errs.some((e) => why.test(e)), `${what || why}: ${errs.join(" | ")}`);
  }
  assert.match(checkCommits([commit("a".repeat(40))], { ...ex, editor: "" })[0], /not the editor/, "no editor login, no merge");
});

test("CLI pr: reads the pull request and its commits as JSON and exits 0 or 1", () => {
  const dir = mkdtempSync(join(tmpdir(), "capable-pr-"));
  try {
    const file = join(dir, "pull.json");
    const commits = join(dir, "commits.json");
    const run = (pr, list = [commit("a".repeat(40))], editor = "capable-editor") => {
      writeFileSync(file, JSON.stringify(pr));
      writeFileSync(commits, JSON.stringify(list));
      return spawnSync(process.execPath, [SCRIPT, "pr", "--file", file, "--commits", commits, "--repo", "P-U-C/Capable", "--branch", "editor/20261112-1530", "--head-sha", "a".repeat(40), "--editor", editor, "--base", "main"], { encoding: "utf8" });
    };
    const good = run(pull());
    assert.equal(good.status, 0, good.stderr);
    assert.match(good.stdout, /^editor-check: ok — pull request #7 by capable-editor at a{40}, 1 commit by the editor\n$/);
    const bad = run(pull({ user: { login: "mallory" } }));
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /opened by "mallory", not the editor capable-editor/);
    const pushedOnTop = run(pull(), [commit("a".repeat(40), "mallory")]);
    assert.equal(pushedOnTop.status, 1);
    assert.match(pushedOnTop.stderr, /commit aaaaaaaaaaaa was authored by "mallory"/);
    writeFileSync(commits, "not json");
    const unreadable = spawnSync(process.execPath, [SCRIPT, "pr", "--file", file, "--commits", commits, "--repo", "P-U-C/Capable", "--branch", "editor/20261112-1530", "--head-sha", "a".repeat(40), "--editor", "capable-editor"], { encoding: "utf8" });
    assert.equal(unreadable.status, 2);
    assert.match(unreadable.stderr, /cannot check/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// V5: which links an editor pull request may carry and still merge without a person.

test("V5 allow-list: the planner's hosts, and every source host of the four founding lessons", () => {
  assert.deepEqual([...LINK_HOSTS], ["wikipedia.org", "*.gov", "*.gov.uk", "*.edu", "*.ac.uk", "*.uscourts.gov", "archive.org", "arxiv.org", "doi.org", "jstor.org", "gutenberg.org", "law.justia.com", "gdpr-info.eu", "eur-lex.europa.eu", "hup.harvard.edu", "press.princeton.edu", "global.oup.com", "cambridge.org", "nature.com", "rcrwireless.com", "nybooks.com"]);
  assert.ok(Object.isFrozen(LINK_HOSTS));
  for (const id of FOUNDING_LESSONS) {
    const text = readFileSync(join(ROOT, "content/lessons", `${id}.json`), "utf8");
    const links = findLinks(JSON.parse(text));
    assert.ok(links.length >= 1, `${id} has sources`);
    assert.deepEqual(checkFileLinks(`content/lessons/${id}.json`, text), [], `${id}: ${links.map((l) => l.url).join(" ")}`);
  }
  assert.deepEqual(checkFileLinks(WORKS_PATH, readFileSync(join(ROOT, WORKS_PATH), "utf8")), [], "works.json as it is");
});

test("V5 host matcher: whole labels only (dot boundaries); *.x needs a label before .x; exact x also covers its subdomains", () => {
  const yes = ["en.wikipedia.org", "de.wikipedia.org", "wikipedia.org", "upload.wikimedia.org.wikipedia.org", "census.gov", "media.cadc.uscourts.gov", "www.gov.uk", "ox.ac.uk", "www.hup.harvard.edu", "mit.edu", "arxiv.org", "export.arxiv.org", "doi.org", "www.gutenberg.org", "law.justia.com", "eur-lex.europa.eu", "global.oup.com", "www.cambridge.org", "www.nature.com", "rcrwireless.com", "www.nybooks.com", "web.archive.org"];
  const no = [
    "evil.example", "evilwikipedia.org", "wikipedia.org.evil.com", "en.wikipedia.org.evil.com", "wikipedia.org-evil.com", "notarxiv.org", "arxiv.org.evil", "xarxiv.org",
    "gov", "edu", "gov.uk", "ac.uk", "uk", // a bare suffix is no host
    "evilgov", "gov.evil.com", "edu.evil.com", "harvard.edu.evil.com",
    "justia.com", "www.justia.com", "oup.com", "europa.eu", "princeton.edu.evil.com", // only the named host and its subdomains
    "en.wikipedia.org.", // a trailing dot waits for a person
    "EN.WIKIPEDIA.ORG", " en.wikipedia.org", "en.wikipedia.org ", "en..wikipedia.org", ".wikipedia.org", "-x.wikipedia.org", "x-.wikipedia.org", "a_b.wikipedia.org", // not a canonical hostname
    "1.2.3.4", "127.0.0.1", "[::1]", "", "x".repeat(250) + ".edu",
    "xn--wkipedia-c2a.org", // a look-alike, as punycode
  ];
  for (const h of yes) assert.equal(hostAllowed(h), true, h);
  for (const h of no) assert.equal(hostAllowed(h), false, JSON.stringify(h));
  for (const h of [undefined, null, 7, {}, ["en.wikipedia.org"]]) assert.equal(hostAllowed(h), false, String(h));
  assert.equal(hostAllowed("x.example", ["example"]), true, "an entry covers the hosts under it");
  assert.equal(hostAllowed("xexample", ["example"]), false);
  assert.equal(hostAllowed("example", ["*.example"]), false);
  assert.equal(hostAllowed("10.0.0.1", ["*.1", "0.1"]), false, "an IP address is never a listed host, whatever the list says");
});

test("V5 links: the browser's view of the URL decides (WHATWG parser): user info, ports, schemes, IDN/punycode and look-alike dots", () => {
  assert.equal(linkProblem("https://en.wikipedia.org/wiki/Exit,_Voice,_and_Loyalty"), null);
  assert.equal(linkProblem("HTTPS://EN.WIKIPEDIA.ORG/wiki/X"), null, "the parser lower-cases the host");
  assert.equal(linkProblem("https://en.wikipedia.org:443/wiki/X"), null, "the default port is no port");
  assert.equal(linkProblem("https://\uFF45n.wikipedia.org/"), null, "full-width letters map to the same ASCII host");
  assert.deepEqual(linkProblem("https://xn--n-itb.wikipedia.org/"), null, "a punycode label under an allowed domain is still that domain's");
  assert.deepEqual(linkProblem("https://\u0435n.wikipedia.org/"), null, "so is a Cyrillic label under it (it becomes xn--n-itb.wikipedia.org)");
  const held = [
    ["https://evil.example/claim", "evil.example", /allow-list/],
    ["https://en.wikipedia.org@evil.example/", "evil.example", /user info/],
    ["https://en.wikipedia.org:pw@evil.example/", "evil.example", /user info/],
    ["https://evil@en.wikipedia.org/", "en.wikipedia.org", /user info/],
    ["https://en.wikipedia.org:8443/", "en.wikipedia.org:8443", /a port/],
    ["https://en.wikipedia.org%2eevil.example/", "en.wikipedia.org.evil.example", /allow-list/],
    ["https://en.wikipedia.org\uFF0Eevil.example/", "en.wikipedia.org.evil.example", /allow-list/, "a full-width dot is a dot"],
    ["https://en.wikipedia.org\u3002evil.example/", "en.wikipedia.org.evil.example", /allow-list/, "an ideographic full stop is a dot"],
    ["https://evil.example\\@en.wikipedia.org/", "evil.example", /allow-list/, "a backslash ends the host, as in a browser"],
    ["https://evil.example#@en.wikipedia.org/", "evil.example", /allow-list/],
    ["https://evil.example?@en.wikipedia.org/", "evil.example", /allow-list/],
    ["https://wikiped\u0456a.org/", "xn--wikipeda-zhh.org", /allow-list/, "a Cyrillic look-alike becomes punycode, and is not wikipedia.org"],
    ["https://w\u00edkipedia.org/", "xn--wkipedia-c2a.org", /allow-list/],
    ["https://0x7f.1/", "127.0.0.1", /allow-list/],
    ["https://[::1]/", "[::1]", /allow-list/],
    ["http://en.wikipedia.org/", "http://en.wikipedia.org", /not https/],
    ["javascript:alert(1)", "javascript://", /not https/],
    ["data:text/html,x", "data://", /not https/],
    ["not a url", "not a url", /not a readable link/],
    ["https://", "https://", /not a readable link/],
  ];
  for (const [url, host, why, what] of held) {
    const p = linkProblem(url);
    assert.ok(p, `${what || url} is held`);
    assert.equal(p.host, host, url);
    assert.match(p.why, why, url);
  }
});

test("V5 links are found anywhere in a lesson file: url fields, links in text, www. runs, keys, any depth", () => {
  const doc = {
    id: "x",
    cards: [{ type: "idea", text: "Claim yours at https://evil.example/claim today, or www.other.example." }, { type: "story", heading: "h", text: "HTTPS://Shout.Example/x" }],
    sources: [{ title: "t", url: "https://en.wikipedia.org/wiki/X" }, { title: "u", url: "javascript:alert(1)" }],
    extra: { deep: [[{ href: "https://deep.example" }]], "https://key.example/": 1, "sneaky key": { imageSrc: "//cdn.example/x.png" } },
  };
  assert.deepEqual(findLinks(doc), [
    { where: "cards[0].text", url: "https://evil.example/claim" },
    { where: "cards[0].text", url: "https://www.other.example" },
    { where: "cards[1].text", url: "HTTPS://Shout.Example/x" },
    { where: "sources[0].url", url: "https://en.wikipedia.org/wiki/X" },
    { where: "sources[1].url", url: "javascript:alert(1)" },
    { where: "extra.deep[0][0].href", url: "https://deep.example" },
    { where: "extra.?", url: "https://key.example/" },
    { where: "extra.?.imageSrc", url: "//cdn.example/x.png" },
  ]);
  const problems = checkFileLinks("content/lessons/x.json", JSON.stringify(doc));
  assert.deepEqual([...new Set(problems.map((p) => p.host))].sort(), ["//cdn.example/x.png", "deep.example", "evil.example", "javascript://", "key.example", "shout.example", "www.other.example"]);
  assert.ok(problems.every((p) => p.file === "content/lessons/x.json"));
  // JSON escapes cannot hide a link: the parsed text is scanned, not the raw bytes.
  assert.deepEqual(checkFileLinks("f", '{"text":"see https:\\/\\/evil.example\\u002fx"}').map((p) => p.host), ["evil.example"]);
  assert.deepEqual(checkFileLinks("f", '{"text":"\\u0068ttps://evil.example"}').map((p) => p.host), ["evil.example"]);
  assert.deepEqual(checkFileLinks("f", "{ not json").map((p) => p.why), ["not valid JSON"]);
  assert.deepEqual(checkFileLinks("f", '{"captions":{"0xabc":"A short video on civility."}}'), [], "a caption without a link");
  assert.deepEqual(checkFileLinks("f", '{"text":"no scheme here: en.wikipedia.org"}'), [], "a bare domain is plain text, not a link");
  assert.deepEqual(checkFileLinks("f", '{"text":"Read it (https://en.wikipedia.org/wiki/X)."}'), [], "sentence punctuation after a link is not part of it");
  assert.deepEqual(checkFileLinks("f", '{"text":"Read https://evil.example."}').map((p) => p.host), ["evil.example"]);
});

test("V5 / V4 merge decision: merge only when main is still contained and no link needs a person; the comment is safe Markdown", () => {
  assert.deepEqual(decideMerge({}), { merge: true, hosts: [], body: "" });
  assert.deepEqual(decideMerge({ behind: null, links: [] }).merge, true);
  const links = [
    { file: "content/lessons/x.json", where: "sources[1].url", host: "evil.example", why: "not on the allow-list" },
    { file: "content/lessons/x.json", where: "cards[2].text", host: "evil.example", why: "not on the allow-list" },
    { file: WORKS_PATH, where: "captions.?", host: "a`b@c.example", why: "not on the allow-list" },
  ];
  const held = decideMerge({ links });
  assert.equal(held.merge, false);
  assert.deepEqual(held.hosts, ["a`b@c.example", "evil.example"]);
  assert.equal(held.body.split("\n")[0], "needs review: `a%60b%40c.example`, `evil.example`");
  assert.match(held.body, /not on the allow-list \(`LINK_HOSTS` in `ingest\/bin\/editor-check\.mjs`\)/);
  assert.match(held.body, /- `content\/lessons\/x\.json` `sources\[1\]\.url`: `evil\.example` \(not on the allow-list\)/);
  assert.ok(!/main moved/.test(held.body));
  assert.equal((held.body.match(/`/g) || []).length % 2, 0, "every code span is closed");
  assert.ok(!/@/.test(held.body), "no @mention can come from a pull request");
  const moved = decideMerge({ behind: "c".repeat(40) });
  assert.equal(moved.merge, false);
  assert.equal(moved.body.split("\n")[0], "not merged yet: main moved after this pull request was checked");
  assert.match(moved.body, /main moved to c{40} after it was checked/);
  const both = decideMerge({ behind: "c".repeat(40), links });
  assert.match(both.body, /^needs review: /);
  assert.match(both.body, /main moved to c{40}/);
  const many = decideMerge({ links: Array.from({ length: 25 }, (_, i) => ({ file: "f", where: "w", host: `h${String(i).padStart(2, "0")}.example`, why: "x" })) });
  assert.match(many.body.split("\n")[0], /`h19\.example`, and 5 more$/);
});

test("CLI current: the branch must contain main's head (review V4)", () => {
  const r = repo();
  try {
    r.write("content/lessons/know-your-exit.json", { id: "know-your-exit" });
    r.commit();
    const ok = r.run("current", "--base", "main", "--head", "HEAD");
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /^editor-check: ok — [0-9a-f]{40} contains main's head [0-9a-f]{40}\n$/);
    const moved = r.onMain(() => r.write("content/build/book.json", { generatedAt: "later" }));
    const behind = r.run("current", "--base", "main", "--head", "HEAD");
    assert.equal(behind.status, 1, behind.stdout);
    assert.match(behind.stderr, new RegExp(`the branch does not contain main's head ${moved}`));
    r.git("merge", "-q", "--no-edit", "main");
    assert.equal(r.run("current", "--base", "main", "--head", "HEAD").status, 0, "up to date again after merging main");
    const missing = r.run("current", "--base", "nope", "--head", "HEAD");
    assert.equal(missing.status, 2);
    assert.match(missing.stderr, /cannot check: nope is not a commit here/);
  } finally {
    r.done();
  }
});

test("CLI ready: merge only what was checked, and only with links to allowed hosts; otherwise hold it with the comment (review V4, V5)", () => {
  const r = repo();
  const out = join(r.dir, "..", `${r.dir.split("/").pop()}-hold.md`);
  const ready = () => {
    rmSync(out, { force: true });
    const res = r.run("ready", "--base", "main", "--head", "HEAD", "--out", out);
    return { ...res, body: existsSync(out) ? readFileSync(out, "utf8") : null };
  };
  const lesson = (urls, extra = {}) => ({ id: "know-your-exit", cards: [{ type: "idea", text: "Plain text." }], sources: urls.map((url, i) => ({ title: `s${i}`, url })), ...extra });
  try {
    // A new lesson whose sources are all on the allow-list, plus a caption: merge.
    r.write("content/lessons/know-your-exit.json", lesson(["https://en.wikipedia.org/wiki/Exit", "https://www.census.gov/x", "https://doi.org/10.1086/257839"]));
    r.write(WORKS_PATH, { captions: { "0xabc": "A short video on leaving well." } });
    r.commit();
    let res = ready();
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /^editor-check: ok — ready to merge: [0-9a-f]{40} contains main's head [0-9a-f]{40}, and every link is on the allow-list\n$/);
    assert.equal(res.body, "", "nothing to say");

    // One source elsewhere: hold, naming the host.
    r.write("content/lessons/know-your-exit.json", lesson(["https://en.wikipedia.org/wiki/Exit", "https://claim-your-stamp.example/mint"]));
    r.commit();
    res = ready();
    assert.equal(res.status, 1, res.stdout);
    assert.equal(res.body.split("\n")[0], "needs review: `claim-your-stamp.example`");
    assert.match(res.body, /`content\/lessons\/know-your-exit\.json` `sources\[1\]\.url`: `claim-your-stamp\.example`/);
    assert.match(res.stderr, /^editor-check: HOLD for a person\nneeds review: `claim-your-stamp\.example`/);

    // The same in a caption, or tucked into card text, of a works.json edit or a founding lesson's edit.
    r.write("content/lessons/know-your-exit.json", lesson(["https://en.wikipedia.org/wiki/Exit"]));
    r.write(WORKS_PATH, { captions: { "0xabc": "Claim yours at https://evil.example/x" } });
    r.commit();
    res = ready();
    assert.equal(res.status, 1);
    assert.match(res.body, /^needs review: `evil\.example`\n/);
    assert.match(res.body, /`content\/seed\/works\.json` `captions\.0xabc`/);
    r.write(WORKS_PATH, { captions: { "0xabc": "A short video on leaving well." } });
    r.write("content/lessons/what-lasts.json", { id: "what-lasts", cards: [{ type: "idea", text: "Read on at www.evil.example now." }] });
    r.commit();
    res = ready();
    assert.equal(res.status, 1);
    assert.match(res.body, /^needs review: `www\.evil\.example`\n/);

    // Withdrawing an editor lesson, and caption-only edits, still merge.
    r.git("checkout", "-q", "main", "--", "content/lessons/what-lasts.json");
    r.commit();
    assert.equal(ready().status, 0);
    r.git("rm", "-q", "content/lessons/know-your-exit.json");
    r.commit();
    assert.equal(ready().status, 0, "a deleted lesson has no links");

    // A link already on main, in a file this pull request does not touch, is not this pull request's.
    r.onMain(() => r.write("content/lessons/older.json", lesson(["https://older.example"], { id: "older" })));
    r.git("merge", "-q", "--no-edit", "main");
    r.write(WORKS_PATH, { captions: { "0xabc": "A short video on leaving." } });
    r.commit();
    res = ready();
    assert.equal(res.status, 0, res.stderr);

    // main moves after the check: hold, even with every link allowed.
    const moved = r.onMain(() => r.write("content/build/book.json", { generatedAt: "later" }));
    res = ready();
    assert.equal(res.status, 1);
    assert.equal(res.body.split("\n")[0], "not merged yet: main moved after this pull request was checked");
    assert.match(res.body, new RegExp(`main moved to ${moved}`));
    // ...and both reasons at once.
    r.write("content/lessons/know-your-exit.json", lesson(["https://evil.example"]));
    r.commit();
    res = ready();
    assert.equal(res.status, 1);
    assert.match(res.body, /^needs review: `evil\.example`\n[\s\S]*main moved to/);
    // Up to date with main again, and the link fixed: merge.
    r.git("merge", "-q", "--no-edit", "main");
    r.write("content/lessons/know-your-exit.json", lesson(["https://arxiv.org/abs/2402.03239"]));
    r.commit();
    assert.equal(ready().status, 0);
  } finally {
    rmSync(out, { force: true });
    r.done();
  }
});

test("V4: a lesson that clashes with one main gained after the branch was cut never merges, and is never dropped silently", async () => {
  const r = repo();
  const scratch = mkdtempSync(join(tmpdir(), "capable-clash-"));
  try {
    // The real lessons on main.
    r.git("checkout", "-q", "main");
    cpSync(join(ROOT, "content/lessons"), join(r.dir, "content/lessons"), { recursive: true });
    r.commit("the founding lessons");
    r.git("checkout", "-q", "editor/20261112-1530");
    r.git("merge", "-q", "--no-edit", "main");
    const model = JSON.parse(readFileSync(join(ROOT, "content/lessons/own-your-exit.json"), "utf8"));
    const next = Math.max(...FOUNDING_LESSONS.map((id) => JSON.parse(readFileSync(join(ROOT, "content/lessons", `${id}.json`), "utf8")).number)) + 1;
    // The editor writes lesson `next` on its branch; meanwhile another lesson with the same number lands on main.
    r.write("content/lessons/know-your-exit.json", { ...model, id: "know-your-exit", number: next, topic: "know-your-exit-topic" });
    r.commit("editor: know-your-exit");
    r.onMain(() => r.write("content/lessons/leave-well.json", { ...model, id: "leave-well", number: next, topic: "leave-well-topic" }), "another lesson");
    // editor.yml fails the branch as it is (behind main), and editor-merge.yml would hold it.
    assert.equal(r.run("current", "--base", "main", "--head", "HEAD").status, 1);
    assert.equal(r.run("ready", "--base", "main", "--head", "HEAD").status, 1);
    // Brought up to date, the files a merge would publish are exactly the files checked, and the strict compile refuses the clash.
    r.git("merge", "-q", "--no-edit", "main");
    assert.equal(r.run("current", "--base", "main", "--head", "HEAD").status, 0);
    const strict = await runCli(["--offline", "--strict-lessons", "--now", "2026-11-12T18:00:00Z", "--out", join(scratch, "book.json"), "--chapters", mkdtempSync(join(scratch, "ch-")), "--lessons", join(r.dir, "content/lessons")]);
    assert.equal(strict.code, 1, strict.stdout);
    assert.match(strict.stderr, new RegExp(`FAILED, nothing written: compiled app \\(lesson files\\) is invalid[\\s\\S]*number: ${next} already used by lesson`));
    // Without the clash it compiles.
    r.write("content/lessons/know-your-exit.json", { ...model, id: "know-your-exit", number: next + 1, topic: "know-your-exit-topic" });
    r.commit();
    const fixed = await runCli(["--offline", "--strict-lessons", "--now", "2026-11-12T18:00:00Z", "--out", join(scratch, "book.json"), "--chapters", mkdtempSync(join(scratch, "ch-")), "--lessons", join(r.dir, "content/lessons")]);
    assert.equal(fixed.code, 0, fixed.stderr);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
    r.done();
  }
});
