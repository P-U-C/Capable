# Agents working on Primer

Read, in order: docs/SWARM.md (how we work), docs/READINESS.md (what done means),
docs/SPEC.md (what we're building), docs/DESIGN.md (how it looks), contract/book.d.ts.

- Work only inside your lane's paths (docs/SWARM.md). Planner-owned paths are read-only.
- Run `node scripts/gate.mjs --lane <lane>` before you report; paste its output.
- Node 22, ESM (.mjs), no TypeScript compiler required. No network from tests.
- Never post to Farcaster, never handle keys or seed phrases.
