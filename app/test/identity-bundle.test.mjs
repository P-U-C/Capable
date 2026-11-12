// The identity module is light at first paint and heavy only on use: bundled
// the way the app should bundle it (esbuild, ESM, code splitting, the
// identity build plugin), the chunk the app imports holds no SDK, sign-in
// client, viem, zod or ox code; those land in lazy chunks loaded by import(),
// and the lazy chunks fit the budget in docs/SPEC-V3.md. Sizes are printed as
// test diagnostics.
import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { APP_DIR } from "./helpers.mjs";
import { identityBuildPlugin, LAZY_BUDGET } from "../src/identity/build-plugin.mjs";

const SRC = join(APP_DIR, "src/identity");
const HEAVY = /node_modules\/(@farcaster|viem|ox|zod|comlink|@noble|@scure|abitype|neverthrow|jose|eventemitter3|isows)\//;
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

const dir = mkdtempSync(join(tmpdir(), "capable-identity-bundle-"));
test.after(() => rmSync(dir, { recursive: true, force: true }));

async function bundle(plugins) {
  const entry = join(dir, "entry.mjs");
  writeFileSync(
    entry,
    `import { current, onChange, signOut, isMiniApp, ready, signIn, share, wallet, qrSvg } from ${JSON.stringify(join(SRC, "index.mjs"))};\n` +
      "globalThis.__identity = { current, onChange, signOut, isMiniApp, ready, signIn, share, wallet, qrSvg };\n",
  );
  const r = await build({
    entryPoints: [entry],
    bundle: true,
    splitting: true,
    format: "esm",
    platform: "browser",
    target: ["es2020", "safari15", "chrome100"],
    minify: true,
    legalComments: "none",
    outdir: join(dir, "out"),
    write: false,
    metafile: true,
    logLevel: "silent",
    plugins,
  });
  const outputs = r.metafile.outputs;
  const name = (p) => Object.keys(outputs).find((o) => outputs[o].entryPoint === p);
  const main = Object.keys(outputs).find((o) => outputs[o].entryPoint?.endsWith("entry.mjs"));
  // Everything a lazy entry pulls in with static imports: the bytes fetched when that flow runs.
  const closure = (start) => {
    const seen = new Set();
    const walk = (o) => {
      if (seen.has(o)) return;
      seen.add(o);
      for (const i of outputs[o].imports) if (i.kind === "import-statement" && outputs[i.path]) walk(i.path);
    };
    walk(start);
    return seen;
  };
  const bytes = (set) => [...set].reduce((n, o) => n + outputs[o].bytes, 0);
  const staticFromMain = closure(main);
  const lazy = Object.keys(outputs).filter((o) => !staticFromMain.has(o));
  const chunkOf = (file) => name(Object.keys(r.metafile.inputs).find((i) => i.endsWith(`identity/${file}`)));
  const flows = closure(chunkOf("flows.mjs"));
  const miniapp = new Set([...flows, ...closure(chunkOf("lazy-miniapp.mjs"))]);
  const auth = new Set([...flows, ...closure(chunkOf("lazy-auth.mjs"))]);
  for (const o of staticFromMain) flows.delete(o), miniapp.delete(o), auth.delete(o);
  return {
    outputs,
    main,
    staticFromMain,
    firstPaint: bytes(staticFromMain),
    lazyTotal: lazy.reduce((n, o) => n + outputs[o].bytes, 0),
    lazyFiles: lazy.length,
    flows: bytes(flows),
    miniapp: bytes(miniapp),
    auth: bytes(auth),
    inputsOf: (set) => [...set].flatMap((o) => Object.keys(outputs[o].inputs)),
  };
}

test("the identity source imports nothing heavy statically; the flows and the packages load through import()", () => {
  const read = (f) => readFileSync(join(SRC, f), "utf8");
  const imports = (f) => [...read(f).matchAll(/^\s*(?:import|export)\s[^;]*?from\s+"([^"]+)"/gm)].map((m) => m[1]).sort();
  const dynamic = (f) => [...read(f).matchAll(/import\("([^"]+)"\)/g)].map((m) => m[1]).sort();
  assert.deepEqual(imports("index.mjs"), ["./core.mjs", "./qr.mjs", "./store.mjs"]);
  assert.deepEqual(imports("core.mjs"), ["./store.mjs"]);
  assert.deepEqual(imports("store.mjs"), []);
  assert.deepEqual(imports("qr.mjs"), []);
  assert.deepEqual(imports("flows.mjs"), ["./core.mjs", "./store.mjs"]);
  assert.deepEqual(dynamic("index.mjs"), ["./flows.mjs"]);
  assert.deepEqual(dynamic("core.mjs"), ["./lazy-auth.mjs", "./lazy-miniapp.mjs"]);
  assert.deepEqual(imports("lazy-miniapp.mjs"), ["@farcaster/miniapp-sdk"]);
  assert.deepEqual(imports("lazy-auth.mjs"), ["@farcaster/auth-client"]);
});

test("bundled with splitting and the identity plugin: first paint has no SDK, lazy chunks fit the budget", { timeout: 60_000 }, async (t) => {
  const b = await bundle([identityBuildPlugin()]);
  const heavy = b.inputsOf(b.staticFromMain).filter((i) => HEAVY.test(i));
  assert.deepEqual(heavy, [], "no SDK / sign-in client / viem in the first-paint chunk");
  const ownInputs = b.inputsOf(b.staticFromMain).filter((i) => i.includes("identity/")).map((i) => i.replace(/.*identity\//, "")).sort();
  assert.deepEqual(ownInputs, ["core.mjs", "index.mjs", "qr.mjs", "store.mjs"], "the flows are not in first paint");
  assert.ok(b.firstPaint < 14 * 1024, `identity at first paint: ${kb(b.firstPaint)}`);
  assert.ok(b.lazyFiles >= 2, "the SDK and the sign-in client are separate chunks");
  assert.ok(b.lazyTotal <= LAZY_BUDGET, `lazy chunks ${kb(b.lazyTotal)} > ${kb(LAZY_BUDGET)}`);
  const lazyInputs = Object.values(b.outputs).flatMap((o) => Object.keys(o.inputs));
  assert.ok(!lazyInputs.some((i) => i.includes("node_modules/zod/")), "zod is dropped from the Mini App chunk");
  t.diagnostic(`identity in the first-paint bundle: ${kb(b.firstPaint)} (store, QR encoder, sync surface)`);
  t.diagnostic(`lazy, identity flows: ${kb(b.flows)}`);
  t.diagnostic(`lazy, Mini App on use (flows + SDK): ${kb(b.miniapp)}`);
  t.diagnostic(`lazy, web sign-in on use (flows + auth-client + viem): ${kb(b.auth)}`);
  t.diagnostic(`lazy, all chunk files (incl. viem's own on-demand chunks): ${kb(b.lazyTotal)} in ${b.lazyFiles} files, budget ${kb(LAZY_BUDGET)}`);
});

test("without the plugin the Mini App chunk carries zod, so the app's build must use it", { timeout: 60_000 }, async (t) => {
  const plain = await bundle([]);
  const withPlugin = await bundle([identityBuildPlugin()]);
  assert.deepEqual(plain.inputsOf(plain.staticFromMain).filter((i) => HEAVY.test(i)), [], "still lazy without it");
  assert.ok(plain.miniapp - withPlugin.miniapp > 300 * 1024, `plugin saves ${kb(plain.miniapp - withPlugin.miniapp)}`);
  t.diagnostic(`without the plugin: Mini App on use ${kb(plain.miniapp)}, all lazy ${kb(plain.lazyTotal)}`);
});
