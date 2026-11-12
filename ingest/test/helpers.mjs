// Shared test helpers: fixtures, a local Snapchain stub, and a CLI runner. No external network.
import http from "node:http";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");
export const FIXTURES = `${ROOT}/ingest/test/fixtures`;
export const CLI = `${ROOT}/ingest/bin/refresh.mjs`;

export const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
export const fixture = (name) => readJson(`${FIXTURES}/${name}`);
export const meta = () => readJson(`${ROOT}/content/book.meta.json`);
export const seedPrizes = () => readJson(`${ROOT}/content/seed/prizes.json`);
export const seedSubmissions = () => readJson(`${ROOT}/content/seed/submissions.json`);
export const seedPeople = () => readJson(`${ROOT}/content/seed/people.json`);
export const sampleBook = () => readJson(`${ROOT}/contract/fixtures/book.sample.json`);

/** All cast messages from the castsByFid fixtures (both watched fids). */
export function watchedCasts() {
  return [...fixture("casts-fid37.page1.json").messages, ...fixture("casts-fid37.page2.json").messages, ...fixture("casts-fid1.json").messages];
}

export const byHash = (messages, hash) => {
  const m = messages.find((x) => x.hash === hash);
  if (!m) throw new Error(`fixture has no cast ${hash}`);
  return m;
};

const FC_EPOCH = 1609459200;
/** A Snapchain CAST_ADD message. */
export function cast({ fid, hash, at = "2026-11-10T00:00:00Z", text = "", embeds = [], parent, parentUrl, type = "MESSAGE_TYPE_CAST_ADD" }) {
  const body = { embedsDeprecated: [], mentions: [], text, mentionsPositions: [], embeds, type: "CAST" };
  if (parent) body.parentCastId = parent;
  if (parentUrl) body.parentUrl = parentUrl;
  const data = { type, fid, timestamp: Date.parse(at) / 1000 - FC_EPOCH, network: "FARCASTER_NETWORK_MAINNET" };
  if (type === "MESSAGE_TYPE_CAST_ADD") data.castAddBody = body;
  else data.castRemoveBody = { targetHash: hash };
  return { data, hash, hashScheme: "HASH_SCHEME_BLAKE3", signature: "c2ln", signatureScheme: "SIGNATURE_SCHEME_ED25519", signer: "0x" + "ab".repeat(32) };
}

/** Start an HTTP server on 127.0.0.1 with a handler; records every request URL. */
export async function stubServer(handler) {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push(req.url);
    handler(req, res, new URL(req.url, "http://stub"));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

export const sendJson = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
};

/** A URL on which nothing listens (connection refused). */
export async function deadUrl() {
  const s = await stubServer(() => {});
  const url = s.url;
  await s.close();
  return url;
}

/** Run the refresh CLI asynchronously (so in-process stub servers keep answering). */
export function runCli(args, { env = {} } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], { cwd: ROOT, env: { ...process.env, TZ: "UTC", ...env } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}
