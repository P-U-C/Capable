// Entry point for `node --test ingest/test/` (the gate's command).
//
// On Node 22 a directory argument to `node --test` is not expanded into the test
// files inside it: it is run as a module, which resolves to this index.js. So
// this file loads every *.test.mjs in the directory, in name order, and the
// directory form runs the whole suite. `node --test ingest/test/*.test.mjs`
// runs the same tests file by file.
import { readdirSync } from "node:fs";

const dir = new URL("./", import.meta.url);
for (const f of readdirSync(dir).filter((name) => name.endsWith(".test.mjs")).sort()) {
  await import(new URL(f, dir).href);
}
