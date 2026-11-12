# Readiness for v3, citizens

Each row closes only when its proof exists and passes. Gate:
`node scripts/gate.mjs --lane <lane> --repeat 3` must print GATE PASS.

| Row | Lane | Outcome | Closed by |
| --- | --- | --- | --- |
| R1 | art | Generators `seal` (logo, lockup, favicon), `lessonScene`, `portrait`, and `stamp` (= contract/badge-art.mjs) per `ArtAPI` | `art/test/*.test.mjs`: determinism (same input → same bytes, twice and across processes), uniqueness (1,000 seeds → 1,000 distinct SVGs per generator), grammar (palette-only colours, no external refs, ≤ 16 KB, valid XML), favicon legible at 16 px (rendered check) |
| R2 | art | Gallery for review: every generator over many seeds, plus the logo at 16/32/180/512 px | `art/gallery.html` built by `node art/bin/gallery.mjs`; planner screenshot review |
| I1 | identity | Mini App mode: detect, ready(), context user → Identity, wallet, compose | `app/test/identity-miniapp.test.mjs` with a mocked SDK |
| I2 | identity | Web SIWF: channel, deep link, poll, verify (domain, nonce, signature), store; timeout, cancel and every failure path store nothing | `app/test/identity-siwf.test.mjs` with a mocked relay and verifier |
| I3 | identity | Storage and safety: validated on read, bad data cleared, sign-out clears, untrusted fields escaped/allow-listed (https pfp, username pattern) | `app/test/identity-store.test.mjs` |
| S1 | stamps | CapableStamps: soulbound (transfers/approvals revert, ERC-5192 `locked`), free mint one per (holder, trait), closed traits revert, holder burn, owner-only registry, events | `chain` tests on a local chain |
| S2 | stamps | On-chain art parity with `contract/badge-art.mjs`: all fixture vectors + 200 random inputs byte-identical; tokenURI decodes to valid JSON with the SVG | `chain` parity test |
| S3 | stamps | App module: config, owned() via read-only RPC, preview(), mint() with chain switch/add, explorer link; never resends | `app/test/stamps.test.mjs` with a mocked provider/RPC |
| S4 | stamps | Deploy runbook the owner can follow with their own wallet, plus a local-chain rehearsal script agents can run | `docs/DEPLOY-STAMPS.md`; `cd chain && npm run rehearse` deploys + mints on a local chain |
| P1 | app | Passport `#/passport` and public `#/p/<address>`; "you" chip opens it; sign-in sheet; share | `app/test/passport.test.mjs` |
| P2 | app | Trait card presses the stamp, then mint or "saved to your passport"; new logo, favicon and icons from `art`; generated scenes for lessons without a hand-drawn one | `app/test/*.test.mjs` + planner screenshot review |
| P3 | app | Budgets and CSP per SPEC-V3; identity code lazy; safety test allow-lists only the identity copy keys | `app/test/build.test.mjs`, `app/test/safety.test.mjs` |
| P4 | app | Fixes from the v2 reviews (docs/reviews/v2-*.md) routed to the app lane | the review's finding ids, each with its test or screenshot |
