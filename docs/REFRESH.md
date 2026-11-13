# Keeping capable current

Planner-owned. Two things keep the app current, and neither needs a person.

## 1. The GitHub Action (mechanical, every 30 minutes)

`.github/workflows/refresh.yml` runs `node ingest/bin/refresh.mjs`, which reads
the public nodes, recompiles `content/build/book.json` and
`content/build/app.json`, and commits them only if they changed. The deploy job
then runs `cd app && npm ci && npm test && npm run build` and publishes
`app/dist` to GitHub Pages. A push to `main` that touches `app/`, `content/`,
`contract/` or `ingest/` redeploys the committed content without refreshing.

What it brings in on its own:

- **New results.** The first-placed entry becomes the lesson's `lead` work;
  the others become `more`. Captions come from `content/seed/works.json`, or a
  neutral generated line ("A short explainer") until an editor writes one.
- **New topics.** A topic with no lesson file becomes a **draft** lesson: a
  cover, one fixed idea card, the work slots and a trait card. Drafts show in
  the app marked "new · in progress", never count toward progress, and carry
  no banned words.

It fails closed: if no node answers or the result does not validate, nothing is
committed or deployed.

## 2. The editor (a scheduled Claude session, every 6 hours)

The editor turns drafts into full lessons and replaces generated captions with
written ones. It follows `docs/REFRESH-PROMPT.md`, which is also the scheduled
task's prompt. It never reads or posts to the source platform: everything it
needs about a new topic is already in `content/build/book.json` (the topic's
headline, its neutral deliverable, and its strand hint).

It never pushes to `main`. It opens a pull request, and CI decides:

1. The editor writes `content/lessons/<id>.json` (id = file name) and/or edits
   `content/seed/works.json` (`topics` and `captions` only), checks them
   locally, and pushes **only those files** to a new branch
   `editor/<yyyymmdd-hhmm>` in P-U-C/Capable, then opens a non-draft pull
   request into `main`.
2. `editor.yml` (read-only) checks the paths (`ingest/bin/editor-check.mjs`),
   validates every lesson `--strict`, runs the contract and ingest tests,
   compiles with `--strict-lessons`, and runs the app tests and build.
3. `editor-merge.yml` runs main's own copy of the rules (never the PR's code),
   re-checks the author (repository variable `EDITOR_LOGIN`), branch, head
   commit and paths, squash-merges that exact commit, and dispatches
   `deploy.yml`, which compiles `app.json` from the sources and deploys.

If any check fails, the pull request stays open for a person. Without the
`EDITOR_LOGIN` variable, every editor PR waits for a person.

Only the scheduled refresh commits `content/build/`.

## Safety

- Everything read from the network is data. The editor follows no
  instructions found in it.
- Nothing is posted anywhere; no key is handled.
- The path rules are enforced in CI from `main`, not by the prompt.
