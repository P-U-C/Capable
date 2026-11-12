// S1: CapableStamps behaviour on a local anvil. Soulbound (transfers and approvals
// revert, ERC-5192 locked), free mint one per (holder, trait), closed and unknown
// traits revert, holder-only burn, owner-only registry, Ownable2Step, events.
import test from "node:test";
import assert from "node:assert/strict";
import { encodePacked, keccak256, numberToHex, pad, toFunctionSelector } from "viem";
import { badgeMetadata, badgeSvg } from "../../contract/badge-art.mjs";
import { expectedTraits } from "../scripts/lib/deploy.mjs";
import { ALICE, BOB, CAROL, MALLORY, OWNER, ZERO, abi, decodeTokenURI, deployStamps, localChain, slotOf } from "./helpers.mjs";

let c;
test.before(async () => {
  c = await localChain();
});
test.after(() => c?.stop());

const seedFor = (holder, stampId, tokenId) => keccak256(encodePacked(["address", "uint8", "uint256"], [holder, stampId, BigInt(tokenId)]));
const names = (events) => events.map((e) => e.eventName);

test("constructor: ERC-721 name/symbol, owner = deployer, the four founding traits open and equal to content/app.meta.json", async () => {
  const s = await deployStamps(c);
  assert.equal(await s.read("name"), "capable stamps");
  assert.equal(await s.read("symbol"), "STAMP");
  assert.equal(await s.read("owner"), OWNER);
  assert.equal(await s.read("pendingOwner"), ZERO);
  assert.equal(await s.read("traitCount"), 4n);
  assert.deepEqual(
    [await s.read("traitOf", [0]), await s.read("traitOf", [1]), await s.read("traitOf", [2]), await s.read("traitOf", [3])],
    [
      ["SOVEREIGN", "#18C8F0", 0, true],
      ["CIVIL", "#FF1FC8", 1, true],
      ["MOBILE", "#5CF27E", 2, true],
      ["ENDURING", "#FFE11A", 3, true],
    ],
  );
  // and those are exactly the app's traits (stampId, capitalised name, colour, emblem)
  for (const t of expectedTraits()) assert.deepEqual(await s.read("traitOf", [t.stampId]), [t.name, t.color, t.emblem, true]);
  assert.deepEqual(await s.revert(ALICE, "traitOf", [4]), { name: "UnknownTrait", args: [4] });
  const { parseEventLogs } = await import("viem");
  const ev = parseEventLogs({ abi, logs: s.receipt.logs });
  assert.deepEqual(names(ev), ["OwnershipTransferred", ...Array(4).fill(["TraitAdded", "TraitOpenSet"]).flat()]);
  assert.deepEqual(ev[1].args, { stampId: 0, name: "SOVEREIGN", color: "#18C8F0", emblem: 0 });
  assert.deepEqual(ev[2].args, { stampId: 0, open: true });
  assert.equal(await s.read("MAX_TOKEN_ID"), 999_999_999n);
});

test("ERC-165: ERC-5192 (0xb45a3c0e), ERC-721, metadata and ERC-165 are supported; nothing else", async () => {
  const s = await deployStamps(c);
  assert.equal(toFunctionSelector("function locked(uint256)"), "0xb45a3c0e");
  for (const id of ["0xb45a3c0e", "0x80ac58cd", "0x5b5e139f", "0x01ffc9a7"]) assert.equal(await s.read("supportsInterface", [id]), true, id);
  for (const id of ["0xffffffff", "0x780e9d63" /* enumerable */, "0x00000000"]) assert.equal(await s.read("supportsInterface", [id]), false, id);
});

test("mint: free, sequential ids from 1, seed = keccak256(holder, stampId, tokenId), events Transfer → Locked → Stamped", async () => {
  const s = await deployStamps(c);
  const r1 = await s.write(ALICE, "mint", [0]);
  assert.deepEqual(names(r1.events), ["Transfer", "Locked", "Stamped"]);
  assert.deepEqual(r1.events[0].args, { from: ZERO, to: ALICE, tokenId: 1n });
  assert.deepEqual(r1.events[1].args, { tokenId: 1n });
  assert.deepEqual(r1.events[2].args, { holder: ALICE, stampId: 0, tokenId: 1n });
  const r2 = await s.write(BOB, "mint", [0]);
  assert.deepEqual(r2.events[2].args, { holder: BOB, stampId: 0, tokenId: 2n });
  await s.write(ALICE, "mint", [3]);

  assert.equal(await s.read("ownerOf", [1n]), ALICE);
  assert.equal(await s.read("ownerOf", [2n]), BOB);
  assert.equal(await s.read("ownerOf", [3n]), ALICE);
  assert.equal(await s.read("balanceOf", [ALICE]), 2n);
  assert.deepEqual(await s.read("tokensOf", [ALICE]), [1n, 3n]);
  assert.deepEqual(await s.read("tokensOf", [CAROL]), []);
  assert.equal(await s.read("stampOf", [3n]), 3);
  assert.equal(await s.read("seedOf", [1n]), seedFor(ALICE, 0, 1));
  assert.equal(await s.read("seedOf", [2n]), seedFor(BOB, 0, 2));
  assert.equal(await s.read("seedOf", [3n]), seedFor(ALICE, 3, 3));
  assert.equal(await s.read("hasStamp", [ALICE, 0]), true);
  assert.equal(await s.read("hasStamp", [ALICE, 1]), false);
  assert.equal(await s.read("locked", [1n]), true);
  assert.deepEqual(await s.revert(ALICE, "locked", [99n]), { name: "ERC721NonexistentToken", args: [99n] });
  assert.deepEqual(await s.revert(ALICE, "stampOf", [99n]), { name: "ERC721NonexistentToken", args: [99n] });

  // free: sending ETH with mint is refused (non-payable)
  await assert.rejects(c.pub.call({ account: CAROL, to: s.address, data: (await import("viem")).encodeFunctionData({ abi, functionName: "mint", args: [1] }), value: 1n }));
});

test("one per (holder, trait): a second mint reverts AlreadyHeld; other traits and other holders are fine", async () => {
  const s = await deployStamps(c);
  await s.write(ALICE, "mint", [1]);
  assert.deepEqual(await s.revert(ALICE, "mint", [1]), { name: "AlreadyHeld", args: [1] });
  assert.equal(await s.mined(ALICE, "mint", [1]), "reverted");
  await s.write(ALICE, "mint", [2]);
  await s.write(BOB, "mint", [1]);
  assert.equal(await s.read("balanceOf", [ALICE]), 2n);
});

test("unknown traits revert UnknownTrait; closed traits revert TraitClosed until reopened", async () => {
  const s = await deployStamps(c);
  assert.deepEqual(await s.revert(ALICE, "mint", [4]), { name: "UnknownTrait", args: [4] });
  assert.deepEqual(await s.revert(ALICE, "mint", [255]), { name: "UnknownTrait", args: [255] });
  const r = await s.write(OWNER, "setOpen", [2, false]);
  assert.deepEqual(r.events.map((e) => [e.eventName, e.args]), [["TraitOpenSet", { stampId: 2, open: false }]]);
  assert.deepEqual(await s.read("traitOf", [2]), ["MOBILE", "#5CF27E", 2, false]);
  assert.deepEqual(await s.revert(ALICE, "mint", [2]), { name: "TraitClosed", args: [2] });
  assert.equal(await s.mined(ALICE, "mint", [2]), "reverted");
  await s.write(OWNER, "setOpen", [2, true]);
  await s.write(ALICE, "mint", [2]);
  // closing a trait never touches stamps already minted
  await s.write(OWNER, "setOpen", [2, false]);
  assert.equal(await s.read("ownerOf", [1n]), ALICE);
  assert.match(await s.read("tokenURI", [1n]), /^data:application\/json;base64,/);
});

test("soulbound: transferFrom, both safeTransferFrom, approve and setApprovalForAll revert Soulbound for everyone", async () => {
  const s = await deployStamps(c);
  await s.write(ALICE, "mint", [0]);
  for (const who of [ALICE, OWNER, MALLORY]) {
    assert.deepEqual(await s.revert(who, "transferFrom", [ALICE, BOB, 1n]), { name: "Soulbound", args: [] });
    assert.deepEqual(await s.revert(who, "safeTransferFrom", [ALICE, BOB, 1n]), { name: "Soulbound", args: [] });
    assert.deepEqual(await s.revert(who, "safeTransferFrom", [ALICE, BOB, 1n, "0x1234"]), { name: "Soulbound", args: [] });
    assert.deepEqual(await s.revert(who, "approve", [BOB, 1n]), { name: "Soulbound", args: [] });
    assert.deepEqual(await s.revert(who, "setApprovalForAll", [BOB, true]), { name: "Soulbound", args: [] });
  }
  // also as mined transactions, not just calls
  assert.equal(await s.mined(ALICE, "transferFrom", [ALICE, BOB, 1n]), "reverted");
  assert.equal(await s.mined(ALICE, "safeTransferFrom", [ALICE, BOB, 1n]), "reverted");
  assert.equal(await s.mined(ALICE, "approve", [BOB, 1n]), "reverted");
  assert.equal(await s.mined(ALICE, "setApprovalForAll", [BOB, true]), "reverted");
  // transfer to self, to zero, of a token that does not exist: still Soulbound
  assert.deepEqual(await s.revert(ALICE, "transferFrom", [ALICE, ALICE, 1n]), { name: "Soulbound", args: [] });
  assert.deepEqual(await s.revert(ALICE, "transferFrom", [ALICE, ZERO, 1n]), { name: "Soulbound", args: [] });
  assert.deepEqual(await s.revert(ALICE, "transferFrom", [ALICE, BOB, 77n]), { name: "Soulbound", args: [] });
  assert.equal(await s.read("ownerOf", [1n]), ALICE);
  assert.equal(await s.read("getApproved", [1n]), ZERO);
  assert.equal(await s.read("isApprovedForAll", [ALICE, BOB]), false);
});

test("burn: only the holder (not the contract owner, not anyone else); clears the one-per slot; re-mint gets a new id and seed", async () => {
  const s = await deployStamps(c);
  await s.write(ALICE, "mint", [0]); // 1
  await s.write(ALICE, "mint", [1]); // 2
  await s.write(ALICE, "mint", [2]); // 3
  await s.write(BOB, "mint", [0]); // 4
  for (const who of [OWNER, BOB, MALLORY]) assert.deepEqual(await s.revert(who, "burn", [2n]), { name: "NotHolder", args: [2n] });
  assert.deepEqual(await s.revert(ALICE, "burn", [4n]), { name: "NotHolder", args: [4n] });
  assert.deepEqual(await s.revert(ALICE, "burn", [99n]), { name: "NotHolder", args: [99n] });

  const r = await s.write(ALICE, "burn", [1n]); // the first of three: the last moves into its place
  assert.deepEqual(r.events.map((e) => [e.eventName, e.args]), [["Transfer", { from: ALICE, to: ZERO, tokenId: 1n }]]);
  assert.deepEqual(await s.read("tokensOf", [ALICE]), [3n, 2n]);
  assert.equal(await s.read("balanceOf", [ALICE]), 2n);
  assert.equal(await s.read("hasStamp", [ALICE, 0]), false);
  for (const fn of ["ownerOf", "locked", "stampOf", "seedOf", "tokenURI"]) assert.deepEqual(await s.revert(ALICE, fn, [1n]), { name: "ERC721NonexistentToken", args: [1n] }, fn);
  assert.deepEqual(await s.revert(ALICE, "burn", [1n]), { name: "NotHolder", args: [1n] }); // no double burn

  const again = await s.write(ALICE, "mint", [0]);
  assert.deepEqual(again.events[2].args, { holder: ALICE, stampId: 0, tokenId: 5n });
  assert.equal(await s.read("seedOf", [5n]), seedFor(ALICE, 0, 5));
  assert.notEqual(seedFor(ALICE, 0, 5), seedFor(ALICE, 0, 1));
  assert.deepEqual(await s.read("tokensOf", [ALICE]), [3n, 2n, 5n]);

  // burning the last entry and then every entry keeps the list consistent
  await s.write(ALICE, "burn", [5n]);
  assert.deepEqual(await s.read("tokensOf", [ALICE]), [3n, 2n]);
  await s.write(ALICE, "burn", [3n]);
  await s.write(ALICE, "burn", [2n]);
  assert.deepEqual(await s.read("tokensOf", [ALICE]), []);
  assert.equal(await s.read("balanceOf", [ALICE]), 0n);
  assert.deepEqual(await s.read("tokensOf", [BOB]), [4n]);
});

test("registry: addTrait and setOpen are owner-only; new traits start closed; names and colours are validated like badge-art.mjs", async () => {
  const s = await deployStamps(c);
  for (const who of [ALICE, MALLORY]) {
    assert.deepEqual(await s.revert(who, "addTrait", ["NEW", "#123456", 7]), { name: "OwnableUnauthorizedAccount", args: [who] });
    assert.deepEqual(await s.revert(who, "setOpen", [0, false]), { name: "OwnableUnauthorizedAccount", args: [who] });
  }
  const r = await s.write(OWNER, "addTrait", ["NEW IDEA", "#A0A0FF", 9]);
  assert.deepEqual(r.events.map((e) => [e.eventName, e.args]), [["TraitAdded", { stampId: 4, name: "NEW IDEA", color: "#A0A0FF", emblem: 9 }]]);
  assert.equal(await s.read("traitCount"), 5n);
  assert.deepEqual(await s.read("traitOf", [4]), ["NEW IDEA", "#A0A0FF", 9, false]);
  assert.deepEqual(await s.revert(ALICE, "mint", [4]), { name: "TraitClosed", args: [4] });
  await s.write(OWNER, "setOpen", [4, true]);
  await s.write(ALICE, "mint", [4]);
  assert.deepEqual(await s.revert(OWNER, "setOpen", [5, true]), { name: "UnknownTrait", args: [5] });

  // the same rules as badge-art.mjs: /^[A-Z][A-Z ]{0,11}$/ and /^#[0-9A-F]{6}$/
  for (const name of ["", "sovereign", "Sovereign", " A", "1ABC", "ABCDEFGHIJKLM", "A-B", "AÉ", "É", "A\tB", "A<B"]) {
    assert.deepEqual(await s.revert(OWNER, "addTrait", [name, "#123456", 0]), { name: "InvalidName", args: [] }, JSON.stringify(name));
  }
  for (const color of ["", "#18c8f0", "18C8F0", "#18C8F", "#18C8F00", "#GGGGGG", "#18C8F0 ", " #18C8F0", "#18C8FG"]) {
    assert.deepEqual(await s.revert(OWNER, "addTrait", ["OK", color, 0]), { name: "InvalidColor", args: [] }, JSON.stringify(color));
  }
  for (const name of ["A", "Z Z", "ABCDEFGHIJKL", "AB ", "A          B"]) await s.write(OWNER, "addTrait", [name, "#0F0F0F", 255]);
  assert.equal(await s.read("traitCount"), 10n);
});

test("registry: at most 256 traits (stampIds 0..255)", async () => {
  const s = await deployStamps(c);
  await c.test.setAutomine(false);
  try {
    const hashes = [];
    for (let i = 4; i < 256; i++) hashes.push(await c.wallet.writeContract({ address: s.address, abi, functionName: "addTrait", args: ["T", "#000000", i % 256], account: OWNER, gas: 300_000n }));
    await c.test.mine({ blocks: 1 });
    for (const h of hashes) assert.equal((await c.pub.waitForTransactionReceipt({ hash: h })).status, "success");
  } finally {
    await c.test.setAutomine(true);
  }
  assert.equal(await s.read("traitCount"), 256n);
  assert.deepEqual(await s.read("traitOf", [255]), ["T", "#000000", 255, false]);
  assert.deepEqual(await s.revert(OWNER, "addTrait", ["ONE MORE", "#000000", 0]), { name: "TooManyTraits", args: [] });
});

test("Ownable2Step: ownership moves only when the new owner accepts; the registry follows; nobody else can accept", async () => {
  const s = await deployStamps(c);
  assert.deepEqual(await s.revert(ALICE, "transferOwnership", [ALICE]), { name: "OwnableUnauthorizedAccount", args: [ALICE] });
  await s.write(OWNER, "transferOwnership", [BOB]);
  assert.equal(await s.read("owner"), OWNER);
  assert.equal(await s.read("pendingOwner"), BOB);
  assert.deepEqual(await s.revert(MALLORY, "acceptOwnership"), { name: "OwnableUnauthorizedAccount", args: [MALLORY] });
  await s.write(OWNER, "setOpen", [0, false]); // still the owner until accepted
  await s.write(BOB, "acceptOwnership");
  assert.equal(await s.read("owner"), BOB);
  assert.deepEqual(await s.revert(OWNER, "setOpen", [0, true]), { name: "OwnableUnauthorizedAccount", args: [OWNER] });
  await s.write(BOB, "setOpen", [0, true]);
});

test("the owner has no other powers: the full list of state-changing functions", () => {
  const sig = (x) => `${x.name}(${x.inputs.map((i) => i.type).join(",")})`;
  const fns = abi.filter((x) => x.type === "function");
  const writes = fns.filter((x) => !["view", "pure"].includes(x.stateMutability)).map(sig).sort();
  // OpenZeppelin's 3-argument safeTransferFrom is not virtual; it calls the 4-argument one, which reverts
  // Soulbound (proved above as a mined transaction). Nothing else changes state.
  assert.deepEqual(writes, ["acceptOwnership()", "addTrait(string,string,uint8)", "burn(uint256)", "mint(uint8)", "renounceOwnership()", "safeTransferFrom(address,address,uint256)", "setOpen(uint8,bool)", "transferOwnership(address)"]);
  // the overridden transfer/approval functions are pure: they cannot touch state, they only revert
  const pure = fns.filter((x) => x.stateMutability === "pure").map(sig).sort();
  assert.deepEqual(pure, ["approve(address,uint256)", "render(bytes32,string,string,uint8,uint256)", "safeTransferFrom(address,address,uint256,bytes)", "setApprovalForAll(address,bool)", "transferFrom(address,address,uint256)"]);
  assert.ok(!fns.some((x) => x.stateMutability === "payable"), "nothing payable");
  assert.ok(!abi.some((x) => x.type === "constructor" && x.inputs.length), "no constructor arguments");
});

test("tokenURI: base64 JSON equal to badgeMetadata() with the base64 badgeSvg() for the stored seed and trait", async () => {
  const s = await deployStamps(c);
  await s.write(OWNER, "addTrait", ["NEW IDEA", "#A0A0FF", 200]);
  await s.write(OWNER, "setOpen", [4, true]);
  await s.write(OWNER, "addTrait", ["ABCDEFGHIJKL", "#000000", 2]);
  await s.write(OWNER, "setOpen", [5, true]);
  const traits = [["SOVEREIGN", "#18C8F0", 0], ["CIVIL", "#FF1FC8", 1], ["MOBILE", "#5CF27E", 2], ["ENDURING", "#FFE11A", 3], ["NEW IDEA", "#A0A0FF", 200], ["ABCDEFGHIJKL", "#000000", 2]];
  const minters = [ALICE, BOB, CAROL, ALICE, BOB, CAROL];
  for (let i = 0; i < traits.length; i++) await s.write(minters[i], "mint", [i]);
  for (let i = 0; i < traits.length; i++) {
    const tokenId = i + 1;
    const [name, color, emblem] = traits[i];
    const json = decodeTokenURI(await s.read("tokenURI", [BigInt(tokenId)]));
    const svg = badgeSvg({ seed: seedFor(minters[i], i, tokenId), name, color, emblem, serial: tokenId });
    assert.equal(json, badgeMetadata({ name, serial: tokenId, svgBase64: Buffer.from(svg).toString("base64") }), name);
    const meta = JSON.parse(json);
    const title = name[0] + name.slice(1).toLowerCase();
    assert.equal(meta.name, `capable: ${title} #${tokenId}`);
    assert.deepEqual(meta.attributes, [{ trait_type: "Trait", value: title }]);
    assert.equal(Buffer.from(meta.image.replace(/^data:image\/svg\+xml;base64,/, ""), "base64").toString("utf8"), svg);
  }
  assert.deepEqual(await s.revert(ALICE, "tokenURI", [7n]), { name: "ERC721NonexistentToken", args: [7n] });
});

test("supply cap: token ids stop at 999,999,999 (the art prints serials < 10^9); that last stamp still renders exactly", async () => {
  const s = await deployStamps(c);
  await c.test.setStorageAt({ address: s.address, index: numberToHex(slotOf("_lastId"), { size: 32 }), value: pad(numberToHex(999_999_998n), { size: 32 }) });
  const r = await s.write(ALICE, "mint", [0]);
  assert.equal(r.events[2].args.tokenId, 999_999_999n);
  const json = decodeTokenURI(await s.read("tokenURI", [999_999_999n]));
  const svg = badgeSvg({ seed: seedFor(ALICE, 0, 999_999_999), name: "SOVEREIGN", color: "#18C8F0", emblem: 0, serial: 999_999_999 });
  assert.equal(json, badgeMetadata({ name: "SOVEREIGN", serial: 999_999_999, svgBase64: Buffer.from(svg).toString("base64") }));
  assert.deepEqual(await s.revert(BOB, "mint", [0]), { name: "SupplyExhausted", args: [] });
});

test("gas: mint, burn and tokenURI (reported, with sane ceilings)", async (t) => {
  const s = await deployStamps(c);
  const first = await s.write(ALICE, "mint", [0]);
  const second = await s.write(ALICE, "mint", [1]);
  const other = await s.write(BOB, "mint", [0]);
  const burn = await s.write(ALICE, "burn", [1n]);
  const { encodeFunctionData } = await import("viem");
  const uriGas = await c.pub.estimateGas({ to: s.address, data: encodeFunctionData({ abi, functionName: "tokenURI", args: [2n] }) });
  const deployGas = s.receipt.gasUsed;
  const report = { deploy: deployGas, mintFirst: first.gasUsed, mintSecond: second.gasUsed, mintOtherHolder: other.gasUsed, burn: burn.gasUsed, tokenURICall: uriGas };
  t.diagnostic(`gas ${JSON.stringify(Object.fromEntries(Object.entries(report).map(([k, v]) => [k, Number(v)])))}`);
  assert.ok(first.gasUsed < 250_000n, `mint ${first.gasUsed}`);
  assert.ok(uriGas < 2_000_000n, `tokenURI ${uriGas}`);
  assert.ok(deployGas < 5_000_000n, `deploy ${deployGas}`);
});
