// Snapchain / Hypersnap `/v1` HTTP client with ordered fallback and fail-closed errors.
//
// - Nodes are tried in order. A network error, a timeout (5 s per request by
//   default), a 5xx, or a body that is not the expected JSON moves on to the
//   next node.
// - A 4xx is a real answer from a working node: it is surfaced as NodeHttpError
//   and no other node is tried.
// - If every node fails, NodeUnavailable is thrown, listing the nodes tried.
// - Pagination never returns partial results: a sequence of pages is read from
//   one node; if that node fails part-way, the whole sequence restarts on the
//   next node; if all fail, it throws.

export const DEFAULT_TIMEOUT_MS = 5000;

/** Every configured node failed (network error, timeout, 5xx or malformed body). */
export class NodeUnavailable extends Error {
  constructor(request, attempts) {
    const detail = attempts.map((a) => `${a.node} (${a.reason})`).join("; ");
    super(`no node answered ${request}: ${detail || "no nodes configured"}`);
    this.name = "NodeUnavailable";
    this.request = request;
    this.nodes = attempts.map((a) => a.node);
    this.attempts = attempts;
  }
}

/** A node answered with a 4xx. This is an answer, not an outage. */
export class NodeHttpError extends Error {
  constructor(node, request, status, body) {
    super(`${node} answered ${request} with HTTP ${status}${body ? `: ${String(body).slice(0, 200)}` : ""}`);
    this.name = "NodeHttpError";
    this.node = node;
    this.request = request;
    this.status = status;
    this.body = body;
  }
}

/** Internal: this node failed in a way that justifies trying the next one. */
class Failover extends Error {}

function query(params) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null || v === "") continue;
    q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

function normalizeBase(base) {
  const u = new URL(base);
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new TypeError(`node URL must be http(s): ${base}`);
  return base.replace(/\/+$/, "");
}

/**
 * @param {{ nodes: string[], timeoutMs?: number, fetch?: typeof fetch }} opts
 */
export function createClient({ nodes, timeoutMs = DEFAULT_TIMEOUT_MS, fetch: fetchImpl = globalThis.fetch } = {}) {
  if (!Array.isArray(nodes) || nodes.length === 0) throw new TypeError("createClient: at least one node URL is required");
  const bases = nodes.map(normalizeBase);
  const answered = new Set(); // nodes that gave at least one real answer (2xx or 4xx)

  /** One GET against one node. Resolves to parsed JSON, or throws Failover / NodeHttpError. */
  async function getFrom(base, path, params) {
    const request = `${path}${query(params)}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      let res;
      try {
        res = await fetchImpl(`${base}${request}`, { signal: ctrl.signal, headers: { accept: "application/json" } });
      } catch (err) {
        const cause = err?.cause;
        const code = cause?.code || cause?.errors?.[0]?.code || cause?.message || err?.message || String(err);
        throw new Failover(ctrl.signal.aborted ? `timeout after ${timeoutMs} ms` : `network error: ${code}`);
      }
      let body;
      try {
        body = await res.text();
      } catch (err) {
        throw new Failover(ctrl.signal.aborted ? `timeout after ${timeoutMs} ms` : `body read failed: ${err?.message || err}`);
      }
      if (res.status >= 500) throw new Failover(`HTTP ${res.status}`);
      if (res.status >= 400) {
        answered.add(base);
        throw new NodeHttpError(base, request, res.status, body);
      }
      if (res.status < 200 || res.status >= 300) throw new Failover(`HTTP ${res.status}`);
      let json;
      try {
        json = JSON.parse(body);
      } catch {
        throw new Failover("response is not JSON");
      }
      if (json === null || typeof json !== "object" || Array.isArray(json)) throw new Failover("response is not a JSON object");
      answered.add(base);
      return json;
    } finally {
      clearTimeout(timer);
    }
  }

  /** GET with ordered failover across nodes. */
  async function get(path, params, check) {
    const attempts = [];
    for (const base of bases) {
      try {
        const json = await getFrom(base, path, params);
        if (check) check(json);
        return json;
      } catch (err) {
        if (!(err instanceof Failover)) throw err;
        attempts.push({ node: base, reason: err.message });
      }
    }
    throw new NodeUnavailable(`${path}${query(params)}`, attempts);
  }

  const pageShape = (json) => {
    if (!Array.isArray(json.messages)) throw new Failover("response has no messages array");
    if (json.nextPageToken != null && typeof json.nextPageToken !== "string") throw new Failover("nextPageToken is not a string");
  };

  /**
   * Read up to maxPages pages of a paged endpoint, all from one node.
   * Resolves to { messages, pages, truncated, node }. Never resolves with partial
   * data: a failure part-way restarts the sequence on the next node.
   */
  async function paginate(path, params, { maxPages = 10 } = {}) {
    if (!Number.isInteger(maxPages) || maxPages < 1) throw new TypeError("paginate: maxPages must be a positive integer");
    const attempts = [];
    for (const base of bases) {
      const messages = [];
      let token;
      let pages = 0;
      let truncated = false;
      try {
        for (;;) {
          const json = await getFrom(base, path, { ...params, pageToken: token });
          pageShape(json);
          messages.push(...json.messages);
          pages += 1;
          token = json.nextPageToken || "";
          if (!token) break;
          if (pages >= maxPages) {
            truncated = true;
            break;
          }
        }
        return { messages, pages, truncated, node: base };
      } catch (err) {
        if (!(err instanceof Failover)) throw err;
        attempts.push({ node: base, reason: pages ? `${err.message} (after ${pages} page${pages === 1 ? "" : "s"})` : err.message });
      }
    }
    throw new NodeUnavailable(`${path}${query(params)}`, attempts);
  }

  const page = (path) => (params) => get(path, params, pageShape);

  return {
    nodes: bases,
    timeoutMs,
    /** The configured nodes that answered at least one request, in configured order. */
    answeredNodes: () => bases.filter((b) => answered.has(b)),
    get,
    paginate,
    /** One page of a fid's casts. */
    castsByFid: (fid, { pageSize, reverse, pageToken } = {}) => page("/v1/castsByFid")({ fid, pageSize, reverse, pageToken }),
    /** One page of direct replies to a cast. */
    castsByParent: (fid, hash, { pageSize, pageToken } = {}) => page("/v1/castsByParent")({ fid, hash, pageSize, pageToken }),
    /** One cast. Resolves to the message object. */
    castById: (fid, hash) =>
      get("/v1/castById", { fid, hash }, (json) => {
        if (!json.data || typeof json.data !== "object") throw new Failover("response is not a message");
      }),
    /** All user-data messages for a fid (username, display name, …). */
    userDataByFid: (fid) => get("/v1/userDataByFid", { fid }, pageShape),
    /** Up to maxPages pages of a fid's casts, newest first when reverse. */
    allCastsByFid: (fid, { pageSize = 100, reverse = true, maxPages = 3 } = {}) =>
      paginate("/v1/castsByFid", { fid, pageSize, reverse }, { maxPages }),
    /** Up to maxPages pages of direct replies to a cast. */
    allCastsByParent: (fid, hash, { pageSize = 100, maxPages = 10 } = {}) =>
      paginate("/v1/castsByParent", { fid, hash, pageSize }, { maxPages }),
  };
}
