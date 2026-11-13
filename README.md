<p align="center">
  <img src="art/icons/lockup.svg" width="440" alt="capable">
</p>

<h3 align="center">Become capable. One idea at a time.</h3>

<p align="center">
  Short, swipeable lessons for people who want to start a community that lasts,<br>
  and to be a good member of one.
</p>

<p align="center">
  <a href="https://p-u-c.github.io/Capable/"><b>Open the app&nbsp;→</b></a>
  &nbsp;·&nbsp; free &nbsp;·&nbsp; no account needed &nbsp;·&nbsp; works offline
</p>

<p align="center">
  <img src="docs/media/screens.png" alt="Five capable screens: home with the seal filling in, an idea card, a push-back card, a stamp earned at the end of a lesson, and a passport" width="100%">
</p>

---

## Three minutes, one idea

Every lesson is a deck of full-screen cards. Swipe or tap through. Each deck holds:

- **The idea**, in a few plain cards.
- **A real story**, with names, places and years you can look up.
- **One push-back card**: the strongest objection, and an honest reply.
- **Something to try this week**, with nothing to buy.
- **The best short explainers** on the idea, played inline and credited to the people who made them.

Then you earn a trait.

## Four traits make you capable

<table>
  <tr>
    <td align="center" width="25%"><img src="docs/media/stamp-sovereign.svg" width="150" alt="Sovereign stamp"><br><b>Sovereign</b><br><sub>You can leave with your name, your connections and your work.</sub></td>
    <td align="center" width="25%"><img src="docs/media/stamp-civil.svg" width="150" alt="Civil stamp"><br><b>Civil</b><br><sub>You can disagree with a stranger without making an enemy.</sub></td>
    <td align="center" width="25%"><img src="docs/media/stamp-mobile.svg" width="150" alt="Mobile stamp"><br><b>Mobile</b><br><sub>You choose your communities on purpose, and let others choose theirs.</sub></td>
    <td align="center" width="25%"><img src="docs/media/stamp-enduring.svg" width="150" alt="Enduring stamp"><br><b>Enduring</b><br><sub>You know why communities die, and what the lasting ones share.</sub></td>
  </tr>
</table>

| # | Lesson | Builds | You'll understand |
| --- | --- | --- | --- |
| 01 | **Own Your Exit** | Sovereign | Why cheap leaving keeps a place fair, and how to own what you'd take with you. |
| 02 | **Where Manners Come From** | Civil | How manners grew out of power, and why they let strangers count on each other. |
| 03 | **Vote With Your Feet** | Mobile | Why choosing where you belong is a vote, and how to make that choice on purpose. |
| 04 | **What Lasts** | Enduring | What the communes that lasted had in common, and why good intentions were not enough. |

New lessons keep arriving: when a new idea is picked up, it appears as a lesson in progress, and the best explainers slot in as they're made.

## Your passport

Every lesson you finish stamps your **passport**, which holds a portrait drawn just for you, your traits and your stamps.

- **Sign in with Farcaster** to put your name and face on it, or stay anonymous. Signed out, your progress lives only in your browser.
- **Mint a stamp** as a soulbound badge on Base. It's free beyond a few cents of gas, one per trait per wallet, with art drawn entirely on-chain. Nobody can move it, and you can burn it any time. Contract: [`0xdDe6…C692`](https://basescan.org/address/0xdDe6A74CDBACF6A3b9909F2CfCF10d634A29C692).
- **Share your passport** with one tap. Anyone can view a wallet's stamps at `#/p/<address>`. Nothing is ever posted for you.

## One art grammar

The logo, the favicon, each lesson's scene, your portrait and every stamp come from one set of drawing rules. The pieces belong together, but no two are the same. The seal's ring fills in as you earn traits.

<p align="center">
  <img src="art/icons/logo.svg" width="96" alt="the capable seal">
  &nbsp;&nbsp;
  <img src="docs/media/stamp-sovereign.svg" width="96" alt="">
  <img src="docs/media/stamp-civil.svg" width="96" alt="">
  <img src="docs/media/stamp-mobile.svg" width="96" alt="">
  <img src="docs/media/stamp-enduring.svg" width="96" alt="">
</p>

## Principles

- **Plain and honest.** Every lesson argues against itself once. Every fact has a source you can check.
- **Yours.** No tracking, no ads, no server. Your progress stays in your browser unless you mint it.
- **Light.** About 225 KB to first paint. Sign-in, wallet and video code load only when you use them, everything is self-hosted, and it installs like an app.
- **Calm.** No streaks or guilt. Videos never autoplay with sound.

---

## How it runs

capable is a static site on GitHub Pages with no server and no database. Four automatic loops keep it current:

| Loop | When | What it does |
| --- | --- | --- |
| **Refresh** (`.github/workflows/refresh.yml`) | every 30 min | Reads public protocol data from two nodes and cross-checks them. When something changed, it recompiles `content/build/` and commits it as *capable-refresh*. New explainers slot into their lessons, and a new topic appears as a lesson marked *in progress*. It fails closed: if the data doesn't check out, nothing is committed. |
| **Deploy** (`deploy.yml`) | on every push to `main` touching `app/`, `content/`, `contract/` or `ingest/`, and when the refresh finds the site behind | Compiles the app data from the lessons, runs the app tests, builds `app/dist` and publishes it to Pages. |
| **Editor** (a scheduled Claude task) | every 6 h | Turns *in progress* lessons into full lessons and writes captions for new explainers. It never pushes to `main`: it opens a pull request from an `editor/*` branch. |
| **Editor merge** (`editor.yml` → `editor-merge.yml`) | on each editor PR | Checks that the PR only touches lesson files and `content/seed/works.json`, validates everything, runs all tests, then squash-merges and deploys. A PR that fails stays open for you. |

**Stamps** live in `CapableStamps` on Base ([`0xdDe6A74CDBACF6A3b9909F2CfCF10d634A29C692`](https://basescan.org/address/0xdDe6A74CDBACF6A3b9909F2CfCF10d634A29C692)). It's an ERC-721 + ERC-5192 soulbound token that is free to mint, one per trait per wallet, with on-chain SVG art. The owner wallet can only add, open and close traits. Nobody can mint for others, move or burn someone's stamp, change the art or upgrade the contract. Minting is on the honor system: the contract can't check that you read the lesson.

**Sign-in** uses Sign In With Farcaster on the web (QR or phone link) and the host's context inside Farcaster clients. Identity and progress stay in the reader's browser. Sign-in, wallet and chain code load only when used.

## Operating it

**Run it locally**

```bash
node ingest/bin/refresh.mjs --offline           # compile content/build/app.json from lessons + seed
cd app && npm ci && npm test && npm run build   # → app/dist; serve it with any static server
```

**Edit a lesson.** Change `content/lessons/<id>.json`, then check and push:

```bash
node contract/validate-app.mjs --strict content/lessons/<id>.json
git commit -am "lessons: …" && git push    # Deploy runs automatically
```

Lessons are plain JSON: 8–16 cards in a fixed order, 250–700 words, with no platform or contest words (the validator enforces this). See `contract/app.d.ts` for the shape.

**Review the editor's work.** Editor PRs whose links all point to allow-listed reference sites merge themselves. A PR commented "needs review: <hosts>" waits for you: open each link, then merge or close. "main moved" means it needs "Update branch"; the check runs again by itself. Auto-merge needs the repository variable `EDITOR_LOGIN` (the GitHub login the editor acts as); the settings it relies on are listed in [docs/REFRESH.md](docs/REFRESH.md#safety).

**Fix a caption or credit.** Captions and topic → lesson mapping live in `content/seed/works.json`, and creator usernames in `content/seed/people.json`. Push, and Deploy picks them up.

**Add a trait for a new lesson.** Register it on chain (it starts closed), add it to `content/app.meta.json` with its `stampId`, `color` and `emblem`, ship the lesson, then open it:

```bash
cd chain && npm ci
npm run trait -- add "NEW TRAIT" "#A0A0FF" 9 --rpc-url https://mainnet.base.org --ledger
npm run trait -- open 4 --rpc-url https://mainnet.base.org --ledger
```

**Pause or resume minting** for a trait with `npm run trait -- close <stampId> …` or `open <stampId> …`. Stamps already minted are never affected.

**Verify the contract on Basescan.** Either run `npm run verify -- --chain-id 8453 --address 0xdDe6A74CDBACF6A3b9909F2CfCF10d634A29C692 --etherscan-api-key <key>` in `chain/`, or upload `chain/build/CapableStamps.input.json` (Solidity Standard-JSON, v0.8.30+commit.73712a01, no constructor arguments).

**Watch it.** Every run is listed on [GitHub Actions](https://github.com/P-U-C/Capable/actions). A red refresh changes nothing on the site. Fix the cause and the next run catches up.

**Keep these settings.** Pages source is *GitHub Actions*, the `github-pages` environment allows `main`, and the `EDITOR_LOGIN` variable is set.

| Path | What |
| --- | --- |
| `content/lessons/` | The lesson decks, one JSON file each |
| `content/app.meta.json` | Name, citizen line, traits, stamp contract |
| `content/seed/` | Captions, topic mapping, creator names |
| `content/build/` | Compiled data (written by Refresh; don't edit) |
| `app/` | The web app (PWA) |
| `art/` | The art generator: seal, scenes, portraits, stamps ([gallery](art/gallery.html), [rules](docs/ART.md)) |
| `chain/` | The stamps contract, its tests and owner tools ([runbook](docs/DEPLOY-STAMPS.md)) |
| `ingest/` | The refresh pipeline |
| `contract/` | The data rules and validators everything is checked against |

Code is MIT licensed. Fonts are under the SIL Open Font License. Explainers belong to their creators, who are credited in the app.
