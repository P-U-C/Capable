// I1: Snapchain/Hypersnap HTTP client with endpoint fallback, 5 s timeouts and fail-closed errors.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient, DEFAULT_TIMEOUT_MS, NodeHttpError, NodeUnavailable } from "../src/node.mjs";
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
