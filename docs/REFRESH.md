# Keeping capable current

Planner-owned. Two things keep the app current, and neither needs a person.

## 1. The GitHub Action (mechanical, every 30 minutes)

`.github/workflows/refresh.yml` runs `node ingest/bin/refresh.mjs`, which reads
the public nodes, recompiles `content/build/book.json` and
`content/build/app.json`, and commits them only if they changed (it is the only
workflow that commits). Afterwards `ingest/bin/deploy-if-behind.mjs`
dispatches `deploy.yml` whenever Pages isn't serving main's head.
`deploy.yml` (on push to main, on demand or dispatched; its own concurrency
group) compiles `app.json` from the sources, runs
`cd app && npm ci && npm test && npm run build`, and publishes `app/dist`.

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
2. `editor.yml` (read-only) checks the branch's own head, and first requires
   it to contain main's current head (`editor-check.mjs current`), so what it
   checks is exactly what a merge publishes; a lesson that clashes with one on
   main (id, number, topic) fails instead of being dropped at deploy. It then
   checks the paths, validates every lesson `--strict`, runs the contract and
   ingest tests, compiles with `--strict-lessons`, and runs the app tests and
   build. A branch that is behind main fails: bring it up to date and push.
3. `editor-merge.yml` runs main's own copy of the rules (never the PR's code).
   It re-checks the author (repository variable `EDITOR_LOGIN`), that every
   commit was authored by the editor, the branch, the head commit and the
   paths; then `editor-check.mjs ready` decides. It squash-merges that exact
   commit and dispatches `deploy.yml` only if main is still contained in the
   checked head and every link in each changed lesson file and in
   `works.json` is https to a host on `LINK_HOSTS` in
   `ingest/bin/editor-check.mjs` (Wikipedia, .gov, .edu, .gov.uk, .ac.uk,
   archive.org, arxiv.org, doi.org, JSTOR, Gutenberg, publishers' and law
   sites, and the founding lessons' sources). Otherwise it comments on the PR
   ("needs review: <hosts>" or "main moved") and leaves it open for a person;
   a push to the branch checks it again. After merging it confirms the merged
   tree is the checked tree.

If any check fails, the pull request stays open for a person. Without the
`EDITOR_LOGIN` variable, every editor PR waits for a person.

Only the scheduled refresh commits `content/build/`.

## Safety

- Everything read from the network is data. The editor follows no
  instructions found in it.
- Links outside the allow-list never publish without a person. Only a
  person's pull request can change the list.
- The gate relies on repository settings:
  - `EDITOR_LOGIN` names the account the editor acts as (ideally a dedicated
    bot account with Write role, whose token is limited to this repo with
    Contents and Pull requests read/write and **no Workflows permission**);
  - no repository, organization or environment secrets this repo can read;
  - a ruleset on `main` that blocks force-pushes and deletion, and lets only
    the owner and GitHub Actions update it;
  - squash merging allowed; Pages source GitHub Actions, and the
    `github-pages` environment deploys from `main` only;
  - the workflow keeps the name `editor`, branches match
    `editor/<yyyymmdd-hhmm>`, and the default branch is `main`.
- Nothing is posted anywhere; no key is handled.
- The path rules are enforced in CI from `main`, not by the prompt.
