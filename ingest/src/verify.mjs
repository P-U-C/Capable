// What ingest can check about a message on its own (review S3). Pure, no dependencies.
//
// Verified here:
//   - the hash is a well-formed 20-byte cast hash (0x + 40 hex);
//   - the message's fid is the fid it was asked about (where there is one);
//   - when a node sends `dataBytes`: BLAKE3(dataBytes), cut to 20 bytes, equals
//     `hash`, and the fields ingest reads (type, fid, timestamp, cast text,
//     embeds, parent; user-data type and value) decode from those bytes to the
//     same values as the node's JSON `data`.
// Not verified, and why:
//   - the Ed25519 signature and the signer key. A signature only binds the
//     message to a key; whether that key belongs to the fid is on-chain state
//     (the key registry), which ingest cannot read without trusting a node
//     again. A node that forges a cast can hash and sign it with its own key.
//   - messages without `dataBytes`: re-encoding `data` to recompute the hash
//     depends on the encoder, so a mismatch would not prove anything.
// The defence against a lying or lagging node is agreement: refresh asks a
// second node before it believes a prize or results cast, or a deletion
// (src/refresh.mjs). BLAKE3 here catches a node that serves inconsistent bytes.

const HASH = /^0x[0-9a-f]{40}$/;

// ---------------------------------------------------------------- BLAKE3 (hash mode, the reference algorithm)

const IV = Uint32Array.of(0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19);
const PERMUTATION = [2, 6, 3, 10, 7, 0, 4, 13, 1, 11, 12, 5, 9, 14, 15, 8];
const CHUNK_START = 1;
const CHUNK_END = 2;
const PARENT = 4;
const ROOT = 8;
const BLOCK_LEN = 64;
const CHUNK_LEN = 1024;

const rotr = (x, n) => (x >>> n) | (x << (32 - n));

function g(s, a, b, c, d, x, y) {
  s[a] = s[a] + s[b] + x;
  s[d] = rotr(s[d] ^ s[a], 16);
  s[c] = s[c] + s[d];
  s[b] = rotr(s[b] ^ s[c], 12);
  s[a] = s[a] + s[b] + y;
  s[d] = rotr(s[d] ^ s[a], 8);
  s[c] = s[c] + s[d];
  s[b] = rotr(s[b] ^ s[c], 7);
}

/** The compression function: 16 output words (the first 8 are the next chaining value). */
function compress(cv, block, counter, blockLen, flags) {
  const s = new Uint32Array(16);
  s.set(cv, 0);
  s.set(IV.subarray(0, 4), 8);
  s[12] = counter % 0x100000000;
  s[13] = Math.floor(counter / 0x100000000);
  s[14] = blockLen;
  s[15] = flags;
  let m = Uint32Array.from(block);
  for (let r = 0; r < 7; r++) {
    g(s, 0, 4, 8, 12, m[0], m[1]);
    g(s, 1, 5, 9, 13, m[2], m[3]);
    g(s, 2, 6, 10, 14, m[4], m[5]);
    g(s, 3, 7, 11, 15, m[6], m[7]);
    g(s, 0, 5, 10, 15, m[8], m[9]);
    g(s, 1, 6, 11, 12, m[10], m[11]);
    g(s, 2, 7, 8, 13, m[12], m[13]);
    g(s, 3, 4, 9, 14, m[14], m[15]);
    if (r < 6) m = Uint32Array.from(PERMUTATION, (i) => m[i]);
  }
  for (let i = 0; i < 8; i++) {
    s[i] ^= s[i + 8];
    s[i + 8] ^= cv[i];
  }
  return s;
}

/** Up to 64 bytes → 16 little-endian words, zero-padded. */
function words(bytes) {
  const w = new Uint32Array(16);
  for (let i = 0; i < bytes.length; i++) w[i >> 2] |= bytes[i] << (8 * (i & 3));
  return w;
}

/** A node's output before it is turned into a chaining value or root bytes. */
const output = (cv, block, counter, blockLen, flags) => ({ cv, block, counter, blockLen, flags });
const chainingValue = (o) => compress(o.cv, o.block, o.counter, o.blockLen, o.flags).subarray(0, 8);

/** The output of one chunk (≤ 1024 bytes), the `index`-th of the input. */
function chunkOutput(chunk, index) {
  let cv = IV;
  const blocks = Math.max(1, Math.ceil(chunk.length / BLOCK_LEN));
  for (let j = 0; j < blocks - 1; j++) {
    cv = compress(cv, words(chunk.subarray(j * BLOCK_LEN, (j + 1) * BLOCK_LEN)), index, BLOCK_LEN, j === 0 ? CHUNK_START : 0).subarray(0, 8);
  }
  const last = chunk.subarray((blocks - 1) * BLOCK_LEN);
  return output(cv, words(last), index, last.length, (blocks === 1 ? CHUNK_START : 0) | CHUNK_END);
}

function parentOutput(left, right) {
  const block = new Uint32Array(16);
  block.set(left, 0);
  block.set(right, 8);
  return output(IV, block, 0, BLOCK_LEN, PARENT);
}

/** BLAKE3 (unkeyed) of `input`, `outLen` bytes (default 32). */
export function blake3(input, outLen = 32) {
  const bytes = input instanceof Uint8Array ? input : new TextEncoder().encode(String(input));
  const chunks = Math.max(1, Math.ceil(bytes.length / CHUNK_LEN));
  const stack = [];
  for (let i = 0; i < chunks - 1; i++) {
    let cv = chainingValue(chunkOutput(bytes.subarray(i * CHUNK_LEN, (i + 1) * CHUNK_LEN), i));
    // Merge completed subtrees: one merge per trailing zero bit of the chunk count so far.
    for (let total = i + 1; (total & 1) === 0; total >>= 1) cv = chainingValue(parentOutput(stack.pop(), cv));
    stack.push(cv);
  }
  let out = chunkOutput(bytes.subarray((chunks - 1) * CHUNK_LEN), chunks - 1);
  while (stack.length) out = parentOutput(stack.pop(), chainingValue(out));
  const result = new Uint8Array(outLen);
  for (let block = 0, at = 0; at < outLen; block++) {
    const w = compress(out.cv, out.block, block, out.blockLen, out.flags | ROOT);
    for (let i = 0; i < 64 && at < outLen; i++, at++) result[at] = (w[i >> 2] >>> (8 * (i & 3))) & 0xff;
  }
  return result;
}

export const toHex = (bytes) => `0x${Buffer.from(bytes).toString("hex")}`;

// ---------------------------------------------------------------- protobuf (just enough of MessageData)

const MESSAGE_TYPES = {
  MESSAGE_TYPE_CAST_ADD: 1,
  MESSAGE_TYPE_CAST_REMOVE: 2,
  MESSAGE_TYPE_REACTION_ADD: 3,
  MESSAGE_TYPE_REACTION_REMOVE: 4,
  MESSAGE_TYPE_LINK_ADD: 5,
  MESSAGE_TYPE_LINK_REMOVE: 6,
  MESSAGE_TYPE_VERIFICATION_ADD_ETH_ADDRESS: 7,
  MESSAGE_TYPE_VERIFICATION_REMOVE: 8,
  MESSAGE_TYPE_USER_DATA_ADD: 11,
};
const USER_DATA_TYPES = { USER_DATA_TYPE_DISPLAY: 2, USER_DATA_TYPE_USERNAME: 6 };

/** Protobuf fields of `bytes`: [{ no, wire, value }] (varint → BigInt, length-delimited → bytes). Throws on malformed input. */
function fields(bytes) {
  const out = [];
  let pos = 0;
  const varint = () => {
    let x = 0n;
    for (let shift = 0n; ; shift += 7n) {
      if (pos >= bytes.length || shift > 63n) throw new Error("bad varint");
      const b = bytes[pos++];
      x |= BigInt(b & 0x7f) << shift;
      if (!(b & 0x80)) return x;
    }
  };
  while (pos < bytes.length) {
    const key = varint();
    const no = Number(key >> 3n);
    const wire = Number(key & 7n);
    if (wire === 0) out.push({ no, wire, value: varint() });
    else if (wire === 2) {
      const len = Number(varint());
      if (pos + len > bytes.length) throw new Error("truncated field");
      out.push({ no, wire, value: bytes.subarray(pos, pos + len) });
      pos += len;
    } else if (wire === 1) pos += 8;
    else if (wire === 5) pos += 4;
    else throw new Error(`unsupported wire type ${wire}`);
    if (pos > bytes.length) throw new Error("truncated field");
  }
  return out;
}

const utf8 = (b) => new TextDecoder("utf-8", { fatal: true }).decode(b);
const last = (fs, no) => fs.filter((f) => f.no === no).at(-1);
const num = (f) => (f && f.wire === 0 ? Number(f.value) : 0);
const str = (f) => (f && f.wire === 2 ? utf8(f.value) : "");

function castIdOf(bytes) {
  const fs = fields(bytes);
  const h = last(fs, 2);
  return { fid: num(last(fs, 1)), hash: h && h.wire === 2 ? toHex(h.value) : "0x" };
}

/** The fields ingest reads, decoded from MessageData bytes. */
export function decodeMessageData(bytes) {
  const fs = fields(bytes);
  const p = { type: num(last(fs, 1)), fid: num(last(fs, 2)), timestamp: num(last(fs, 3)) };
  const cast = last(fs, 5);
  if (cast && cast.wire === 2) {
    const cf = fields(cast.value);
    const c = { text: str(last(cf, 4)), embeds: [] };
    const parent = last(cf, 3);
    if (parent && parent.wire === 2) c.parentCastId = castIdOf(parent.value);
    const parentUrl = last(cf, 7);
    if (parentUrl) c.parentUrl = str(parentUrl);
    for (const e of cf.filter((f) => f.no === 6 && f.wire === 2)) {
      const ef = fields(e.value);
      const url = last(ef, 1);
      const id = last(ef, 2);
      c.embeds.push(url ? { url: str(url) } : id && id.wire === 2 ? { castId: castIdOf(id.value) } : {});
    }
    p.cast = c;
  }
  const user = last(fs, 12);
  if (user && user.wire === 2) {
    const uf = fields(user.value);
    p.userData = { type: num(last(uf, 1)), value: str(last(uf, 2)) };
  }
  return p;
}

/** A hash or bytes field from a node's JSON: "0x…" hex, or base64. Lowercase hex out, or null. */
function hexOf(v) {
  if (typeof v !== "string") return null;
  if (/^0x[0-9a-f]*$/i.test(v)) return v.toLowerCase();
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(v) || v.length % 4 === 1) return null;
  return toHex(Buffer.from(v, "base64"));
}

/** Bytes from a node's JSON bytes field (base64, or "0x" hex), or null. */
export function bytesOf(v) {
  const h = hexOf(v);
  return h === null ? null : Uint8Array.from(Buffer.from(h.slice(2), "hex"));
}

const castIdJson = (c) => ({ fid: Number(c?.fid) || 0, hash: hexOf(c?.hash) ?? "" });

/** Does the decoded MessageData say what the node's JSON `data` says, for every field ingest reads? */
export function sameAsJson(decoded, data) {
  if (!data || typeof data !== "object") return false;
  if (decoded.fid !== data.fid || decoded.timestamp !== data.timestamp) return false;
  const type = Object.hasOwn(MESSAGE_TYPES, data.type) ? MESSAGE_TYPES[data.type] : null;
  if (type !== null && decoded.type !== type) return false;
  if (type === MESSAGE_TYPES.MESSAGE_TYPE_CAST_ADD) {
    const b = data.castAddBody;
    const c = decoded.cast;
    if (!b || !c || (b.text ?? "") !== c.text) return false;
    if (Boolean(b.parentCastId) !== Boolean(c.parentCastId)) return false;
    if (b.parentCastId && JSON.stringify(castIdJson(b.parentCastId)) !== JSON.stringify(c.parentCastId)) return false;
    if ((b.parentUrl ?? undefined) !== c.parentUrl) return false;
    const embeds = (Array.isArray(b.embeds) ? b.embeds : []).map((e) => (typeof e?.url === "string" ? { url: e.url } : e?.castId ? { castId: castIdJson(e.castId) } : {}));
    if (JSON.stringify(embeds) !== JSON.stringify(c.embeds)) return false;
  }
  if (type === MESSAGE_TYPES.MESSAGE_TYPE_USER_DATA_ADD && Object.hasOwn(USER_DATA_TYPES, data.userDataBody?.type)) {
    const u = decoded.userData;
    if (!u || u.type !== USER_DATA_TYPES[data.userDataBody.type] || u.value !== data.userDataBody.value) return false;
  }
  return true;
}

/**
 * Check one message from a node. Resolves to
 *   { ok: true, verified: true }   — dataBytes present, hash and fields match;
 *   { ok: true, verified: false }  — well formed, nothing more to check (no dataBytes);
 *   { ok: false, reason }          — not to be believed.
 * @param {object} m          a message from a node
 * @param {{ fid?: number }} [expect]  the fid it was asked about, if any
 */
export function checkMessage(m, { fid } = {}) {
  const hash = typeof m?.hash === "string" ? m.hash.toLowerCase() : "";
  if (!HASH.test(hash)) return { ok: false, reason: "hash is not a 20-byte hash" };
  const d = m?.data;
  if (!d || typeof d !== "object" || !Number.isInteger(d.fid) || d.fid <= 0) return { ok: false, reason: "no fid" };
  if (fid !== undefined && d.fid !== fid) return { ok: false, reason: `fid ${d.fid}, asked about ${fid}` };
  if (m.dataBytes === undefined || m.dataBytes === null || m.dataBytes === "") return { ok: true, verified: false };
  const bytes = bytesOf(m.dataBytes);
  if (!bytes) return { ok: false, reason: "dataBytes is not base64 or hex" };
  if (toHex(blake3(bytes, 20)) !== hash) return { ok: false, reason: "hash is not BLAKE3 of dataBytes" };
  let decoded;
  try {
    decoded = decodeMessageData(bytes);
  } catch (err) {
    return { ok: false, reason: `dataBytes do not decode: ${err.message}` };
  }
  if (!sameAsJson(decoded, d)) return { ok: false, reason: "data does not match dataBytes" };
  return { ok: true, verified: true };
}

/**
 * What two nodes must agree on for a cast: the fields ingest reads, normalized.
 * Two readings of one cast agree when these are equal.
 */
export function castFacts(m) {
  const d = m?.data;
  const b = d?.castAddBody;
  return JSON.stringify({
    hash: typeof m?.hash === "string" ? m.hash.toLowerCase() : null,
    type: d?.type ?? null,
    fid: d?.fid ?? null,
    timestamp: d?.timestamp ?? null,
    text: b?.text ?? null,
    parent: b?.parentCastId ? castIdJson(b.parentCastId) : null,
    parentUrl: b?.parentUrl ?? null,
    embeds: (Array.isArray(b?.embeds) ? b.embeds : []).map((e) => (typeof e?.url === "string" ? { url: e.url } : e?.castId ? { castId: castIdJson(e.castId) } : {})),
  });
}
