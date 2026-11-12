#!/usr/bin/env node
// Refresh content/build/book.json and content/build/app.json from seed + chapter
// and lesson files + (unless --offline) public Farcaster nodes.
//
//   node ingest/bin/refresh.mjs [--offline] [--now <ISO>] [--out <path>] [--app-out <path>]
//                               [--nodes a,b] [--chapters <dir>] [--lessons <dir>]
//
// Exit 0: compiled and written (or unchanged). Exit 1: a node failed, or the
// compiled book or app is invalid; nothing was written. Exit 2: bad arguments.

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runRefresh } from "../src/refresh.mjs";
import { NodeUnavailable, NodeHttpError } from "../src/node.mjs";
import { CompileError } from "../src/compile.mjs";
import { normalizeISO, isoFromMs } from "../src/time.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");
const USAGE = "usage: refresh.mjs [--offline] [--now <ISO-8601 UTC>] [--out <path>] [--app-out <path>] [--nodes <url,url>] [--chapters <dir>] [--lessons <dir>]";

function parseArgs(argv) {
  const opts = { offline: false };
  const takes = new Set(["--now", "--out", "--app-out", "--nodes", "--chapters", "--lessons"]);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--offline") opts.offline = true;
    else if (a === "--help" || a === "-h") opts.help = true;
    else if (takes.has(a)) {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) throw new Error(`${a} needs a value`);
      opts[a.slice(2)] = v;
    } else throw new Error(`unknown argument ${a}`);
  }
  return opts;
}

let opts;
try {
  opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(USAGE);
    process.exit(0);
  }
  // The clock is injected; the wall clock is only a default for interactive use.
  opts.now = opts.now ? normalizeISO(opts.now) : isoFromMs(Date.now());
  if (opts.nodes) {
    opts.nodes = opts.nodes.split(",").map((s) => s.trim()).filter(Boolean);
    for (const n of opts.nodes) if (!/^https?:\/\/[^\s]+$/.test(n)) throw new Error(`not a node URL: ${n}`);
  }
} catch (err) {
  console.error(`refresh: ${err.message}\n${USAGE}`);
  process.exit(2);
}

try {
  const res = await runRefresh({
    root: ROOT,
    out: resolve(opts.out || resolve(ROOT, "content/build/book.json")),
    appOut: opts["app-out"] ? resolve(opts["app-out"]) : opts.out ? undefined : resolve(ROOT, "content/build/app.json"),
    now: opts.now,
    offline: opts.offline,
    nodes: opts.nodes,
    chaptersDir: opts.chapters ? resolve(opts.chapters) : undefined,
    lessonsDir: opts.lessons ? resolve(opts.lessons) : undefined,
    warn: (m) => console.error(`refresh: warning: ${m}`),
  });
  console.log(res.summary);
  process.exit(res.code);
} catch (err) {
  const why =
    err instanceof NodeUnavailable ? `node unavailable — ${err.message}` :
    err instanceof NodeHttpError ? `node refused a request — ${err.message}` :
    err instanceof CompileError ? err.message :
    err?.message || String(err);
  console.error(`refresh: FAILED, nothing written: ${why}`);
  process.exit(1);
}
