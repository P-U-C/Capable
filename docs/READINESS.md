# MVP readiness

The MVP is ready when every row is closed by the proof named in it. Each row
belongs to one lane. The rows are the reward function, so a row closes only
when its proof exists and passes, not when code that looks right exists.

| Row | Lane | Outcome | Closed by |
| --- | --- | --- | --- |
| I1 | ingest | Snapchain/Hypersnap HTTP client with endpoint fallback, 5s timeouts, and fail-closed errors | `ingest/test/node.test.mjs` with a local stub server: first node 503 → second node used; all down → typed `NodeUnavailable`, no partial write |
| I2 | ingest | Prize detection from watched-author casts | `ingest/test/detect.test.mjs` with fixtures for the four real prize headlines + 3 non-prize casts (incl. "I just added to 's /poidh bounty!") |
| I3 | ingest | Submission classification from replies | `ingest/test/classify.test.mjs`: video hosts (stream.farcaster.xyz, bsky, firefly, mp4, youtube) → video; site+repo on build prize → site; "Gm", promo links, bare text → excluded |
| I4 | ingest | Results parsing marks winners by hash prefix, in order | `ingest/test/results.test.mjs` using the two real results posts' link lists |
| I5 | ingest | Compile: meta + seed + chapters + fetched → valid `content/build/book.json`, deterministic; draft idea auto-created (with the prize's `strands` hint, `connections: []`) for every prize lacking a chapter file, incl. the three 2024 archive prizes; status open/judging/closed/awarded | `ingest/test/compile.test.mjs`: same inputs twice → byte-identical output; new prize fixture → draft present and `validateBook` passes; a prize 30 days past deadline without results → `closed` |
| I6 | ingest | Refresh CLI + scheduled GitHub Action | `ingest/bin/refresh.mjs --offline` exits 0 against fixtures; `.github/workflows/refresh.yml` runs it every 30 min and commits only `content/build/` |
| W1 | web | Safe inline renderer | `web/test/inline.test.mjs`: `<script>`, `javascript:` links, `http:` links, malformed `{{sub:}}`, nested markup all rendered inert |
| W2 | web | Hash router covering every view in DESIGN.md | `web/test/router.test.mjs`: every route parses and round-trips; unknown hash → cover |
| W3 | web | Overlay merge (validate, replace by key, drop + count invalid) | `web/test/overlay.test.mjs` |
| W4 | web | Single-file build for the artifact (`--media=link`) and hosted (`--media=inline`) | `npm run build` → `web/dist/index.html` (artifact) and `web/dist/hosted/index.html`; test asserts no script/style/img/media src outside the CSP allowlist in the artifact build, and size < 3 MB |
| W5 | web | Views: cover, chapter (5 depths + end pieces), glossary, credits, about, draft banner, countdown | `web/test/views.test.mjs` renders each view from the fixture into a DOM string and checks landmarks, the unofficial notice, and that every depth section exists |
| W6 | web | Figure SVG: one mark per strand, one notch per idea read, unknown strands composed | `web/test/figure.test.mjs`: 0 reads, reads on 2 strands, reads on all 4 + a 5th unknown strand → correct stroke states, notch counts, `<title>` per strand |
| W7 | web | Map of ideas + path switch | `web/test/map.test.mjs`: every chapter is a node on its strand(s); every connection is an edge; drafts with no strand appear under "unplaced"; 40 synthetic ideas render without overlapping labels (labels hidden past 12 per band); path switch changes prev/next order |
| E1 | editorial-a | `prologue`, `exit`, `friend-speech` chapters | gate editorial checks: strict validation, citations exist and belong to the idea, ≥4 voices cited, strands known, ≥2 connections of ≥2 kinds to known ideas, prize ids match SPEC |
| E2 | editorial-b | `feet`, `what-lasts`, `next-pick` chapters | same, for its three files |
| E3 | planner | Editor's note, archetype, strands, editor's path | `content/book.meta.json` validates when compiled |
| R1 | review | Independent review of all lanes after merge | `docs/reviews/*.md` with reproduction steps for each finding |
