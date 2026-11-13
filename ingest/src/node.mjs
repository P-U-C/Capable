// Snapchain / Hypersnap `/v1` HTTP client with ordered fallback and fail-closed errors.
//
// - Nodes are tried in order. A network error, a timeout (5 s per request by
//   default), a 5xx, a 404, 408, 425 or 429 (a lagging, pruned or rate-limited
//   node), or a body that is not the expected JSON moves on to the next node.
// - Any other 4xx is a real answer from a working node: it is surfaced as
//   NodeHttpError and no other node is tried.
// - If every node fails, NodeUnavailable is thrown, listing the nodes tried.
//   If every node answered 404, the nodes agree there is nothing there: that is
//   surfaced as NodeHttpError (404), an answer, not an outage.
// - Pagination never returns partial results: a sequence of pages is read from
//   one node; if that node fails part-way, the whole sequence restarts on the
//   next node; if all fail, it throws.
// - A body larger than 5 MB (declared or counted while streaming) is a failure
//   of that node, like a timeout (review S19).
// - A node that fails (anything but a 404) is demoted for the rest of the run:
//   later requests try it only after every other node (review S19), and
//   cross-node checks (probeCast) no longer ask it.

export const DEFAULT_TIMEOUT_MS = 5000;
/** The largest response body read from a node. */
export const MAX_BODY_BYTES = 5 * 1024 * 1024;
/** 4xx statuses that mean "this node cannot answer now", not "no such thing": try the next node. */
export const FAILOVER_STATUSES = Object.freeze([404, 408, 425, 429]);
const FAILOVER_STATUS = new Set(FAILOVER_STATUSES);

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
class Failover extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

/** Every node failed. If every one answered 404, that is an answer (NodeHttpError 404); otherwise NodeUnavailable. */
function allFailed(request, attempts) {
  if (attempts.length && attempts.every((a) => a.status === 404)) {
    const last = attempts[attempts.length - 1];
    return new NodeHttpError(last.node, request, 404, last.body);
  }
  return new NodeUnavailable(request, attempts.map(({ node, reason }) => ({ node, reason })));
}

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

/** Read a body as text, at most `limit` bytes: a larger declared or streamed body is a Failover. */
async function readBody(res, limit) {
  const declared = Number(res.headers?.get?.("content-length"));
  if (Number.isFinite(declared) && declared > limit) {
    try {
      await res.body?.cancel?.();
    } catch {}
    throw new Failover(`response too large: ${declared} bytes declared, limit ${limit}`);
  }
  if (!res.body || typeof res.body.getReader !== "function") {
    const text = await res.text();
    if (Buffer.byteLength(text) > limit) throw new Failover(`response too large: over ${limit} bytes`);
    return text;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > limit) {
      try {
        await reader.cancel();
      } catch {}
      throw new Failover(`response too large: over ${limit} bytes`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * @param {{ nodes: string[], timeoutMs?: number, maxBodyBytes?: number, fetch?: typeof fetch }} opts
 */
export function createClient({ nodes, timeoutMs = DEFAULT_TIMEOUT_MS, maxBodyBytes = MAX_BODY_BYTES, fetch: fetchImpl = globalThis.fetch } = {}) {
  if (!Array.isArray(nodes) || nodes.length === 0) throw new TypeError("createClient: at least one node URL is required");
  const bases = [...new Set(nodes.map(normalizeBase))];
  const answered = new Set(); // nodes that gave at least one real answer (2xx or 4xx)
  const demoted = new Set(); // nodes that failed this run: asked last, never probed
  /** Nodes in the order to try them: healthy ones in configured order, then demoted ones. */
  const order = () => [...bases.filter((b) => !demoted.has(b)), ...bases.filter((b) => demoted.has(b))];
  const demote = (base, err) => {
    if (err instanceof Failover && err.status !== 404) demoted.add(base);
  };

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
        body = await readBody(res, maxBodyBytes);
      } catch (err) {
        if (err instanceof Failover) throw err;
        throw new Failover(ctrl.signal.aborted ? `timeout after ${timeoutMs} ms` : `body read failed: ${err?.message || err}`);
      }
      if (res.status >= 500) throw new Failover(`HTTP ${res.status}`);
      if (FAILOVER_STATUS.has(res.status)) throw new Failover(`HTTP ${res.status}`, { status: res.status, body });
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
    for (const base of order()) {
      try {
        const json = await getFrom(base, path, params);
        if (check) check(json);
        return json;
      } catch (err) {
        if (!(err instanceof Failover)) throw err;
        demote(base, err);
        attempts.push({ node: base, reason: err.message, status: err.status, body: err.body });
      }
    }
    throw allFailed(`${path}${query(params)}`, attempts);
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
    for (const base of order()) {
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
        demote(base, err);
        attempts.push({ node: base, reason: pages ? `${err.message} (after ${pages} page${pages === 1 ? "" : "s"})` : err.message, status: err.status, body: err.body });
      }
    }
    throw allFailed(`${path}${query(params)}`, attempts);
  }

  const page = (path) => (params) => get(path, params, pageShape);
  const messageShape = (json) => {
    if (!json.data || typeof json.data !== "object") throw new Failover("response is not a message");
  };

  /**
   * Ask one node, and only that node, for a cast (a cross-node check: review S3).
   * Resolves to { status: "found", message, node } | { status: "missing", node }
   * (404, or a "not found" error code) | { status: "unavailable", node, reason }
   * (anything else: never read as an answer either way). Never throws for a node's failure.
   */
  async function probeCast(base, fid, hash) {
    try {
      const json = await getFrom(base, "/v1/castById", { fid, hash });
      messageShape(json);
      return { status: "found", message: json, node: base };
    } catch (err) {
      if (err instanceof Failover && err.status === 404) return { status: "missing", node: base };
      if (err instanceof NodeHttpError && /not.?found/i.test(String(err.body))) return { status: "missing", node: base };
      if (err instanceof Failover) demote(base, err);
      else if (!(err instanceof NodeHttpError)) throw err;
      return { status: "unavailable", node: base, reason: err.message };
    }
  }

  return {
    nodes: bases,
    timeoutMs,
    maxBodyBytes,
    /** The configured nodes that answered at least one request, in configured order. */
    answeredNodes: () => bases.filter((b) => answered.has(b)),
    /** The nodes demoted this run (they failed), in configured order. */
    demotedNodes: () => bases.filter((b) => demoted.has(b)),
    /** Nodes other than `source` that may be asked to confirm what `source` said: healthy ones only, in configured order. */
    witnesses: (source) => bases.filter((b) => b !== source && !demoted.has(b)),
    probeCast,
    get,
    paginate,
    /** One page of a fid's casts. */
    castsByFid: (fid, { pageSize, reverse, pageToken } = {}) => page("/v1/castsByFid")({ fid, pageSize, reverse, pageToken }),
    /** One page of direct replies to a cast. */
    castsByParent: (fid, hash, { pageSize, pageToken } = {}) => page("/v1/castsByParent")({ fid, hash, pageSize, pageToken }),
    /** One cast. Resolves to the message object. */
    castById: (fid, hash) => get("/v1/castById", { fid, hash }, messageShape),
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
