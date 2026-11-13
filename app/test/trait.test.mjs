// P2 / U6 / review V1, V8, V9, V12: the trait card is the reward. It takes the
// trait colour, the stamp is pressed onto it (reduced-motion safe), and it says
// where the stamp went: saved to the passport, or (only with a deployed
// contract, a wallet, and a chain that says the trait is open and the account
// doesn't hold it) the mint flow: the network switch, the wallet's confirm,
// then the receipt: confirming → the real stamp (success), a clear failure with
// a re-check (reverted), "still confirming" (no receipt yet). Nothing is ever
// sent twice and nothing is recorded as minted without a success receipt.
// The stamps module is mocked to contract/citizen.d.ts (check/mint/receipt);
// identity and the wallet are mocked; driven through the fake DOM.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fakeWindow, memStorage, settle, FakeEvent, canon } from "./dom.mjs";
import { fixture, visibleText, tags, attr, APP_DIR } from "./helpers.mjs";
import { mountDeck } from "../src/view-deck.mjs";
import { renderCard, renderStampAct, PREVIEW_HOLDER } from "../src/cards.mjs";
import { deckModel } from "../src/model.mjs";
import { openStore, storageKey, emptyState } from "../src/store.mjs";
import { openCitizen, citizenKey, placeholderHolder, mintKey } from "../src/citizen.mjs";
import { watchProvider, mintErrorCode, RECEIPT_TIMING } from "../src/mint.mjs";
import { COPY } from "../src/copy.mjs";
import { stampMarkup, stampTraitOf, previewArt } from "../src/art.mjs";
import { preview, createStamps, TOPICS } from "../src/stamps/index.mjs";
import { STAMPS_ABI } from "../src/stamps/abi.mjs";
import { decodeFunctionData, encodeFunctionResult } from "viem";

const CONTRACT = "0x00000000000000000000000000000000ca9ab1e5";
const ACCOUNT = "0x5e5f0a6e2b4c1d3f9a8b7c6d5e4f3a2b1c0d9e8f";
const TX = `0x${"7c".repeat(32)}`;
const EXPLORER = `https://basescan.org/tx/${TX}`;
const CFG = { chainId: 8453, address: CONTRACT };

function appWith({ deployed = false, stampIds = true } = {}) {
  const a = fixture();
  const meta = { sovereign: ["#18C8F0", 0], civil: ["#FF1FC8", 1], mobile: ["#5CF27E", 2], enduring: ["#FFE11A", 3] };
  a.traits = a.traits.map((t) => ({ ...t, color: meta[t.id][0], emblem: meta[t.id][1], ...(stampIds ? { stampId: meta[t.id][1] } : {}) }));
  a.stamps = { chainId: 8453, address: deployed ? CONTRACT : null };
  return a;
}

function identityWith({ wallet = null, current = null } = {}) {
  const calls = { wallet: 0, share: [] };
  return {
    calls,
    current: () => current,
    wallet: async () => {
      calls.wallet++;
      return wallet;
    },
    share: (text, url) => {
      calls.share.push({ text, url });
      return Promise.resolve();
    },
  };
}

/**
 * A wallet (EIP-1193) on another chain that switches when asked. `send`
 * decides what eth_sendTransaction does; `accounts` is what eth_accounts says.
 */
function fakeWallet({ send = async () => TX, accounts = [], chain = "0x1", switchErr = null } = {}) {
  const calls = [];
  const sent = [];
  let cur = chain;
  return {
    calls,
    sent,
    async request({ method, params }) {
      calls.push(method);
      if (method === "eth_chainId") return cur;
      if (method === "eth_accounts") return accounts;
      if (method === "wallet_switchEthereumChain") {
        if (switchErr) throw switchErr;
        cur = params[0].chainId;
        return null;
      }
      if (method === "eth_requestAccounts") return [ACCOUNT];
      if (method === "eth_sendTransaction") {
        sent.push(params[0]);
        return send(params);
      }
      throw new Error(`unexpected ${method}`);
    },
  };
}

const stampsErr = (code) => Object.assign(new Error(code), { name: "StampsError", code });

/**
 * A StampsAPI to the planner's contract (contract/citizen.d.ts): the real
 * config() and preview(); check() scripted; mint() switches the chain, asks
 * for the account, re-checks for it (refusing "closed"/"held"), and sends once
 * with an explicit chainId; receipt() answers from a script (the last answer
 * repeats).
 */
function mockStamps({ check = async () => ({ open: true, held: false }), receipts = [{ status: "success", tokenId: 1234 }], owned = async () => ({ stamps: [] }) } = {}) {
  const real = createStamps({ fetch: async () => Promise.reject(new Error("tests never touch the network")) }); // config() only
  const calls = { check: [], mint: [], receipt: [], owned: [] };
  let r = 0;
  const ask = async (provider, method, params) => {
    try {
      return await provider.request(params ? { method, params } : { method });
    } catch (err) {
      if (err?.code === 4001) throw stampsErr("rejected");
      throw err;
    }
  };
  return {
    calls,
    config: real.config,
    preview,
    check: async (o) => {
      calls.check.push(o);
      return check(o);
    },
    owned: async (a, o) => {
      calls.owned.push(a);
      return owned(a, o);
    },
    async mint({ provider, stampId, app }) {
      calls.mint.push({ stampId, app });
      if (!real.config(app)) throw stampsErr("not-configured");
      if ((await ask(provider, "eth_chainId")) !== "0x2105") {
        try {
          await ask(provider, "wallet_switchEthereumChain", [{ chainId: "0x2105" }]);
        } catch (err) {
          if (err?.code === "rejected") throw err;
          throw stampsErr("wrong-chain");
        }
      }
      const [from] = await ask(provider, "eth_requestAccounts");
      const c = await check({ app, holder: from, stampId });
      if (c.error) throw stampsErr("offline");
      if (c.held) throw stampsErr("held");
      if (!c.open) throw stampsErr("closed");
      let txHash;
      try {
        txHash = await ask(provider, "eth_sendTransaction", [{ from, to: CONTRACT, data: "0x", chainId: "0x2105" }]);
      } catch (err) {
        if (err?.code === "rejected") throw err;
        throw stampsErr("wallet");
      }
      return { txHash, explorerUrl: `https://basescan.org/tx/${txHash}`, from };
    },
    receipt: async (o) => {
      calls.receipt.push(o);
      const x = receipts[Math.min(r++, receipts.length - 1)];
      return typeof x === "function" ? x() : x;
    },
  };
}

/** A clock that moves only when the card waits: each sleep advances it, so minutes of polling take microseconds. */
function fakeClock(start = 1_700_000_000_000) {
  const c = { t: start, sleeps: [] };
  c.timing = {
    now: () => c.t,
    sleep: async (ms) => {
      c.sleeps.push(ms);
      c.t += ms;
      await new Promise((r) => setTimeout(r, 0));
    },
  };
  return c;
}

/** The deck for a lesson, at its trait card, with these modules. */
function deckAtTrait({ lessonId = "own-your-exit", a = appWith(), identity = identityWith(), stamps = mockStamps(), storage = memStorage(), reduced = false, clock = fakeClock(), onLazyFail = () => {}, ethereum = false } = {}) {
  const win = fakeWindow({ storage, reducedMotion: reduced });
  if (ethereum) win.ethereum = {};
  const doc = win.document;
  const root = doc.createElement("div");
  doc.body.appendChild(root);
  const store = openStore(storage, { key: storageKey("/Capable/") });
  const citizen = openCitizen(storage, { key: citizenKey("/Capable/") });
  const view = mountDeck(root, { app: a, lessonId, store, reduced, identity, stamps, citizen, onLazyFail, stampTiming: clock.timing });
  const card = root.querySelector('.card[data-type="trait"]');
  const go = () => view.go(Number(card.dataset.i));
  const act = () => card.querySelector("[data-stamp-act]");
  const art = () => card.querySelector(".trait__press").innerHTML;
  return { win, doc, root, view, card, go, act, art, citizen, storage, identity, stamps, a, clock };
}

const click = (el) => el.dispatchEvent(new FakeEvent("click", { bubbles: true }));
const until = async (fn, n = 200) => {
  for (let i = 0; i < n && !fn(); i++) await settle();
};
const sov = (a) => stampTraitOf(a, a.traits[0]);
const realArt = (a, holder, tokenId) => canon(stampMarkup(preview({ holder, stampId: 0, tokenId, trait: sov(a) })));
const previewOf = (a, holder) => canon(stampMarkup(previewArt(preview, a, a.traits[0], holder)));

// ---- markup ---------------------------------------------------------------------------

test("the trait card: the trait-colour fill look, the pressed stamp in the trait's colour as a preview with no serial, the name at full Shout, the count as plain Pixel text", () => {
  const app = appWith();
  const { cards, ctx } = deckModel(app, "own-your-exit", emptyState());
  const i = cards.findIndex((c) => c.type === "trait");
  const m = String(renderCard(cards[i], i, { ...ctx, holder: ACCOUNT }));
  const section = tags(m, "section")[0];
  assert.equal(attr(section, "data-look"), "fill", "the full trait-colour look (U6)");
  const stamp = m.match(/<div class="trait__stamp"[^>]*>/)[0];
  assert.equal(attr(stamp, "role"), "img");
  assert.equal(attr(stamp, "aria-label"), COPY.stampA11y("Sovereign"));
  assert.equal(attr(m.match(/<div class="trait__press"[^>]*>/)[0], "aria-hidden"), "true", "the art's own text is not read out (review T14)");
  assert.ok(m.includes(String(stampMarkup(previewArt(preview, app, app.traits[0], ACCOUNT)))), "the stamp module's art for the holder");
  assert.doesNotMatch(m, />#0</, "a preview prints no serial: #— (review V12, T14)");
  assert.match(m, />#—</);
  assert.match(m, /fill="#18C8F0"/, "in the trait's colour");
  assert.match(m, /<h2 class="shout trait__name"[^>]*>[\s\S]*Sovereign/);
  assert.match(m, /<p class="pixel trait__count">/);
  assert.match(visibleText(m), new RegExp(COPY.stampSaved));
  const saved = tags(m, "a").find((t) => /trait__saved/.test(attr(t, "class")));
  assert.equal(attr(saved, "href"), "#/passport", "saved to your passport: a way to see it");
  // minted: the exact on-chain art, serial included
  const minted = String(renderCard(cards[i], i, { ...ctx, holder: ACCOUNT, minted: { holder: ACCOUNT, tokenId: 1234 } }));
  assert.ok(minted.includes(String(stampMarkup(preview({ holder: ACCOUNT, stampId: 0, tokenId: 1234, trait: sov(app) })))));
  assert.match(minted, />#1234</);
  // no holder known: the fixed stand-in; a trait whose name the stamp cannot print: no art, no crash
  const anon = String(renderCard(cards[i], i, ctx));
  assert.ok(anon.includes(String(stampMarkup(previewArt(preview, app, app.traits[0], PREVIEW_HOLDER)))));
  const odd = { ...ctx, trait: { ...ctx.trait, name: "Kind-hearted 2" } };
  assert.doesNotMatch(String(renderCard(cards[i], i, odd)), /stamp__svg/);
});

test("the stamp is pressed in with a scale+rotate thud, and only fades in under reduced motion", () => {
  const css = readFileSync(join(APP_DIR, "src/app.css"), "utf8");
  assert.match(css, /\.card\.is-earned \.trait__press \{\s*animation: thud /);
  const thud = css.match(/@keyframes thud \{([\s\S]*?)\n\}/)[1];
  assert.match(thud, /scale\(1\.8\) rotate\(-22deg\)/);
  assert.match(thud, /100% \{\s*transform: scale\(1\) rotate\(-4deg\)/);
  const reduced = css.slice(css.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
  assert.match(reduced, /\.card\.is-earned \.trait__press \{\s*animation: fade-in /, "reduced motion: a fade, no movement");
});

test("a draft's trait card keeps nothing and offers nothing", async () => {
  const identity = identityWith({ wallet: fakeWallet() });
  const d = deckAtTrait({ lessonId: "new-topic", a: appWith({ deployed: true }), identity });
  d.go();
  await settle();
  assert.equal(visibleText(d.act().innerHTML), COPY.stampDraft);
  assert.equal(identity.calls.wallet, 0);
});

test("renderStampAct: every state's copy; Try again only where nothing was sent; after a failed or lost tx only a re-check", () => {
  const mint = String(renderStampAct({ phase: "mint" }));
  assert.match(visibleText(mint), new RegExp(COPY.mintStamp));
  assert.ok(visibleText(mint).includes(COPY.mintPreview), "the preview is labelled honestly (review V12)");
  for (const step of ["check", "network", "account", "confirm"]) {
    const m = String(renderStampAct({ phase: "busy", step }));
    assert.match(m, /disabled/);
    assert.ok(visibleText(m).includes(COPY.mintPhase[step]), step);
  }
  const link = (m) => tags(m, "a").find((t) => /trait__link/.test(attr(t, "class")));
  for (const phase of ["confirming", "slow", "minted", "reverted", "dropped"]) {
    const m = String(renderStampAct({ phase, explorerUrl: EXPLORER }));
    assert.equal(attr(link(m), "href"), EXPLORER, `${phase}: the tx link`);
    assert.equal(attr(link(m), "rel"), "noopener noreferrer");
    assert.doesNotMatch(m, /data-mint/, `${phase}: never a send button`);
    assert.doesNotMatch(String(renderStampAct({ phase, explorerUrl: "javascript:alert(1)" })), /<a /, "only an https link");
  }
  assert.ok(visibleText(String(renderStampAct({ phase: "confirming", explorerUrl: EXPLORER }))).includes(COPY.mintConfirming));
  assert.ok(visibleText(String(renderStampAct({ phase: "slow", explorerUrl: EXPLORER }))).includes(COPY.mintSlow));
  for (const phase of ["reverted", "dropped"]) {
    const m = String(renderStampAct({ phase, explorerUrl: EXPLORER }));
    assert.match(m, /data-recheck/, `${phase}: a fresh attempt starts with a re-check`);
    assert.match(m, /role="alert"/);
  }
  const minted = String(renderStampAct({ phase: "minted", explorerUrl: EXPLORER, share: ACCOUNT }));
  assert.ok(visibleText(minted).includes(COPY.mintDone));
  assert.match(minted, /data-share-mine/);
  assert.ok(visibleText(minted).includes(COPY.shareMineNote("0x5e5f…9e8f")), "the address is shown before it is shared (review V9)");
  assert.doesNotMatch(String(renderStampAct({ phase: "minted", explorerUrl: EXPLORER })), /data-share-mine/);
  assert.equal(visibleText(String(renderStampAct({ phase: "held" }))), COPY.mintHeld);
  const closed = String(renderStampAct({ phase: "closed" }));
  assert.ok(visibleText(closed).includes(COPY.stampSaved) && visibleText(closed).includes(COPY.mintClosed));
  assert.doesNotMatch(closed, /data-mint/);
  for (const code of ["rejected", "wrong-chain", "offline", "no-account"]) assert.match(String(renderStampAct({ phase: "error", code })), /data-mint/, code);
  for (const code of ["failed", "wallet", "not-configured", "anything"]) assert.doesNotMatch(String(renderStampAct({ phase: "error", code })), /data-mint/, code);
  assert.match(String(renderStampAct({ phase: "error", code: "unsent" })), /data-mint/);
  assert.ok(visibleText(String(renderStampAct({ phase: "error", code: "unsent" }))).includes(COPY.mintError.unsent));
  // only "wallet" can follow a send; held/closed are refusals; everything else sent nothing
  assert.equal(mintErrorCode("wallet"), "failed", "the wallet may have sent it: never offer a resend");
  assert.equal(mintErrorCode(undefined), "failed", "an error we can't place: careful");
  assert.equal(mintErrorCode("held"), "held");
  assert.equal(mintErrorCode("closed"), "closed");
  for (const c of ["rejected", "wrong-chain", "offline", "no-account"]) assert.equal(mintErrorCode(c), c);
  for (const c of ["bad-stamp", "not-configured", "no-wallet"]) assert.equal(mintErrorCode(c), "unsent", c);
});

// ---- before a mint: the chain decides what the card offers (review V1) ----------------

test("no contract configured: saved to your passport, and the wallet code is never loaded", async () => {
  const identity = identityWith({ wallet: fakeWallet() });
  const d = deckAtTrait({ identity });
  d.go();
  await settle();
  assert.equal(d.card.classList.contains("is-earned"), true, "pressed");
  assert.equal(visibleText(d.act().innerHTML), COPY.stampSaved);
  assert.equal(identity.calls.wallet, 0);
  assert.equal(d.stamps.calls.check.length, 0);
});

test("a contract but no stamp id for the trait: nothing to mint", async () => {
  const identity = identityWith({ wallet: fakeWallet() });
  const d = deckAtTrait({ identity, a: appWith({ deployed: true, stampIds: false }) });
  d.go();
  await settle();
  assert.equal(identity.calls.wallet, 0);
  assert.equal(visibleText(d.act().innerHTML), COPY.stampSaved);
});

test("a contract but no wallet: the wallet is looked for once, when the card shows, and the card still says saved", async () => {
  const identity = identityWith({ wallet: null });
  const d = deckAtTrait({ identity, a: appWith({ deployed: true }) });
  await settle();
  assert.equal(identity.calls.wallet, 0, "not before the card is reached");
  d.go();
  await settle();
  assert.equal(identity.calls.wallet, 1);
  assert.equal(visibleText(d.act().innerHTML), COPY.stampSaved);
  d.view.go(0);
  d.go();
  await settle();
  assert.equal(identity.calls.wallet, 1, "once");
  assert.equal(d.stamps.calls.check.length, 0, "no wallet: the chain isn't asked");
});

test("trait card states from check(): open and not held → the mint button; held → already in your wallet; closed → paused; RPC error → nothing about minting", async () => {
  const cases = [
    { name: "open", check: async () => ({ open: true, held: false }), accounts: [ACCOUNT], phase: "mint" },
    { name: "open, no account shared", check: async () => ({ open: true, held: false }), accounts: [], phase: "mint" },
    { name: "held", check: async () => ({ open: true, held: true }), accounts: [ACCOUNT], phase: "held" },
    { name: "closed", check: async () => ({ open: false, held: false }), accounts: [ACCOUNT], phase: "closed" },
    { name: "rpc error", check: async () => ({ open: false, held: false, error: "the network answered HTTP 503" }), accounts: [ACCOUNT], phase: "saved" },
    { name: "check throws", check: async () => Promise.reject(new Error("boom")), accounts: [ACCOUNT], phase: "saved" },
  ];
  for (const c of cases) {
    const stamps = mockStamps({ check: c.check });
    const lazy = [];
    const d = deckAtTrait({ identity: identityWith({ wallet: fakeWallet({ accounts: c.accounts }) }), a: appWith({ deployed: true }), stamps, onLazyFail: (e) => lazy.push(e) });
    d.go();
    await until(() => d.view.stamp.state.phase !== "saved" || stamps.calls.check.length > 0);
    await settle();
    assert.equal(d.view.stamp.state.phase, c.phase, c.name);
    assert.equal(stamps.calls.check.length, 1, `${c.name}: one read`);
    assert.equal(stamps.calls.check[0].stampId, 0);
    assert.equal(stamps.calls.check[0].holder, c.accounts[0] ?? PREVIEW_HOLDER, `${c.name}: the shared account, else a stand-in that holds nothing`);
    const text = visibleText(d.act().innerHTML);
    if (c.phase === "mint") assert.ok(d.act().querySelector("[data-mint]"), c.name);
    else assert.equal(d.act().querySelector("[data-mint]"), null, `${c.name}: no mint offered`);
    if (c.phase === "held") assert.equal(text, COPY.mintHeld);
    if (c.phase === "closed") assert.ok(text.includes(COPY.stampSaved) && text.includes(COPY.mintClosed), text);
    if (c.phase === "saved") {
      assert.equal(text, COPY.stampSaved, `${c.name}: just saved, nothing mint-related`);
      assert.equal(lazy.length, 1, "a failed read is reported, in case the app was updated (review V7)");
    }
    assert.equal(d.citizen.get().wallet, c.accounts[0] ?? null);
  }
});

test("mint() refusing before anything is sent: closed or held for the account the wallet picked", async () => {
  for (const [held, open, phase] of [
    [true, true, "held"],
    [false, false, "closed"],
  ]) {
    let n = 0;
    // open and not held for the stand-in at card time; the wallet then picks an account the chain says no to
    const stamps = mockStamps({ check: async () => (n++ === 0 ? { open: true, held: false } : { open, held }) });
    const wallet = fakeWallet();
    const d = deckAtTrait({ identity: identityWith({ wallet }), a: appWith({ deployed: true }), stamps });
    d.go();
    await until(() => d.view.stamp.state.phase === "mint");
    click(d.act().querySelector("[data-mint]"));
    await until(() => d.view.stamp.state.phase !== "busy");
    assert.equal(d.view.stamp.state.phase, phase);
    assert.equal(wallet.sent.length, 0, "nothing sent");
    assert.equal(d.act().querySelector("[data-mint]"), null);
  }
});

// ---- after a send: the receipt decides (review V1) -------------------------------------

test("success: Mint → switching → confirm → confirming… → the real stamp (its token id and holder), recorded; share my public passport shows the address first", async () => {
  let release;
  const wallet = fakeWallet({ send: () => new Promise((r) => (release = () => r(TX))) });
  const identity = identityWith({ wallet });
  const storage = memStorage();
  let land;
  const landed = new Promise((r) => (land = r));
  const stamps = mockStamps({ receipts: [() => landed.then(() => ({ status: "pending" })), { status: "pending", error: "HTTP 429" }, { status: "success", tokenId: 1234 }] });
  const clock = fakeClock();
  const a = appWith({ deployed: true });
  const d = deckAtTrait({ identity, a, storage, stamps, clock });
  d.go();
  await until(() => d.view.stamp.state.phase === "mint");
  const btn = d.act().querySelector("[data-mint]");
  assert.equal(btn.textContent, COPY.mintStamp);
  click(btn);
  assert.equal(d.view.stamp.state.phase, "busy");
  assert.equal(d.view.stamp.state.step, "network");
  assert.ok(d.act().querySelector("button[disabled]"), "the button is disabled while the wallet works");
  await until(() => release);
  assert.equal(d.view.stamp.state.step, "confirm");
  assert.ok(visibleText(d.act().innerHTML).includes(COPY.mintPhase.confirm));
  assert.ok(d.art().includes(previewOf(a, ACCOUNT)), "the preview follows the account that will mint (review V12)");
  click(d.act().querySelector("button") ?? d.act());
  release();
  await until(() => d.view.stamp.state.phase === "confirming");
  assert.ok(visibleText(d.act().innerHTML).includes(COPY.mintConfirming));
  assert.equal(d.act().querySelector("a.trait__link").getAttribute("href"), EXPLORER);
  const pending = d.citizen.mintFor(CFG, 0);
  assert.equal(pending.status, "pending", "sent is not minted");
  assert.equal(pending.from, ACCOUNT);
  land();
  await until(() => d.view.stamp.state.phase === "minted");
  assert.equal(stamps.calls.receipt.length, 3, "polled until the receipt said success; a pending with an error is just a failed read");
  assert.deepEqual(clock.sleeps, [2000, 2000, 3000], "the first look ~2 s after the send, then backoff");
  assert.ok(stamps.calls.receipt.every((o) => o.holder === ACCOUNT && o.txHash === TX), "the receipt is read for mint()'s `from` (smart wallets)");
  assert.ok(visibleText(d.act().innerHTML).includes(COPY.mintDone));
  assert.ok(d.art().includes(realArt(a, ACCOUNT, 1234)), "the true art: holder and token id from the chain (review V12)");
  assert.match(d.art(), />#1234</);
  const rec = d.citizen.mintFor(CFG, 0);
  assert.deepEqual({ status: rec.status, tokenId: rec.tokenId, txHash: rec.txHash, from: rec.from }, { status: "minted", tokenId: 1234, txHash: TX, from: ACCOUNT });
  assert.equal(wallet.sent.length, 1, "one transaction");
  assert.equal(wallet.sent[0].chainId, "0x2105", "with an explicit chainId (review V11)");
  // share my public passport: the address is on screen, and only this tap shares it
  assert.ok(visibleText(d.act().innerHTML).includes(COPY.shareMineNote("0x5e5f…9e8f")));
  click(d.act().querySelector("[data-share-mine]"));
  assert.deepEqual(identity.calls.share, [{ text: COPY.shareStamp("Sovereign", a.name), url: `https://app.example/Capable/#/p/${ACCOUNT}` }]);
  // next time: the real stamp at once, no wallet lookup, no button
  d.view.destroy();
  const identity2 = identityWith({ wallet: fakeWallet() });
  const again = deckAtTrait({ identity: identity2, a, storage, stamps: mockStamps() });
  assert.ok(again.art().includes(realArt(a, ACCOUNT, 1234)), "the first paint already draws the minted stamp");
  again.go();
  await settle();
  assert.equal(again.view.stamp.state.phase, "minted");
  assert.equal(again.act().querySelector("[data-mint]"), null);
  assert.equal(identity2.calls.wallet, 0);
  assert.equal(again.stamps.calls.receipt.length, 0, "a minted record needs no more reads");
});

test("success without a readable token id: the chain's own list for the holder supplies it", async () => {
  const stamps = mockStamps({ receipts: [{ status: "success" }], owned: async () => ({ stamps: [{ tokenId: 77, stampId: 0 }] }) });
  const a = appWith({ deployed: true });
  const d = deckAtTrait({ identity: identityWith({ wallet: fakeWallet() }), a, stamps });
  d.go();
  await until(() => d.view.stamp.state.phase === "mint");
  click(d.act().querySelector("[data-mint]"));
  await until(() => d.view.stamp.state.phase === "minted");
  assert.deepEqual(stamps.calls.owned, [ACCOUNT]);
  assert.equal(d.citizen.mintFor(CFG, 0).tokenId, 77);
  assert.ok(d.art().includes(realArt(a, ACCOUNT, 77)));
});

test("reverted: a clear failure with the tx link, nothing recorded, and a fresh attempt only after a re-check", async () => {
  const wallet = fakeWallet();
  let checks = 0;
  const stamps = mockStamps({ receipts: [{ status: "pending" }, { status: "reverted" }], check: async () => (checks++, { open: true, held: false }) });
  const d = deckAtTrait({ identity: identityWith({ wallet }), a: appWith({ deployed: true }), stamps });
  d.go();
  await until(() => d.view.stamp.state.phase === "mint");
  click(d.act().querySelector("[data-mint]"));
  await until(() => d.view.stamp.state.phase === "reverted");
  const text = visibleText(d.act().innerHTML);
  assert.ok(text.includes(COPY.mintReverted), text);
  assert.equal(d.act().querySelector("a.trait__link").getAttribute("href"), EXPLORER);
  assert.equal(d.act().querySelector("[data-mint]"), null, "no resend button");
  assert.equal(d.citizen.mintFor(CFG, 0), null, "a reverted tx is forgotten: never recorded as minted");
  assert.equal(wallet.sent.length, 1);
  const before = checks;
  click(d.act().querySelector("[data-recheck]"));
  await until(() => d.view.stamp.state.phase === "mint");
  assert.equal(checks, before + 1, "Check again asks the chain first");
  assert.equal(stamps.calls.check.at(-1).holder, ACCOUNT, "for the account that sent it");
  assert.equal(wallet.sent.length, 1, "and sends nothing by itself");
  // the re-check can also say it's held now (another device) or closed
  const s2 = mockStamps({ receipts: [{ status: "reverted" }] });
  let n = 0;
  s2.check = async (o) => (s2.calls.check.push(o), n++ === 0 ? { open: true, held: false } : { open: true, held: true });
  const d2 = deckAtTrait({ identity: identityWith({ wallet: fakeWallet() }), a: appWith({ deployed: true }), stamps: s2 });
  d2.go();
  await until(() => d2.view.stamp.state.phase === "mint");
  click(d2.act().querySelector("[data-mint]"));
  await until(() => d2.view.stamp.state.phase === "reverted");
  click(d2.act().querySelector("[data-recheck]"));
  await until(() => d2.view.stamp.state.phase === "held");
});

test("timeout: no receipt within the wait → sent, still confirming, with the link; still pending, never minted, never resent; a later visit looks again", async () => {
  const wallet = fakeWallet();
  const storage = memStorage();
  const clock = fakeClock();
  const stamps = mockStamps({ receipts: [{ status: "pending" }] });
  const a = appWith({ deployed: true });
  const d = deckAtTrait({ identity: identityWith({ wallet }), a, stamps, storage, clock });
  d.go();
  await until(() => d.view.stamp.state.phase === "mint");
  const sentAt = clock.t;
  click(d.act().querySelector("[data-mint]"));
  await until(() => d.view.stamp.state.phase === "slow", 2000);
  assert.equal(d.view.stamp.state.phase, "slow");
  assert.ok(visibleText(d.act().innerHTML).includes(COPY.mintSlow));
  assert.equal(d.act().querySelector("a.trait__link").getAttribute("href"), EXPLORER);
  assert.ok(clock.t - sentAt >= RECEIPT_TIMING.giveUpMs, "about five minutes of polling");
  assert.deepEqual(clock.sleeps.slice(0, 6), [2000, 2000, 3000, 5000, 8000, 10000], "backoff 2/3/5/8 s…");
  assert.ok(clock.sleeps.every((ms) => ms <= 10000), "…capped at 10 s");
  assert.equal(d.citizen.mintFor(CFG, 0).status, "pending");
  assert.equal(wallet.sent.length, 1, "never resent");
  assert.equal(d.act().querySelector("[data-mint]"), null);
  d.view.destroy();
  // a later visit, still inside the drop window: confirming, and it polls again (here: success)
  const later = fakeClock(sentAt + 6 * 60_000);
  const s2 = mockStamps({ receipts: [{ status: "success", tokenId: 9 }] });
  const d2 = deckAtTrait({ identity: identityWith({ wallet: fakeWallet() }), a, stamps: s2, storage, clock: later });
  assert.equal(d2.view.stamp.state.phase, "confirming", "the first paint says it's on its way");
  d2.go();
  await until(() => d2.view.stamp.state.phase === "minted");
  assert.equal(d2.citizen.mintFor(CFG, 0).tokenId, 9);
});

test("a pending tx with no receipt long after it was sent never landed: forgotten after a check (or 'held' if the chain has it anyway)", async () => {
  for (const [held, phase] of [
    [false, "dropped"],
    [true, "held"],
  ]) {
    const storage = memStorage();
    const c = openCitizen(storage, { key: citizenKey("/Capable/") });
    const t0 = 1_700_000_000_000;
    c.recordMint(CFG, 0, { txHash: TX, explorerUrl: EXPLORER, from: ACCOUNT, status: "pending", sentAt: t0 });
    const stamps = mockStamps({ receipts: [{ status: "pending" }], check: async () => ({ open: true, held }) });
    const d = deckAtTrait({ a: appWith({ deployed: true }), stamps, storage, clock: fakeClock(t0 + RECEIPT_TIMING.dropMs + 1) });
    d.go();
    await until(() => d.view.stamp.state.phase === phase);
    assert.equal(stamps.calls.receipt.length, 1, "one look is enough after that long");
    assert.equal(stamps.calls.check[0].holder, ACCOUNT);
    assert.equal(d.citizen.mintFor(CFG, 0), null, "forgotten");
    if (phase === "dropped") {
      assert.ok(visibleText(d.act().innerHTML).includes(COPY.mintDropped));
      assert.ok(d.act().querySelector("[data-recheck]"));
      assert.equal(d.act().querySelector("a.trait__link").getAttribute("href"), EXPLORER);
    }
  }
  // the chain can't be read at all: keep waiting, keep the record
  const storage = memStorage();
  openCitizen(storage, { key: citizenKey("/Capable/") }).recordMint(CFG, 0, { txHash: TX, explorerUrl: EXPLORER, from: ACCOUNT, status: "pending", sentAt: 1 });
  const down = mockStamps({ receipts: [{ status: "pending", error: "HTTP 503" }] });
  const d = deckAtTrait({ a: appWith({ deployed: true }), stamps: down, storage });
  d.go();
  await until(() => d.view.stamp.state.phase === "slow", 2000);
  assert.equal(d.view.stamp.state.phase, "slow");
  assert.ok(down.calls.receipt.length > 10, "a failed read isn't a failed mint: it kept polling");
  assert.equal(d.citizen.mintFor(CFG, 0).status, "pending");
});

// ---- the wallet's own refusals ----------------------------------------------------------

test("pressing Mint again while the wallet works sends nothing more", async () => {
  let release;
  const wallet = fakeWallet({ send: () => new Promise((r) => (release = () => r(TX))) });
  const stamps = mockStamps();
  const d = deckAtTrait({ identity: identityWith({ wallet }), a: appWith({ deployed: true }), stamps });
  d.go();
  await until(() => d.view.stamp.state.phase === "mint");
  const btn = d.act().querySelector("[data-mint]");
  click(btn);
  click(btn);
  await until(() => release);
  click(d.act().querySelector("button"));
  release();
  await until(() => d.view.stamp.state.phase === "minted");
  assert.equal(stamps.calls.mint.length, 1);
  assert.equal(wallet.sent.length, 1);
});

test("rejected in the wallet: says nothing was sent, and Try again may start over", async () => {
  const err = Object.assign(new Error("User rejected the request."), { code: 4001 });
  const wallet = fakeWallet({ send: async () => Promise.reject(err) });
  const d = deckAtTrait({ identity: identityWith({ wallet }), a: appWith({ deployed: true }) });
  d.go();
  await until(() => d.view.stamp.state.phase === "mint");
  click(d.act().querySelector("[data-mint]"));
  await until(() => d.view.stamp.state.phase !== "busy");
  assert.deepEqual(d.view.stamp.state, { phase: "error", code: "rejected" });
  assert.equal(d.act().querySelector(".trait__error").textContent, COPY.mintError.rejected);
  assert.equal(d.act().querySelector(".trait__error").getAttribute("role"), "alert");
  click(d.act().querySelector("[data-mint]"));
  await until(() => d.view.stamp.state.phase !== "busy");
  assert.equal(wallet.sent.length, 2, "a refused send can be asked again: nothing went out");
  assert.equal(d.citizen.mintFor(CFG, 0), null);
});

test("a wallet that won't switch to Base: wrong network, Try again", async () => {
  const wallet = fakeWallet({ switchErr: Object.assign(new Error("nope"), { code: -32000 }) });
  const d = deckAtTrait({ identity: identityWith({ wallet }), a: appWith({ deployed: true }) });
  d.go();
  await until(() => d.view.stamp.state.phase === "mint");
  click(d.act().querySelector("[data-mint]"));
  await until(() => d.view.stamp.state.phase !== "busy");
  assert.deepEqual(d.view.stamp.state, { phase: "error", code: "wrong-chain" });
  assert.equal(d.act().querySelector(".trait__error").textContent, COPY.mintError["wrong-chain"]);
  assert.ok(d.act().querySelector("[data-mint]"));
  assert.equal(wallet.sent.length, 0);
});

test("a wallet failure after the send was asked for: failed, check the wallet, no resend offered", async () => {
  const wallet = fakeWallet({ send: async () => Promise.reject(new Error("internal error")) });
  const d = deckAtTrait({ identity: identityWith({ wallet }), a: appWith({ deployed: true }) });
  d.go();
  await until(() => d.view.stamp.state.phase === "mint");
  click(d.act().querySelector("[data-mint]"));
  await until(() => d.view.stamp.state.phase !== "busy");
  assert.deepEqual(d.view.stamp.state, { phase: "error", code: "failed" });
  assert.equal(d.act().querySelector(".trait__error").textContent, COPY.mintError.failed);
  assert.equal(d.act().querySelector("[data-mint]"), null, "never resend");
});

test("the mint's code failing to load (offline) is reported, so an updated app can be offered a reload (review V7)", async () => {
  const lazy = [];
  const stamps = mockStamps();
  stamps.mint = async () => Promise.reject(stampsErr("offline"));
  const d = deckAtTrait({ identity: identityWith({ wallet: fakeWallet() }), a: appWith({ deployed: true }), stamps, onLazyFail: (e) => lazy.push(e) });
  d.go();
  await until(() => d.view.stamp.state.phase === "mint");
  click(d.act().querySelector("[data-mint]"));
  await until(() => d.view.stamp.state.phase !== "busy");
  assert.deepEqual(d.view.stamp.state, { phase: "error", code: "offline" });
  assert.equal(lazy.length, 1);
  assert.equal(lazy[0].code, "offline");
  // a wallet in the page whose code never arrived (identity.wallet() → null) is reported too
  const lazy2 = [];
  const d2 = deckAtTrait({ identity: identityWith({ wallet: null }), a: appWith({ deployed: true }), onLazyFail: (e) => lazy2.push(e), ethereum: true });
  d2.go();
  await settle();
  assert.equal(lazy2.length, 1);
  assert.equal(visibleText(d2.act().innerHTML), COPY.stampSaved);
});

// ---- the preview ------------------------------------------------------------------------

test("the preview's holder: the connected wallet's account, else the signed-in person's listed address, else a stand-in from the local id (review V14)", async () => {
  const a = appWith();
  const verified = "0x1111111111111111111111111111111111111111";
  const x = deckAtTrait({ identity: identityWith({ current: { fid: 3, verifications: [verified] } }) });
  assert.ok(x.art().includes(previewOf(a, verified)));
  const storage = memStorage({ [citizenKey("/Capable/")]: JSON.stringify({ id: "c".repeat(40), wallet: ACCOUNT }) });
  const b = deckAtTrait({ storage });
  assert.ok(b.art().includes(previewOf(a, ACCOUNT)));
  const both = deckAtTrait({ storage, identity: identityWith({ current: { fid: 3, verifications: [verified] } }) });
  assert.ok(both.art().includes(previewOf(a, ACCOUNT)), "the wallet the person connected wins over the relay's unsigned list");
  const c = deckAtTrait({ storage: memStorage({ [citizenKey("/Capable/")]: JSON.stringify({ id: "d".repeat(40) }) }) });
  assert.ok(c.art().includes(previewOf(a, placeholderHolder("d".repeat(40)))));
  assert.match(placeholderHolder("d".repeat(40)), /^0x[0-9a-f]{40}$/);
  assert.notEqual(placeholderHolder("d".repeat(40)), placeholderHolder("e".repeat(40)));
});

test("watchProvider passes every request through unchanged and reports the steps", async () => {
  const seen = [];
  const accounts = [];
  const inner = { request: async (a) => (a.method === "eth_requestAccounts" ? [ACCOUNT] : a.method) };
  const w = watchProvider(inner, { onStep: (s) => seen.push(s), onAccount: (a) => accounts.push(a) });
  assert.equal(await w.request({ method: "eth_chainId" }), "eth_chainId");
  await w.request({ method: "wallet_addEthereumChain", params: [] });
  assert.deepEqual(await w.request({ method: "eth_requestAccounts" }), [ACCOUNT]);
  await w.request({ method: "eth_sendTransaction", params: [] });
  await settle();
  assert.deepEqual(seen, ["network", "network", "account", "confirm"]);
  assert.deepEqual(accounts, [ACCOUNT]);
});

// ---- the citizen record (review V8) ----------------------------------------------------

test("mint records are keyed by (chain, contract, stamp): another contract or chain starts clean", () => {
  const storage = memStorage();
  const c = openCitizen(storage, { key: citizenKey("/Capable/") });
  assert.equal(c.recordMint(CFG, 0, { txHash: TX, explorerUrl: EXPLORER, from: ACCOUNT, status: "minted", tokenId: 5, sentAt: 1 }), true);
  const saved = JSON.parse(storage.getItem(citizenKey("/Capable/")));
  assert.deepEqual(Object.keys(saved.mints), [mintKey(8453, CONTRACT, 0)]);
  assert.equal(saved.mints[`8453:${CONTRACT}:0`].tokenId, 5);
  assert.equal(c.mintFor(CFG, 0).status, "minted");
  assert.equal(c.mintFor({ chainId: 8453, address: "0x00000000000000000000000000000000000000b2" }, 0), null, "a v2 contract: nothing carried over");
  assert.equal(c.mintFor({ chainId: 84532, address: CONTRACT }, 0), null, "another chain: nothing");
  assert.equal(c.mintFor(CFG, 1), null);
  assert.equal(c.mintFor(null, 0), null);
  assert.equal(c.mintsFor(CFG).get(0).txHash, TX);
  assert.equal(c.forgetMint(CFG, 0), true);
  assert.equal(c.mintFor(CFG, 0), null);
  assert.equal(c.recordMint(null, 0, { txHash: TX, explorerUrl: EXPLORER }), false, "no contract: nothing kept");
  // a deck against a new contract offers the mint again (check permitting)
});

test("a v2 contract: a trait 'sent' against v1 is offered again (review V8)", async () => {
  const storage = memStorage();
  openCitizen(storage, { key: citizenKey("/Capable/") }).recordMint(CFG, 0, { txHash: TX, explorerUrl: EXPLORER, from: ACCOUNT, status: "pending", sentAt: 1 });
  const a = appWith({ deployed: true });
  a.stamps.address = "0x00000000000000000000000000000000000000b2";
  const d = deckAtTrait({ identity: identityWith({ wallet: fakeWallet() }), a, storage });
  assert.equal(d.view.stamp.state.phase, "saved");
  d.go();
  await until(() => d.view.stamp.state.phase === "mint");
  assert.equal(d.stamps.calls.receipt.length, 0, "the v1 tx isn't followed on v2");
});

test("records kept by trait id by the first v3 build migrate to (chain, contract, stamp) keys, as pending, once the App gives stamp ids", () => {
  const legacy = {
    id: "a".repeat(40),
    wallet: ACCOUNT,
    minted: {
      sovereign: { txHash: TX, explorerUrl: EXPLORER, chainId: 8453, contract: CONTRACT.toUpperCase().replace("0X", "0x") },
      civil: { txHash: `0x${"ab".repeat(32)}`, explorerUrl: `https://basescan.org/tx/0x${"ab".repeat(32)}`, chainId: 8453, contract: CONTRACT },
      mobile: { txHash: TX, explorerUrl: EXPLORER, chainId: null, contract: null },
    },
  };
  const storage = memStorage({ [citizenKey("/Capable/")]: JSON.stringify(legacy) });
  const c = openCitizen(storage, { key: citizenKey("/Capable/") });
  assert.deepEqual(Object.keys(c.get().legacy).sort(), ["civil", "sovereign"], "a record without chain or contract can't be keyed: dropped");
  assert.equal(c.mintFor(CFG, 0), null, "not before the App says which stamp id each trait has");
  assert.equal(c.migrate(appWith({ deployed: true, stampIds: false })), true);
  assert.equal(Object.keys(c.get().legacy).length, 2, "no stamp ids yet: kept");
  c.migrate(appWith({ deployed: true }));
  assert.deepEqual(c.get().legacy, {});
  const sov = c.mintFor(CFG, 0);
  assert.deepEqual({ status: sov.status, txHash: sov.txHash, contract: sov.contract, from: sov.from, sentAt: sov.sentAt }, { status: "pending", txHash: TX, contract: CONTRACT, from: null, sentAt: null }, "never confirmed: pending, checked again on the next view");
  assert.equal(c.mintFor(CFG, 1).txHash, `0x${"ab".repeat(32)}`);
  const saved = JSON.parse(storage.getItem(citizenKey("/Capable/")));
  assert.equal(saved.minted, undefined, "the old field is gone once migrated");
  assert.equal(saved.legacy, undefined);
  assert.deepEqual(Object.keys(saved.mints).sort(), [`8453:${CONTRACT}:0`, `8453:${CONTRACT}:1`]);
  assert.equal(c.migrate(appWith({ deployed: true })), false, "idempotent");
  // and the boot path runs it: a migrated pending record is followed on the trait card
});

test("a migrated record is followed on its trait card: one receipt read, then the real stamp", async () => {
  const storage = memStorage({ [citizenKey("/Capable/")]: JSON.stringify({ minted: { sovereign: { txHash: TX, explorerUrl: EXPLORER, chainId: 8453, contract: CONTRACT } } }) });
  const a = appWith({ deployed: true });
  openCitizen(storage, { key: citizenKey("/Capable/") }).migrate(a);
  const stamps = mockStamps({ receipts: [{ status: "success", tokenId: 3 }] });
  const d = deckAtTrait({ a, storage, stamps });
  assert.equal(d.view.stamp.state.phase, "confirming");
  d.go();
  await until(() => d.view.stamp.state.phase === "minted");
  assert.equal(d.citizen.mintFor(CFG, 0).tokenId, 3);
});

test("citizen storage: hostile records are dropped on read", () => {
  const good = { txHash: TX, explorerUrl: EXPLORER, chainId: 8453, contract: CONTRACT, stampId: 1, status: "minted", tokenId: 4, from: ACCOUNT, sentAt: 5 };
  const storage = memStorage({
    [citizenKey("/Capable/")]: JSON.stringify({
      id: "<script>",
      wallet: "0xnope",
      mints: {
        [`8453:${CONTRACT}:1`]: good,
        [`8453:${CONTRACT}:2`]: { ...good, stampId: 1 }, // the key and the record disagree
        [`8453:${CONTRACT}:0`]: { ...good, stampId: 0, explorerUrl: "javascript:alert(1)" },
        [`8453:${CONTRACT}:3`]: { ...good, stampId: 3, explorerUrl: "https://evil.example/tx/" + TX },
        "../x": good,
        [`8453:${CONTRACT}:300`]: { ...good, stampId: 300 },
      },
      minted: { sovereign: { txHash: TX, explorerUrl: "javascript:alert(1)", chainId: 8453, contract: CONTRACT }, "../x": { txHash: TX, explorerUrl: EXPLORER, chainId: 8453, contract: CONTRACT } },
    }),
  });
  const c = openCitizen(storage, { key: citizenKey("/Capable/") });
  assert.equal(c.get().id, null);
  assert.equal(c.get().wallet, null);
  assert.deepEqual(Object.keys(c.get().mints), [`8453:${CONTRACT}:1`]);
  assert.deepEqual(c.get().legacy, {});
  const bad = sanitizeTokenless({ ...good, tokenId: 1e12 });
  assert.equal(bad, null, "an impossible token id is not drawn");
  assert.match(c.localId(), /^[0-9a-f]{40}$/);
  const broken = openCitizen({ getItem: () => "{", setItem: () => { throw new Error("full"); } }, { key: "k" });
  assert.match(broken.localId(), /^[0-9a-f]{40}$/, "storage that throws: the id lasts the session");
});

/** A minted record with this token id, read back through storage: its tokenId (null when refused). */
function sanitizeTokenless(rec) {
  const storage = memStorage({ k: JSON.stringify({ mints: { [`8453:${CONTRACT}:1`]: rec } }) });
  return openCitizen(storage, { key: "k" }).mintFor(CFG, 1)?.tokenId ?? null;
}

// ---- the real stamps module, with a scripted Base RPC (no network) ------------------------

/** A JSON-RPC endpoint for createStamps({ fetch }): the trait's open flag, who holds what, and a receipt script. */
function scriptedRpc({ open = true, held = () => false, receipts = [null] } = {}) {
  const calls = [];
  let r = 0;
  const word = (x) => `0x${BigInt(x).toString(16).padStart(64, "0")}`;
  const fetch = async (url, init) => {
    const { id, method, params } = JSON.parse(init.body);
    calls.push({ url, method });
    let result;
    if (method === "eth_call") {
      const { functionName, args } = decodeFunctionData({ abi: STAMPS_ABI, data: params[0].data });
      if (functionName === "traitOf") result = encodeFunctionResult({ abi: STAMPS_ABI, functionName, result: ["SOVEREIGN", "#18C8F0", 0, open] });
      else if (functionName === "hasStamp") result = encodeFunctionResult({ abi: STAMPS_ABI, functionName, result: held(args[0].toLowerCase(), args[1]) });
      else throw new Error(`unexpected ${functionName}`);
    } else if (method === "eth_getTransactionReceipt") {
      const x = receipts[Math.min(r++, receipts.length - 1)];
      result = x && { transactionHash: params[0], status: x.status, from: x.from, logs: x.tokenId ? [{ address: CONTRACT, topics: [TOPICS.Stamped, word(BigInt(x.holder)), word(0), word(x.tokenId)] }] : [] };
    } else throw new Error(`unexpected ${method}`);
    return { ok: true, json: async () => ({ jsonrpc: "2.0", id, result }) };
  };
  return { fetch, calls };
}

test("with the real stamps module: check → mint (re-checked for the sender, explicit chainId) → receipt for `from` → the real stamp; nothing touches the network", async () => {
  const BUNDLER = "0x4337433743374337433743374337433743374337";
  const rpc = scriptedRpc({ receipts: [null, { status: "0x1", from: BUNDLER, holder: ACCOUNT, tokenId: 4321 }] });
  const stamps = createStamps({ fetch: rpc.fetch });
  const wallet = fakeWallet();
  const a = appWith({ deployed: true });
  const d = deckAtTrait({ identity: identityWith({ wallet }), a, stamps });
  d.go();
  await until(() => d.view.stamp.state.phase === "mint");
  click(d.act().querySelector("[data-mint]"));
  await until(() => d.view.stamp.state.phase === "minted");
  assert.equal(d.view.stamp.state.phase, "minted", "a smart wallet's receipt (sent by a bundler) still reads as the holder's mint");
  assert.equal(wallet.sent.length, 1);
  assert.equal(wallet.sent[0].chainId, "0x2105");
  assert.equal(d.citizen.mintFor(CFG, 0).tokenId, 4321);
  assert.ok(d.art().includes(realArt(a, ACCOUNT, 4321)));
  assert.ok(rpc.calls.every((c) => c.url === "https://mainnet.base.org"), "only the (scripted) Base RPC");
  assert.ok(rpc.calls.filter((c) => c.method === "eth_getTransactionReceipt").length === 2);
});

test("with the real stamps module: closed on chain → paused, no mint; held → already in your wallet; the RPC down → nothing about minting", async () => {
  for (const [rpc, phase] of [
    [scriptedRpc({ open: false }), "closed"],
    [scriptedRpc({ held: (h) => h === ACCOUNT }), "held"],
    [{ fetch: async () => ({ ok: false, status: 503 }) }, "saved"],
  ]) {
    const d = deckAtTrait({ identity: identityWith({ wallet: fakeWallet({ accounts: [ACCOUNT] }) }), a: appWith({ deployed: true }), stamps: createStamps({ fetch: rpc.fetch }) });
    d.go();
    await until(() => d.view.stamp.state.phase !== "saved");
    await settle();
    assert.equal(d.view.stamp.state.phase, phase);
    assert.equal(d.act().querySelector("[data-mint]"), null, phase);
  }
});
