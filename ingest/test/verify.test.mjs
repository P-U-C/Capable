// S3: what ingest checks about a message on its own: hash form, fid, and BLAKE3 of dataBytes against hash and data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { blake3, bytesOf, castFacts, checkMessage, decodeMessageData, toHex } from "../src/verify.mjs";
import { cast, fixture } from "./helpers.mjs";

// The official BLAKE3 test vectors use input bytes i % 251 (github.com/BLAKE3-team/BLAKE3, test_vectors.json),
// here cross-checked against an independent implementation. 32-byte hashes.
const VECTORS = {
  0: "af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262",
  1: "2d3adedff11b61f14c886e35afa036736dcd87a74d27b5c1510225d0f592e213",
  63: "e9bc37a594daad83be9470df7f7b3798297c3d834ce80ba85d6e207627b7db7b",
  64: "4eed7141ea4a5cd4b788606bd23f46e212af9cacebacdc7d1f4c6dc7f2511b98",
  65: "de1e5fa0be70df6d2be8fffd0e99ceaa8eb6e8c93a63f2d8d1c30ecb6b263dee",
  1023: "10108970eeda3eb932baac1428c7a2163b0e924c9a9e25b35bba72b28f70bd11",
  1024: "42214739f095a406f3fc83deb889744ac00df831c10daa55189b5d121c855af7",
  1025: "d00278ae47eb27b34faecf67b4fe263f82d5412916c1ffd97c8cb7fb814b8444",
  2048: "e776b6028c7cd22a4d0ba182a8bf62205d2ef576467e838ed6f2529b85fba24a",
  2049: "5f4d72f40d7a5f82b15ca2b2e44b1de3c2ef86c426c95c1af0b6879522563030",
  3072: "b98cb0ff3623be03326b373de6b9095218513e64f1ee2edd2525c7ad1e5cffd2",
  3073: "7124b49501012f81cc7f11ca069ec9226cecb8a2c850cfe644e327d22d3e1cd3",
  4096: "015094013f57a5277b59d8475c0501042c0b642e531b0a1c8f58d2163229e969",
  4097: "9b4052b38f1c5fc8b1f9ff7ac7b27cd242487b3d890d15c96a1c25b8aa0fb995",
  5121: "628bd2cb2004694adaab7bbd778a25df25c47b9d4155a55f8fbd79f2fe154cff",
  8193: "bab6c09cb8ce8cf459261398d2e7aef35700bf488116ceb94a36d0f5f1b7bc3b",
  16384: "f875d6646de28985646f34ee13be9a576fd515f76b5b0a26bb324735041ddde4",
  31744: "62b6960e1a44bcc1eb1a611a8d6235b6b4b78f32e7abc4fb4c6cdcce94895c47",
  102400: "bc3e3d41a1146b069abffad3c0d44860cf664390afce4d9661f7902e7943e085",
};

test("BLAKE3 matches the reference vectors (one block, one chunk, many chunks, uneven trees)", () => {
  for (const [n, hex] of Object.entries(VECTORS)) {
    const input = Uint8Array.from({ length: Number(n) }, (_, i) => i % 251);
    assert.equal(toHex(blake3(input)), `0x${hex}`, `length ${n}`);
    assert.equal(toHex(blake3(input, 20)), `0x${hex.slice(0, 40)}`, `length ${n}, 20 bytes (a Farcaster hash)`);
  }
  assert.equal(toHex(blake3("abc")), "0x6437b3ac38465133ffb63b75273a8db548c558465d79db03fd359c6cd5bd9d85");
  assert.equal(blake3(new Uint8Array(0), 100).length, 100, "extendable output");
});

const signed = () => structuredClone(fixture("signed-messages.json").messages);

test("a node's message with dataBytes: BLAKE3 of the bytes is its hash, and the bytes say what its JSON says", () => {
  for (const m of signed()) {
    assert.deepEqual(checkMessage(m, { fid: m.data.fid }), { ok: true, verified: true }, m.data.type);
    const d = decodeMessageData(bytesOf(m.dataBytes));
    assert.equal(d.fid, m.data.fid);
    assert.equal(d.timestamp, m.data.timestamp);
  }
  const [prize, reply, user] = signed();
  const d = decodeMessageData(bytesOf(reply.dataBytes));
  assert.deepEqual(d.cast.parentCastId, { fid: 1, hash: prize.hash });
  assert.deepEqual(d.cast.embeds, [{ url: "https://stream.farcaster.xyz/v1/video/abc.m3u8" }, { castId: { fid: 1, hash: prize.hash } }]);
  assert.deepEqual(decodeMessageData(bytesOf(user.dataBytes)).userData, { type: 2, value: "Verified Person" });
  // Hex dataBytes are read too.
  assert.deepEqual(checkMessage({ ...prize, dataBytes: toHex(bytesOf(prize.dataBytes)) }), { ok: true, verified: true });
});

test("a message is not believed when its JSON and its bytes disagree, or its hash is not BLAKE3 of them", () => {
  const tamper = (f) => {
    const [m] = signed();
    f(m);
    return checkMessage(m);
  };
  assert.match(tamper((m) => (m.data.castAddBody.text = "$9999 FOR SOMETHING ELSE")).reason, /data does not match dataBytes/);
  assert.match(tamper((m) => (m.data.castAddBody.embeds = [{ url: "https://evil.example/x.m3u8" }])).reason, /data does not match/);
  assert.match(tamper((m) => (m.data.castAddBody.parentCastId = { fid: 1, hash: "0x" + "1".repeat(40) })).reason, /data does not match/);
  assert.match(tamper((m) => (m.data.timestamp += 1)).reason, /data does not match/);
  assert.match(tamper((m) => (m.data.fid = 37)).reason, /data does not match/);
  assert.match(tamper((m) => (m.data.type = "MESSAGE_TYPE_CAST_REMOVE")).reason, /data does not match/);
  assert.match(tamper((m) => (m.hash = "0x" + "1".repeat(40))).reason, /hash is not BLAKE3 of dataBytes/);
  assert.match(tamper((m) => (m.dataBytes = Buffer.from(bytesOf(m.dataBytes).map((b, i) => (i === 10 ? b ^ 1 : b))).toString("base64"))).reason, /hash is not BLAKE3/);
  assert.match(tamper((m) => (m.dataBytes = "!!not base64!!")).reason, /not base64 or hex/);
  const [, , user] = signed();
  user.data.userDataBody.value = "Someone Else";
  assert.match(checkMessage(user).reason, /data does not match/);
});

test("every message: a 20-byte hash and the fid it was asked about; without dataBytes it is well formed, not verified", () => {
  const m = cast({ fid: 1, hash: "0x5e70000000000000000000000000000000000001", text: "hi" });
  assert.deepEqual(checkMessage(m, { fid: 1 }), { ok: true, verified: false });
  assert.deepEqual(checkMessage({ ...m, hash: m.hash.toUpperCase().replace("0X", "0x") }, { fid: 1 }), { ok: true, verified: false }, "hex case does not matter");
  assert.match(checkMessage(m, { fid: 37 }).reason, /fid 1, asked about 37/);
  for (const hash of ["0x5e7000", "0x" + "g".repeat(40), "5e70000000000000000000000000000000000001", "0x" + "a".repeat(64), undefined, 42]) assert.match(checkMessage({ ...m, hash }).reason, /20-byte hash/, String(hash));
  assert.match(checkMessage({ ...m, data: { ...m.data, fid: 0 } }).reason, /no fid/);
  assert.match(checkMessage({ hash: m.hash }).reason, /no fid/);
});

test("castFacts: two readings agree on what ingest reads, whatever else differs", () => {
  const [prize] = signed();
  const same = { ...structuredClone(prize), signature: "other", dataBytes: undefined, data: { ...structuredClone(prize.data), network: "X", castAddBody: { ...prize.data.castAddBody, mentions: [9], embedsDeprecated: ["x"] } } };
  assert.equal(castFacts(same), castFacts(prize));
  for (const f of [(m) => (m.data.castAddBody.text += "!"), (m) => (m.data.castAddBody.embeds = []), (m) => (m.data.timestamp += 1), (m) => (m.hash = "0x" + "2".repeat(40)), (m) => (m.data.castAddBody.parentUrl = "https://x.example")]) {
    const m = structuredClone(prize);
    f(m);
    assert.notEqual(castFacts(m), castFacts(prize));
  }
});
