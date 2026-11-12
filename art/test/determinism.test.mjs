// R1 determinism: same input → same bytes, twice in-process and in a fresh process.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { corpus } from "./corpus.mjs";

const sha = (s) => createHash("sha256").update(s).digest("hex");

test("every generator returns identical bytes when called twice", () => {
  for (const [name, , fn] of corpus()) assert.equal(fn(), fn(), name);
});

test("a fresh Node process renders the same bytes", () => {
  const here = corpus().map(([name, , fn]) => [name, sha(fn())]);
  const url = new URL("./corpus.mjs", import.meta.url).href;
  const script = `import { createHash } from "node:crypto"; import { corpus } from ${JSON.stringify(url)};
    const sha = (s) => createHash("sha256").update(s).digest("hex");
    process.stdout.write(JSON.stringify(corpus().map(([name, , fn]) => [name, sha(fn())])));`;
  // a different TZ and locale must not matter either
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", env: { ...process.env, TZ: "Pacific/Chatham", LANG: "de_DE.UTF-8", LC_ALL: "de_DE.UTF-8" }, timeout: 60_000 });
  assert.equal(r.status, 0, r.stderr);
  const there = JSON.parse(r.stdout);
  assert.equal(there.length, here.length);
  for (let i = 0; i < here.length; i++) assert.deepEqual(there[i], here[i], here[i][0]);
});

test("no generator source uses Math.random, Date or locale formatting", () => {
  for (const f of ["../index.mjs", "../palette.mjs", "../lib/rand.mjs", "../lib/svg.mjs", "../lib/seal.mjs", "../lib/motifs.mjs", "../lib/scene.mjs", "../lib/portrait.mjs"]) {
    const src = readFileSync(new URL(f, import.meta.url), "utf8").replace(/\/\/.*$/gm, "");
    assert.doesNotMatch(src, /Math\.random|new Date|Date\.now|performance\.now|toLocale|Intl\./, f);
  }
});
