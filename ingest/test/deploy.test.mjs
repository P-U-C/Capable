// S2: Pages never lags main for long: refresh.yml dispatches deploy.yml whenever Pages does not serve main's head.
import { test } from "node:test";
import assert from "node:assert/strict";
import { decide, deployIfBehind } from "../bin/deploy-if-behind.mjs";
import { ROOT, sendJson, stubServer } from "./helpers.mjs";
import { spawn } from "node:child_process";
import { join } from "node:path";

const HEAD = "a".repeat(40);
const OLD = "b".repeat(40);

test("decide: deploy unless the newest deployment is main's head and it succeeded or is under way", () => {
  assert.equal(decide({ head: HEAD, deployment: undefined, state: null }).dispatch, true);
  assert.equal(decide({ head: HEAD, deployment: { sha: OLD }, state: null }).dispatch, true);
  for (const s of ["success", "queued", "pending", "in_progress"]) assert.equal(decide({ head: HEAD, deployment: { sha: HEAD }, state: s }).dispatch, false, s);
  for (const s of ["failure", "error", "inactive", null, undefined]) assert.equal(decide({ head: HEAD, deployment: { sha: HEAD }, state: s }).dispatch, true, String(s));
  assert.match(decide({ head: HEAD, deployment: { sha: OLD }, state: null }).why, /Pages serves bbbbbbbbbbbb, main is aaaaaaaaaaaa/);
});

/** A GitHub API stub: main's head, the newest Pages deployment and its status; records every call. */
async function github({ head = HEAD, deployments = [], statuses = [], fail = () => 0 } = {}) {
  const calls = [];
  const s = await stubServer((req, res, u) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      calls.push({ method: req.method, path: u.pathname + u.search, auth: req.headers.authorization, body });
      const code = fail(u);
      if (code) return sendJson(res, code, { message: "nope" });
      if (req.method === "GET" && u.pathname === "/repos/P-U-C/Capable/commits/main") return sendJson(res, 200, { sha: head });
      if (req.method === "GET" && u.pathname === "/repos/P-U-C/Capable/deployments" && u.searchParams.get("environment") === "github-pages") return sendJson(res, 200, deployments);
      if (req.method === "GET" && u.pathname === "/repos/P-U-C/Capable/deployments/7/statuses") return sendJson(res, 200, statuses);
      if (req.method === "POST" && u.pathname === "/repos/P-U-C/Capable/actions/workflows/deploy.yml/dispatches") {
        res.writeHead(204);
        return res.end();
      }
      sendJson(res, 404, { message: "no route" });
    });
  });
  return { ...s, calls };
}
const opts = (api) => ({ api: api.url, repo: "P-U-C/Capable", token: "t0ken", ref: "main" });
const dispatches = (api) => api.calls.filter((c) => c.method === "POST");

test("up to date: no dispatch", async () => {
  const api = await github({ deployments: [{ id: 7, sha: HEAD }], statuses: [{ state: "success" }] });
  try {
    const r = await deployIfBehind(opts(api));
    assert.deepEqual([r.dispatched, r.head], [false, HEAD]);
    assert.deepEqual(dispatches(api), []);
    assert.ok(api.calls.every((c) => c.auth === "Bearer t0ken"));
    assert.deepEqual(api.calls.map((c) => c.path), ["/repos/P-U-C/Capable/commits/main", "/repos/P-U-C/Capable/deployments?environment=github-pages&per_page=1", "/repos/P-U-C/Capable/deployments/7/statuses?per_page=1"]);
  } finally {
    await api.close();
  }
});

test("behind (another commit, a failed deploy, nothing yet): dispatches deploy.yml on main", async () => {
  for (const setup of [{ deployments: [{ id: 7, sha: OLD }] }, { deployments: [{ id: 7, sha: HEAD }], statuses: [{ state: "failure" }] }, { deployments: [] }, { deployments: [{ id: 7, sha: HEAD }], statuses: [] }]) {
    const api = await github(setup);
    try {
      const r = await deployIfBehind(opts(api));
      assert.equal(r.dispatched, true, JSON.stringify(setup));
      assert.deepEqual(dispatches(api).map((c) => [c.path, JSON.parse(c.body)]), [["/repos/P-U-C/Capable/actions/workflows/deploy.yml/dispatches", { ref: "main" }]]);
    } finally {
      await api.close();
    }
  }
});

test("an API error, a missing token or a bad repository fails loudly and dispatches nothing", async () => {
  const api = await github({ fail: (u) => (u.pathname.endsWith("/deployments") ? 500 : 0) });
  try {
    await assert.rejects(deployIfBehind(opts(api)), /GitHub API GET \/deployments\?environment=github-pages&per_page=1: HTTP 500/);
    assert.deepEqual(dispatches(api), []);
    await assert.rejects(deployIfBehind({ ...opts(api), token: "" }), /GITHUB_TOKEN is required/);
    await assert.rejects(deployIfBehind({ ...opts(api), repo: "nope" }), /owner\/name/);
  } finally {
    await api.close();
  }
  const noHead = await github({ head: "zzz" });
  try {
    await assert.rejects(deployIfBehind(opts(noHead)), /no head commit for main/);
  } finally {
    await noHead.close();
  }
});

test("CLI: reads GITHUB_API_URL, GITHUB_REPOSITORY and GITHUB_TOKEN; exit 0 with a one-line verdict, exit 1 on an API error", async () => {
  const run = (api, env = {}) =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, [join(ROOT, "ingest/bin/deploy-if-behind.mjs"), "--ref", "main", "--workflow", "deploy.yml"], { env: { PATH: process.env.PATH, GITHUB_API_URL: api.url, GITHUB_REPOSITORY: "P-U-C/Capable", GITHUB_TOKEN: "t0ken", ...env } });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));
      child.on("close", (code) => resolve({ code, stdout, stderr }));
    });
  const behind = await github({ deployments: [{ id: 7, sha: OLD }] });
  try {
    const r = await run(behind);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /^deploy-if-behind: dispatched — Pages serves bbbbbbbbbbbb, main is aaaaaaaaaaaa\n$/);
    const broken = await run(behind, { GITHUB_TOKEN: "" });
    assert.equal(broken.code, 1);
    assert.match(broken.stderr, /FAILED: GITHUB_TOKEN is required/);
  } finally {
    await behind.close();
  }
});
