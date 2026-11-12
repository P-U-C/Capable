// Entry for `node --test art/test/` (scripts/gate.mjs, `npm test` in art/).
// On Node 22 a directory argument to --test runs as a module path, which
// resolves to this file (art/package.json is type: module). It imports every
// *.test.mjs here, so a new test file is picked up without editing this one.
// Each test file also runs on its own: node --test art/test/seal.test.mjs
import { readdirSync } from "node:fs";

const dir = new URL("./", import.meta.url);
for (const f of readdirSync(dir).filter((f) => f.endsWith(".test.mjs")).sort()) {
  await import(new URL(f, dir).href);
}
