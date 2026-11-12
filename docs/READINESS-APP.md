# Readiness for v2, the swipe app

Each row closes only when its proof exists and passes.

| Row | Lane | Outcome | Closed by |
| --- | --- | --- | --- |
| L1 | lessons-a | `own-your-exit` and `friend-speech` decks | `node scripts/gate.mjs --lane lessons-a` passes: strict validation, no banned words, topic and trait correct |
| L2 | lessons-b | `vote-with-your-feet` and `what-lasts` decks | `node scripts/gate.mjs --lane lessons-b` passes |
| G1 | ingest | Compile v2: meta, lessons, seed results and anything fetched produce a valid `content/build/app.json`. The work slots fill from results (1st = lead, others = more). A topic with no results gets empty work. A new topic gets a draft lesson with no banned words. Output is deterministic. | `ingest/test/compile-app.test.mjs` |
| G2 | ingest | The Action rebuilds `app.json` and the app, then deploys to Pages | Workflow test asserts the build and deploy steps for `app/` |
| A1 | app | Deck engine: swipe and tap navigation, progress bar, keyboard, reduced motion, an end-of-deck handoff | `app/test/deck.test.mjs` (state machine) |
| A2 | app | Work slots: lead and more render the creators' work, are skipped when empty, video plays HLS inline with a fallback link, and builds show guide and repo | `app/test/work.test.mjs` |
| A3 | app | Home feed and "you" panel: lessons, progress, and traits filling | `app/test/home.test.mjs` |
| A4 | app | Safety: every string escaped, https-only URLs, no banned words rendered from app chrome | `app/test/safety.test.mjs` |
| A5 | app | PWA build: `app/dist/` has index, manifest, icons and an offline shell. Media hosts are whitelisted in the CSP. Size budget is under 400 KB before video. | `app/test/build.test.mjs` |
| A6 | app | Design applied from the Beep reference: bold colour, rendered art per trait, legible on a 320px-wide screen | Screenshots reviewed by the planner |
