# capable

Short, swipeable lessons for becoming **capable**: able to start a community that lasts, and to be a good member of one.

Each lesson is a deck of full-screen cards built around one idea: what it is, a concrete example, the strongest counterpoint, something to do today, and short explainer videos by the people who made the best work on it. Finishing lessons builds four traits: **Sovereign**, **Civil**, **Mobile** and **Enduring**.

## Layout

| Path | What |
| --- | --- |
| `app/` | the PWA (no framework; esbuild) |
| `content/lessons/` | the lesson decks (JSON, one per lesson) |
| `content/app.meta.json` | name, traits |
| `content/seed/` | source material and creator credits |
| `ingest/` | reads public protocol data for new topics and creators' work; compiles `content/build/app.json` |
| `contract/` | the data contract and validators every part builds against |
| `docs/` | spec, design brief, readiness, swarm rules, reviews |

## Run it

```bash
node ingest/bin/refresh.mjs --offline   # compile content/build/app.json
cd app && npm ci && npm test && npm run build   # → app/dist
```

## How it was built

It was built by several agents working in parallel lanes, each held to `node scripts/gate.mjs --lane <lane>`. See `docs/SWARM.md`.

The earlier "atlas" version (`web/`, `content/chapters/`, `docs/SPEC.md`) is kept for its fact-checked source material.

MIT licensed.
