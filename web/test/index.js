// `node --test test/` (the package's test script) names this directory. Node 22
// does not search a directory given as an argument, so it loads this file as
// the directory's entry point, and this file loads every *.test.mjs beside it.
import { readdirSync } from "node:fs";

const here = new URL(".", import.meta.url);
for (const f of readdirSync(here).filter((f) => f.endsWith(".test.mjs")).sort()) {
  await import(new URL(f, here));
}
