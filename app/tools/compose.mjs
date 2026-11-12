#!/usr/bin/env node
// Dev tool: an App for screenshots with real lesson text. Takes the contract
// fixture (works, creators, the draft) and swaps in the decks written under
// content/lessons/. Not used by the build or the tests.
//   node tools/compose.mjs > /tmp/capable-real.json

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { validateApp } from "../../contract/validate-app.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const app = JSON.parse(readFileSync(join(ROOT, "contract/fixtures/app.sample.json"), "utf8"));
const dir = join(ROOT, "content/lessons");
const real = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(join(dir, f), "utf8"))) : [];
const byId = new Map(app.lessons.map((l) => [l.id, l]));
for (const doc of real) byId.set(doc.id, { ...doc, work: byId.get(doc.id)?.work ?? [] });
app.lessons = [...byId.values()].sort((a, b) => a.number - b.number);
const errors = validateApp(app);
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
process.stdout.write(JSON.stringify(app, null, 1));
