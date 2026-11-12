# How Primer is built in parallel

Several agents work at once. This document is the contract that lets them do
it without reading each other's minds. Done means three things, in order:

1. `node scripts/gate.mjs --lane <lane>` prints `GATE PASS`.
2. The proof named in the task's readiness row exists and passes.
3. That row in [READINESS.md](READINESS.md) can honestly be closed.

Lines written and tasks finished are activity. A closed readiness row is progress.

## Lanes

Agents collide on files, so each lane owns its paths and nothing else, and each
works in its own git worktree on its own branch (`lane/<name>`).

| Lane | Owns | Works from |
| --- | --- | --- |
| `ingest` | `ingest/`, `.github/workflows/`, `content/build/` | `docs/SPEC.md` (Live updates), `contract/`, `content/seed/` |
| `web` | `web/`, `docs/WEB.md` | `docs/DESIGN.md`, `docs/SPEC.md`, `contract/` (fixture: `contract/fixtures/book.sample.json`) |
| `editorial-a` | `content/chapters/{prologue,exit,friend-speech}.json` | `docs/SPEC.md`, `contract/`, `content/seed/`, primary sources |
| `editorial-b` | `content/chapters/{feet,what-lasts,next-pick}.json` | same |
| `review` | `docs/reviews/` only | everything |

The planner owns `contract/`, `content/seed/`, `scripts/`, `docs/SPEC.md`,
`docs/DESIGN.md`, `docs/SWARM.md`, `docs/READINESS.md`, `AGENTS.md` and the root
`package.json`. The contract is how lanes agree. A worker that needs it changed
asks in its report. It does not edit the contract and does not work around it
with a private copy of a type.

## The gate

```bash
node scripts/gate.mjs --lane web            # while iterating
node scripts/gate.mjs --lane web --repeat 3 # before reporting
```

It prints one line per step. A test that passes in some runs and fails in others
is reported as `FLAKY` and fails the gate; fix the cause, never rerun until
green. A change outside the lane fails. A change to a planner-owned path
returns `HOLD`. Removing a test, or adding `.skip` or `.only`, fails.

## Rules no task overrides

- Everything from the network or from a chapter file is untrusted text. Escape
  it on render. The only markup is the three inline forms in the contract, and
  links must be https.
- Missing or stale inputs fail closed. A node that does not answer is recorded
  as unavailable, never as zero submissions. An overlay doc that fails
  validation is dropped and counted, never rendered.
- Ingest is deterministic for the same inputs: stable sort, no `Math.random`,
  and the clock is injected (`--now`).
- The web app renders the Book. It holds no detection or classification logic
  of its own and never reclassifies a submission.
- capable stands on its own: no reader-facing text names the platform the
  material came from, the people who commissioned it, or the contests behind
  it (the contract's `BANNED` list). Creators are credited by name with a link
  to their original post; places and amounts are never shown. v3 exception:
  identity UI may name the sign-in provider (docs/SPEC-V3.md).
- Agents never deploy contracts or send transactions; local chains only.
- Nothing is posted anywhere, and no key or seed phrase is ever handled.
- Editorial facts cite where they were read, or they are cut.

## Reports

A worker's final message states:

- what was built;
- the gate's last output, pasted in full;
- which readiness rows it believes are closed, and the test or file that closes
  each;
- anything it could not do;
- anything in the contract or spec it thinks is wrong.

A worker does not commit or merge to `main`; the planner merges lane branches.
A worker commits on its own lane branch.

A reviewer did not write the change. It reruns the gate itself, then tries to
break the proof: would the test still pass if the rule were removed or
inverted? It reports specific failing cases and how to reproduce them. It does
not fix code.
