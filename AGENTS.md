# Agents working on capable

Read in this order:
1. docs/SWARM.md: how we work (lanes, the gate, reports).
2. docs/READINESS-APP.md: what done means.
3. docs/SPEC-APP.md: what we're building.
4. docs/DESIGN-APP.md: how it looks.
5. contract/app.d.ts and contract/validate-app.mjs.
6. v3 (citizens): docs/SPEC-V3.md, docs/READINESS-V3.md, contract/citizen.d.ts, contract/badge-art.mjs, docs/BADGE-ART.md.

- Work only inside your lane's paths (scripts/gate.mjs → LANES). Planner-owned paths are read-only.
- Run `node scripts/gate.mjs --lane <lane>` before you report, and paste its output.
- Use Node 22 and ESM (.mjs). No TypeScript compiler is required. Tests must not use the network.
- Reader-facing text never mentions the platform, prizes, competitions or rankings (`BANNED` in the validator). The only exception is identity UI (sign-in, share label, handle line), per docs/SPEC-V3.md.
- Never deploy contracts, hold keys or seed phrases, or send transactions. Test on a local chain only.
- Dependencies in app/package.json are planner-owned: ask the planner to add one.
- Never post anywhere, and never handle keys or seed phrases.

The atlas files (SPEC.md, DESIGN.md, READINESS.md, contract/book.d.ts, web/, content/chapters/) belong to the earlier version and are kept as source material.
