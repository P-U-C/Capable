#!/usr/bin/env node
// Dispatch .github/workflows/deploy.yml when GitHub Pages is not serving the
// head of the branch (review S2). Run by refresh.yml after every scheduled
// refresh, so a refresh commit, an editor merge whose dispatch was lost, or a
// failed deploy is published within one schedule interval.
//
//   GITHUB_TOKEN=… GITHUB_REPOSITORY=owner/name [GITHUB_API_URL=…] \
//     node ingest/bin/deploy-if-behind.mjs [--ref main] [--workflow deploy.yml]
//
// Up to date: the newest github-pages deployment is for the head commit and its
// latest status is success, or a deploy of it was queued or started less than
// STUCK_MS ago (deploy.yml's two jobs time out after 25 minutes, so a status
// older than that is a runner that died; review V22). Anything else (another
// commit, a failure, a stuck deploy, no deployment yet) dispatches the workflow.
// Needs contents: read, deployments: read and actions: write. Exit 1 on an API error.

const UNDER_WAY = new Set(["queued", "pending", "in_progress"]);
/** A deploy queued or running for longer than this is stuck: dispatch again. */
export const STUCK_MS = 30 * 60 * 1000;

/** Should the head be deployed, given the newest Pages deployment, its latest status and when that status was set? */
export function decide({ head, deployment, state, at, now = Date.now() }) {
  if (!deployment) return { dispatch: true, why: "nothing has been deployed yet" };
  if (deployment.sha !== head) return { dispatch: true, why: `Pages serves ${String(deployment.sha).slice(0, 12)}, main is ${head.slice(0, 12)}` };
  if (state === "success") return { dispatch: false, why: `${head.slice(0, 12)} is deployed (${state})` };
  if (!UNDER_WAY.has(state)) return { dispatch: true, why: `the deploy of ${head.slice(0, 12)} is ${state || "without a status"}` };
  const since = Date.parse(at);
  if (!Number.isFinite(since) || now - since > STUCK_MS) return { dispatch: true, why: `the deploy of ${head.slice(0, 12)} has been ${state} since ${Number.isFinite(since) ? new Date(since).toISOString() : "an unknown time"}: stuck` };
  return { dispatch: false, why: `${head.slice(0, 12)} is being deployed (${state})` };
}

/** Check and, if behind, dispatch. Resolves to { dispatched, why, head }. */
export async function deployIfBehind({ api = "https://api.github.com", repo, token, ref = "main", workflow = "deploy.yml", fetch: fetchImpl = globalThis.fetch, now = Date.now() }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(String(repo))) throw new Error("GITHUB_REPOSITORY must be owner/name");
  if (!token) throw new Error("GITHUB_TOKEN is required");
  const headers = { accept: "application/vnd.github+json", authorization: `Bearer ${token}`, "x-github-api-version": "2022-11-28" };
  const call = async (path, init = {}) => {
    const res = await fetchImpl(`${api}/repos/${repo}${path}`, { ...init, headers: { ...headers, ...(init.headers || {}) } });
    if (!res.ok) throw new Error(`GitHub API ${init.method || "GET"} ${path}: HTTP ${res.status}`);
    return res.status === 204 ? null : res.json();
  };
  const head = (await call(`/commits/${encodeURIComponent(ref)}`))?.sha;
  if (!/^[0-9a-f]{40}$/.test(String(head))) throw new Error(`no head commit for ${ref}`);
  const [deployment] = (await call("/deployments?environment=github-pages&per_page=1")) || [];
  let state = null;
  let at = null;
  if (deployment && deployment.sha === head) [{ state, created_at: at } = {}] = (await call(`/deployments/${deployment.id}/statuses?per_page=1`)) || [];
  const d = decide({ head, deployment, state, at, now });
  if (d.dispatch) {
    await call(`/actions/workflows/${encodeURIComponent(workflow)}/dispatches`, { method: "POST", body: JSON.stringify({ ref }), headers: { "content-type": "application/json" } });
  }
  return { dispatched: d.dispatch, why: d.why, head };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const opt = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
  try {
    const r = await deployIfBehind({ api: process.env.GITHUB_API_URL || undefined, repo: process.env.GITHUB_REPOSITORY, token: process.env.GITHUB_TOKEN, ref: opt("--ref", "main"), workflow: opt("--workflow", "deploy.yml") });
    console.log(r.dispatched ? `deploy-if-behind: dispatched — ${r.why}` : `deploy-if-behind: up to date — ${r.why}`);
  } catch (err) {
    console.error(`deploy-if-behind: FAILED: ${err.message}`);
    process.exit(1);
  }
}
