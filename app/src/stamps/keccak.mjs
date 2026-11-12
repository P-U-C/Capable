// Keccak-256 (the original Keccak padding Ethereum uses, not SHA3-256), synchronous
// and dependency-free, so preview() can compute a stamp's seed without loading
// viem. A plain port of the Keccak-f[1600] reference permutation on 64-bit lanes.
// app/test/stamps.test.mjs checks it against viem's keccak256 on thousands of inputs,
// including every length around the 136-byte rate boundary.

const RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];
// rho rotation offsets and pi lane order, walked from lane 1 (the reference's compact form).
const ROT = [1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 2, 14, 27, 41, 56, 8, 25, 43, 62, 18, 39, 61, 20, 44].map(BigInt);
const PI = [10, 7, 11, 17, 18, 3, 5, 16, 8, 21, 24, 4, 15, 23, 19, 13, 12, 2, 20, 14, 22, 9, 6, 1];
const MASK = 0xffffffffffffffffn;
const RATE = 136; // bytes: 1600 - 2 × 256 bits

const rotl = (x, n) => ((x << n) | (x >> (64n - n))) & MASK;

function permute(st) {
  const bc = new BigUint64Array(5);
  for (let round = 0; round < 24; round++) {
    // θ
    for (let i = 0; i < 5; i++) bc[i] = st[i] ^ st[i + 5] ^ st[i + 10] ^ st[i + 15] ^ st[i + 20];
    for (let i = 0; i < 5; i++) {
      const t = bc[(i + 4) % 5] ^ rotl(bc[(i + 1) % 5], 1n);
      for (let j = 0; j < 25; j += 5) st[j + i] ^= t;
    }
    // ρ and π
    let t = st[1];
    for (let i = 0; i < 24; i++) {
      const j = PI[i];
      const next = st[j];
      st[j] = rotl(t, ROT[i]);
      t = next;
    }
    // χ
    for (let j = 0; j < 25; j += 5) {
      for (let i = 0; i < 5; i++) bc[i] = st[j + i];
      for (let i = 0; i < 5; i++) st[j + i] ^= ~bc[(i + 1) % 5] & bc[(i + 2) % 5];
    }
    // ι
    st[0] ^= RC[round];
  }
}

/** keccak256 of bytes → 32 bytes. */
export function keccak256(bytes) {
  const msg = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  const padded = new Uint8Array(Math.floor(msg.length / RATE) * RATE + RATE);
  padded.set(msg);
  padded[msg.length] ^= 0x01;
  padded[padded.length - 1] ^= 0x80;
  const st = new BigUint64Array(25);
  const view = new DataView(padded.buffer);
  for (let off = 0; off < padded.length; off += RATE) {
    for (let i = 0; i < RATE / 8; i++) st[i] ^= view.getBigUint64(off + i * 8, true);
    permute(st);
  }
  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  for (let i = 0; i < 4; i++) ov.setBigUint64(i * 8, st[i], true);
  return out;
}

export const toHex = (bytes) => "0x" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
