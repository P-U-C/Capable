// I1: Snapchain/Hypersnap HTTP client with endpoint fallback, 5 s timeouts and fail-closed errors.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient, DEFAULT_TIMEOUT_MS, MAX_BODY_BYTES, NodeHttpError, NodeUnavailable } from "../src/node.mjs";
import { deadUrl, runCli, sendJson, stubServer } from "./helpers.mjs";

const page = (n, next = "") => ({ messages: [{ data: { type: "MESSAGE_TYPE_CAST_ADD", fid: 1, timestamp: n }, hash: `0x${String(n).padStart(40, "0")}` }], nextPageToken: next });

test("default per-request timeout is 5 seconds", () => {
  assert.equal(DEFAULT_TIMEOUT_MS, 5000);
  assert.equal(createClient({ nodes: ["https://a.example"] }).timeoutMs, 5000);
});

test("first node 503 → second node used", async () => {
  const a = await stubServer((req, res) => sendJson(res, 503, { error: "overloaded" }));
  const b = await stubServer((req, res) => sendJson(res, 200, page(7)));
  try {
    const client = createClient({ nodes: [a.url, b.url] });
    const r = await client.castsByFid(1, { pageSize: 100, reverse: true });
    assert.equal(r.messages[0].data.timestamp, 7);
    assert.equal(a.requests.length, 1);
    assert.equal(b.requests.length, 1);
    assert.equal(b.requests[0], "/v1/castsByFid?fid=1&pageSize=100&reverse=true");
    assert.deepEqual(client.answeredNodes(), [b.url], "only the node that answered is provenance");
  } finally {
    await a.close();
    await b.close();
  }
});

test("connection refused → next node used", async () => {
  const b = await stubServer((req, res) => sendJson(res, 200, page(8)));
  const dead = await deadUrl(); // after b, so b can never be handed the freed port
  try {
    const r = await createClient({ nodes: [dead, b.url] }).castsByParent(1, "0x2ba04801ad21047363138d58a3b4e5f0dabe7942", { pageSize: 100 });
    assert.equal(r.messages[0].data.timestamp, 8);
    assert.equal(b.requests[0], "/v1/castsByParent?fid=1&hash=0x2ba04801ad21047363138d58a3b4e5f0dabe7942&pageSize=100");
  } finally {
    await b.close();
  }
});

test("a node that never answers times out and the next node is used", { timeout: 10_000 }, async (t) => {
  const hang = await stubServer(() => {}); // never responds
  const b = await stubServer((req, res) => sendJson(res, 200, page(9)));
  t.after(() => Promise.all([hang.close(), b.close()])); // also runs if this test itself times out
  const started = Date.now();
  const r = await createClient({ nodes: [hang.url, b.url], timeoutMs: 150 }).castsByFid(37);
  assert.equal(r.messages[0].data.timestamp, 9);
  assert.ok(Date.now() - started < 3000, "timed out promptly");
});

test("a node that stalls mid-body times out too", { timeout: 10_000 }, async (t) => {
  const stall = await stubServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.write('{"messages":['); // and never finishes
  });
  const b = await stubServer((req, res) => sendJson(res, 200, page(10)));
  t.after(() => Promise.all([stall.close(), b.close()]));
  const r = await createClient({ nodes: [stall.url, b.url], timeoutMs: 150 }).castsByFid(37);
  assert.equal(r.messages[0].data.timestamp, 10);
});

test("malformed JSON or a missing messages array → next node used", async () => {
  const bad = await stubServer((req, res) => sendJson(res, 200, "<html>not json"));
  const odd = await stubServer((req, res) => sendJson(res, 200, { hello: "world" }));
  const good = await stubServer((req, res) => sendJson(res, 200, page(11)));
  try {
    const r = await createClient({ nodes: [bad.url, odd.url, good.url] }).castsByFid(1);
    assert.equal(r.messages[0].data.timestamp, 11);
  } finally {
    await bad.close();
    await odd.close();
    await good.close();
  }
});

test("4xx is a real answer: surfaced, no failover", async () => {
  const a = await stubServer((req, res) => sendJson(res, 400, { errCode: "bad_request.validation_failure" }));
  const b = await stubServer((req, res) => sendJson(res, 200, page(12)));
  try {
    await assert.rejects(createClient({ nodes: [a.url, b.url] }).castById(1, "0xnothex"), (err) => {
      assert.ok(err instanceof NodeHttpError);
      assert.equal(err.status, 400);
      assert.equal(err.node, a.url);
      return true;
    });
    assert.equal(b.requests.length, 0, "second node not contacted");
  } finally {
    await a.close();
    await b.close();
  }
});

for (const status of [429, 404, 408]) {
  test(`HTTP ${status} (a rate-limited, lagging or slow node) → next node used`, async () => {
    const a = await stubServer((req, res) => sendJson(res, status, { error: "try elsewhere" }));
    const b = await stubServer((req, res) => sendJson(res, 200, page(20)));
    try {
      const client = createClient({ nodes: [a.url, b.url] });
      const r = await client.castsByFid(1);
      assert.equal(r.messages[0].data.timestamp, 20);
      assert.equal(a.requests.length, 1);
      assert.equal(b.requests.length, 1);
      assert.deepEqual(client.answeredNodes(), [b.url], "the node that failed over is not provenance");
      // Listings too: a whole paginated read moves to the next node.
      const replies = await client.allCastsByParent(1, "0x2ba04801ad21047363138d58a3b4e5f0dabe7942");
      assert.equal(replies.node, b.url);
    } finally {
      await a.close();
      await b.close();
    }
  });
}

test("other 4xx stay answers: 400, 401, 403, 410 are surfaced without failover", async () => {
  for (const status of [400, 401, 403, 410]) {
    const a = await stubServer((req, res) => sendJson(res, status, { errCode: "nope" }));
    const b = await stubServer((req, res) => sendJson(res, 200, page(21)));
    try {
      await assert.rejects(createClient({ nodes: [a.url, b.url] }).castsByFid(1), (err) => err instanceof NodeHttpError && err.status === status);
      assert.equal(b.requests.length, 0, `${status}: second node not contacted`);
    } finally {
      await a.close();
      await b.close();
    }
  }
});

test("a 429 part-way through a listing restarts it on the next node", async () => {
  const a = await stubServer((req, res, u) => (u.searchParams.get("pageToken") ? sendJson(res, 429, "slow down") : sendJson(res, 200, page(100, "p2"))));
  const b = await stubServer((req, res, u) => sendJson(res, 200, u.searchParams.get("pageToken") ? page(2, "") : page(1, "p2")));
  try {
    const r = await createClient({ nodes: [a.url, b.url] }).allCastsByParent(1, "0x2ba04801ad21047363138d58a3b4e5f0dabe7942");
    assert.deepEqual(r.messages.map((m) => m.data.timestamp), [1, 2]);
    assert.equal(r.node, b.url);
  } finally {
    await a.close();
    await b.close();
  }
});

test("every node rate-limited → NodeUnavailable; every node 404 → an answer (NodeHttpError 404)", async () => {
  const a = await stubServer((req, res) => sendJson(res, 429, "slow down"));
  const b = await stubServer((req, res) => sendJson(res, 404, { errCode: "not_found" }));
  const c = await stubServer((req, res) => sendJson(res, 404, { errCode: "not_found" }));
  try {
    await assert.rejects(createClient({ nodes: [a.url, b.url] }).userDataByFid(5254), (err) => {
      assert.ok(err instanceof NodeUnavailable, err.name);
      assert.deepEqual(err.nodes, [a.url, b.url]);
      assert.match(err.message, /HTTP 429/);
      return true;
    });
    await assert.rejects(createClient({ nodes: [b.url, c.url] }).allCastsByParent(1, "0x2ba04801ad21047363138d58a3b4e5f0dabe7942"), (err) => {
      assert.ok(err instanceof NodeHttpError, err.name);
      assert.equal(err.status, 404);
      assert.equal(err.node, c.url);
      return true;
    });
    assert.equal(c.requests.length, 1, "the 404 was failed over before it was believed");
  } finally {
    await a.close();
    await b.close();
    await c.close();
  }
});

test("all nodes down → typed NodeUnavailable listing every node tried", async () => {
  const a = await stubServer((req, res) => sendJson(res, 502, "bad gateway"));
  const dead = await deadUrl();
  try {
    await assert.rejects(createClient({ nodes: [a.url, dead] }).userDataByFid(5254), (err) => {
      assert.ok(err instanceof NodeUnavailable);
      assert.deepEqual(err.nodes, [a.url, dead]);
      assert.match(err.message, /HTTP 502/);
      assert.match(err.message, /network error/);
      assert.match(err.request, /^\/v1\/userDataByFid\?fid=5254$/);
      return true;
    });
  } finally {
    await a.close();
  }
});

test("paginate follows nextPageToken and stops at maxPages", async () => {
  const s = await stubServer((req, res, u) => {
    const n = Number(u.searchParams.get("pageToken") || "1");
    sendJson(res, 200, page(n, String(n + 1))); // endless
  });
  try {
    const r = await createClient({ nodes: [s.url] }).allCastsByFid(1, { maxPages: 3 });
    assert.deepEqual(r.messages.map((m) => m.data.timestamp), [1, 2, 3]);
    assert.equal(r.pages, 3);
    assert.equal(r.truncated, true);
    assert.equal(s.requests.length, 3);
    assert.match(s.requests[1], /pageToken=2/);
  } finally {
    await s.close();
  }
});

test("paginate ends on an empty nextPageToken", async () => {
  const s = await stubServer((req, res, u) => sendJson(res, 200, u.searchParams.get("pageToken") ? page(2, "") : page(1, "dG9rZW4=")));
  try {
    const r = await createClient({ nodes: [s.url] }).allCastsByParent(1, "0x2ba04801ad21047363138d58a3b4e5f0dabe7942");
    assert.deepEqual(r.messages.map((m) => m.data.timestamp), [1, 2]);
    assert.equal(r.truncated, false);
    assert.match(s.requests[1], /pageToken=dG9rZW4%3D/);
  } finally {
    await s.close();
  }
});

test("pagination failing part-way on every node → NodeUnavailable, no partial result", async () => {
  const flaky = () => stubServer((req, res, u) => (u.searchParams.get("pageToken") ? sendJson(res, 503, "down") : sendJson(res, 200, page(1, "p2"))));
  const a = await flaky();
  const b = await flaky();
  try {
    let resolved;
    await assert.rejects(
      createClient({ nodes: [a.url, b.url] }).allCastsByFid(1).then((r) => (resolved = r)),
      (err) => err instanceof NodeUnavailable && /after 1 page/.test(err.message),
    );
    assert.equal(resolved, undefined, "never resolved with page 1 alone");
  } finally {
    await a.close();
    await b.close();
  }
});

test("pagination failing part-way restarts on the next node, so pages never mix", async () => {
  const a = await stubServer((req, res, u) => (u.searchParams.get("pageToken") ? sendJson(res, 503, "down") : sendJson(res, 200, page(100, "p2"))));
  const b = await stubServer((req, res, u) => sendJson(res, 200, u.searchParams.get("pageToken") ? page(2, "") : page(1, "p2")));
  try {
    const r = await createClient({ nodes: [a.url, b.url] }).allCastsByFid(1);
    assert.deepEqual(r.messages.map((m) => m.data.timestamp), [1, 2]);
    assert.equal(r.node, b.url);
  } finally {
    await a.close();
    await b.close();
  }
});

test("all nodes down → refresh exits non-zero and writes nothing (no partial write)", async () => {
  const a = await stubServer((req, res) => sendJson(res, 503, "down"));
  const dead = await deadUrl();
  const dir = mkdtempSync(join(tmpdir(), "primer-i1-"));
  const chapters = mkdtempSync(join(tmpdir(), "primer-i1-chapters-"));
  const out = join(dir, "book.json");
  const previous = '{"previous": "build"}\n';
  writeFileSync(out, previous);
  try {
    const r = await runCli(["--now", "2026-11-12T17:00:00Z", "--out", out, "--nodes", `${a.url},${dead}`, "--chapters", chapters]);
    assert.equal(r.code, 1, r.stderr);
    assert.match(r.stderr, /node unavailable/);
    assert.match(r.stderr, /nothing written/);
    assert.equal(r.stdout, "", "no summary: nothing was compiled");
    assert.ok(a.requests.length >= 1, "the stub node was asked");
    assert.equal(readFileSync(out, "utf8"), previous);
    assert.deepEqual(readdirSync(dir), ["book.json"], "no temp files left behind");
  } finally {
    await a.close();
  }
});

test("S19: a body over the cap (declared or streamed) fails that node, like a timeout, and the next node is used", async () => {
  const big = JSON.stringify({ messages: [], pad: "x".repeat(2000) });
  const declared = await stubServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(big) });
    res.end(big);
  });
  const streamed = await stubServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" }); // chunked: no Content-Length
    res.write('{"messages":[],"pad":"');
    for (let i = 0; i < 40; i++) res.write("y".repeat(100));
    res.end('"}');
  });
  const good = await stubServer((req, res) => sendJson(res, 200, page(30)));
  try {
    for (const bad of [declared, streamed]) {
      const r = await createClient({ nodes: [bad.url, good.url], maxBodyBytes: 1000 }).castsByFid(1);
      assert.equal(r.messages[0].data.timestamp, 30);
    }
    await assert.rejects(createClient({ nodes: [declared.url, streamed.url], maxBodyBytes: 1000 }).castsByFid(1), (err) => {
      assert.ok(err instanceof NodeUnavailable);
      assert.match(err.message, new RegExp(`${declared.url} \\(response too large: \\d+ bytes declared, limit 1000\\)`));
      assert.match(err.message, new RegExp(`${streamed.url} \\(response too large: over 1000 bytes\\)`));
      return true;
    });
    // Under the cap, the same bodies are read.
    assert.deepEqual((await createClient({ nodes: [streamed.url], maxBodyBytes: 10_000 }).castsByFid(1)).messages, []);
    assert.equal(MAX_BODY_BYTES, 5 * 1024 * 1024, "5 MB by default");
  } finally {
    await declared.close();
    await streamed.close();
    await good.close();
  }
});

test("S19: a node that failed is demoted for the rest of the run: asked only after the others; a 404 is not a failure of the node", async () => {
  let down = true;
  const a = await stubServer((req, res, u) => (down ? sendJson(res, 503, "down") : u.pathname === "/v1/castById" ? sendJson(res, 404, { errCode: "not_found" }) : sendJson(res, 200, page(40))));
  const b = await stubServer((req, res) => sendJson(res, 200, page(41)));
  try {
    const client = createClient({ nodes: [a.url, b.url] });
    assert.equal((await client.castsByFid(1)).messages[0].data.timestamp, 41);
    assert.deepEqual(client.demotedNodes(), [a.url]);
    down = false;
    assert.equal((await client.castsByFid(1)).messages[0].data.timestamp, 41, "b first now, though a is back");
    assert.equal((await client.allCastsByParent(1, "0x2ba04801ad21047363138d58a3b4e5f0dabe7942")).node, b.url);
    assert.equal(a.requests.length, 1, "a was not asked again");
    assert.deepEqual(client.witnesses(b.url), [], "a demoted node confirms nothing");
    // If every healthy node fails, a demoted one is still tried before giving up.
    const c = createClient({ nodes: [a.url, b.url] });
    down = true;
    await c.castsByFid(1);
    down = false;
    await b.close();
    assert.equal((await c.castsByFid(1)).messages[0].data.timestamp, 40);
    // A 404 (a lagging node, about one thing) does not demote, from a listing or a probe.
    const lag = await stubServer((req, res) => sendJson(res, 404, { errCode: "not_found" }));
    const up = await stubServer((req, res) => sendJson(res, 200, page(42)));
    try {
      const e = createClient({ nodes: [lag.url, up.url] });
      assert.equal((await e.castsByFid(1)).messages[0].data.timestamp, 42);
      assert.deepEqual(e.demotedNodes(), [], "a 404 is not the node failing");
      await e.castsByFid(1);
      assert.equal(lag.requests.length, 2, "still asked first");
    } finally {
      await lag.close();
      await up.close();
    }
    const d = createClient({ nodes: [a.url] });
    assert.equal((await d.probeCast(a.url, 1, "0x" + "a".repeat(40))).status, "missing");
    assert.deepEqual(d.demotedNodes(), []);
  } finally {
    await a.close();
    await b.close();
  }
});

test("probeCast asks one node only and reads its answer: found, missing (404 or not_found), or unavailable (anything else); never throws for a node's failure", async () => {
  const msg = { data: { type: "MESSAGE_TYPE_CAST_ADD", fid: 1, timestamp: 5 }, hash: "0x" + "c".repeat(40) };
  const answers = {
    found: (res) => sendJson(res, 200, msg),
    notFound404: (res) => sendJson(res, 404, { errCode: "not_found" }),
    notFound400: (res) => sendJson(res, 400, { errCode: "not_found", details: "no such cast" }),
    refused: (res) => sendJson(res, 400, { errCode: "bad_request.validation_failure" }),
    down: (res) => sendJson(res, 503, "down"),
    junk: (res) => sendJson(res, 200, { hello: "world" }),
  };
  const servers = {};
  for (const [k, f] of Object.entries(answers)) servers[k] = await stubServer((req, res) => f(res));
  const other = await stubServer((req, res) => sendJson(res, 200, msg));
  try {
    const client = createClient({ nodes: [...Object.values(servers).map((s) => s.url), other.url] });
    const status = async (k) => (await client.probeCast(servers[k].url, 1, msg.hash)).status;
    assert.equal(await status("found"), "found");
    assert.deepEqual((await client.probeCast(servers.found.url, 1, msg.hash)).message, msg);
    assert.equal(await status("notFound404"), "missing");
    assert.equal(await status("notFound400"), "missing");
    assert.equal(await status("refused"), "unavailable", "a refusal is not an answer about the cast");
    assert.equal(await status("down"), "unavailable");
    assert.equal(await status("junk"), "unavailable");
    assert.equal(other.requests.length, 0, "no other node is asked");
    assert.ok(client.demotedNodes().includes(servers.down.url) && client.demotedNodes().includes(servers.junk.url));
    assert.ok(!client.demotedNodes().includes(servers.notFound404.url));
    assert.deepEqual(client.witnesses(servers.found.url), client.nodes.filter((n) => n !== servers.found.url && !client.demotedNodes().includes(n)));
  } finally {
    for (const s of Object.values(servers)) await s.close();
    await other.close();
  }
});
