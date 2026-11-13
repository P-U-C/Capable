// P2 / U6: the trait card is the reward. It takes the trait colour, the stamp
// is pressed onto it (reduced-motion safe), and it says where the stamp went:
// saved to the passport, or (only with a deployed contract AND a wallet) the
// mint flow: the network switch, the wallet's confirm, sent with an explorer
// link; rejected / wrong network / failed each say so, and nothing is ever
// sent twice. Driven through the fake DOM with mocked identity and wallet, and
// the real stamps module where the flow is the module's.
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
import { openCitizen, citizenKey, placeholderHolder } from "../src/citizen.mjs";
import { watchProvider, mintErrorCode } from "../src/mint.mjs";
import { COPY } from "../src/copy.mjs";
import { stampMarkup, stampTraitOf } from "../src/art.mjs";
import { preview, createStamps } from "../src/stamps/index.mjs";

const CONTRACT = "0x00000000000000000000000000000000ca9ab1e5";
const ACCOUNT = "0x5e5f0a6e2b4c1d3f9a8b7c6d5e4f3a2b1c0d9e8f";
const TX = `0x${"7c".repeat(32)}`;

function appWith({ deployed = false, stampIds = true } = {}) {
  const a = fixture();
  const meta = { sovereign: ["#18C8F0", 0], civil: ["#FF1FC8", 1], mobile: ["#5CF27E", 2], enduring: ["#FFE11A", 3] };
  a.traits = a.traits.map((t) => ({ ...t, color: meta[t.id][0], emblem: meta[t.id][1], ...(stampIds ? { stampId: meta[t.id][1] } : {}) }));
  a.stamps = { chainId: 8453, address: deployed ? CONTRACT : null };
  return a;
}

function identityWith({ wallet = null, current = null } = {}) {
  const calls = { wallet: 0 };
  return {
    calls,
    current: () => current,
    wallet: async () => {
      calls.wallet++;
      return wallet;
    },
  };
}

/**
 * A wallet (EIP-1193) on another chain that switches when asked. `send`
 * decides what eth_sendTransaction does; `accounts` is what eth_accounts says.
 */
function fakeWallet({ send = async () => TX, accounts = [], chain = "0x1", switchErr = null } = {}) {
  const calls = [];
  let cur = chain;
  return {
    calls,
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
      if (method === "eth_sendTransaction") return send(params);
      throw new Error(`unexpected ${method}`);
    },
  };
}

/** The deck for a lesson, at its trait card, with these modules. */
function deckAtTrait({ lessonId = "own-your-exit", a = appWith(), identity = identityWith(), stamps = createStamps({ fetch: async () => ({ ok: false, status: 500 }) }), storage = memStorage(), reduced = false } = {}) {
  const win = fakeWindow({ storage, reducedMotion: reduced });
  const doc = win.document;
  const root = doc.createElement("div");
  doc.body.appendChild(root);
  const store = openStore(storage, { key: storageKey("/Capable/") });
  const citizen = openCitizen(storage, { key: citizenKey("/Capable/") });
  const view = mountDeck(root, { app: a, lessonId, store, reduced, identity, stamps, citizen });
  const card = root.querySelector('.card[data-type="trait"]');
  const go = () => view.go(Number(card.dataset.i));
  const act = () => card.querySelector("[data-stamp-act]");
  return { win, doc, root, view, card, go, act, citizen, storage, identity, stamps, a };
}

const click = (el) => el.dispatchEvent(new FakeEvent("click", { bubbles: true }));

// ---- markup ---------------------------------------------------------------------------

test("the trait card: the trait-colour fill look, the pressed stamp in the trait's colour, the name at full Shout, the count as plain Pixel text", () => {
  const app = appWith();
  const { cards, ctx } = deckModel(app, "own-your-exit", emptyState());
  const i = cards.findIndex((c) => c.type === "trait");
  const m = String(renderCard(cards[i], i, { ...ctx, holder: ACCOUNT }));
  const section = tags(m, "section")[0];
  assert.equal(attr(section, "data-look"), "fill", "the full trait-colour look (U6)");
  const stamp = m.match(/<div class="trait__stamp"[^>]*>/)[0];
  assert.equal(attr(stamp, "role"), "img");
  assert.equal(attr(stamp, "aria-label"), COPY.stampA11y("Sovereign"));
  const st = stampTraitOf(app, app.traits[0]);
  assert.ok(m.includes(String(stampMarkup(preview({ holder: ACCOUNT, stampId: 0, tokenId: 0, trait: st })))), "the stamp module's preview for the holder, tokenId 0");
  assert.match(m, /fill="#18C8F0"/, "in the trait's colour");
  assert.match(m, /<h2 class="shout trait__name"[^>]*>[\s\S]*Sovereign/);
  assert.match(m, /<p class="pixel trait__count">/);
  assert.match(visibleText(m), new RegExp(COPY.stampSaved));
  const saved = tags(m, "a").find((t) => /trait__saved/.test(attr(t, "class")));
  assert.equal(attr(saved, "href"), "#/passport", "saved to your passport: a way to see it");
  // no holder known: the fixed stand-in; a trait whose name the stamp cannot print: no art, no crash
  const anon = String(renderCard(cards[i], i, ctx));
  assert.ok(anon.includes(String(stampMarkup(preview({ holder: PREVIEW_HOLDER, stampId: 0, tokenId: 0, trait: st })))));
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

test("renderStampAct: every state's copy; only errors where nothing can have been sent offer Try again", () => {
  assert.match(visibleText(String(renderStampAct({ phase: "mint" }))), new RegExp(COPY.mintStamp));
  for (const step of ["network", "account", "confirm"]) {
    const m = String(renderStampAct({ phase: "busy", step }));
    assert.match(m, /disabled/);
    assert.ok(visibleText(m).includes(COPY.mintPhase[step]), step);
  }
  const sent = String(renderStampAct({ phase: "sent", explorerUrl: `https://basescan.org/tx/${TX}` }));
  const link = tags(sent, "a")[0];
  assert.equal(attr(link, "href"), `https://basescan.org/tx/${TX}`);
  assert.equal(attr(link, "rel"), "noopener noreferrer");
  assert.doesNotMatch(String(renderStampAct({ phase: "sent", explorerUrl: "javascript:alert(1)" })), /<a /, "only an https link");
  for (const code of ["rejected", "wrong-chain", "offline", "no-account"]) assert.match(String(renderStampAct({ phase: "error", code })), /data-mint/, code);
  for (const code of ["failed", "wallet", "not-configured", "anything"]) assert.doesNotMatch(String(renderStampAct({ phase: "error", code })), /data-mint/, code);
  assert.equal(mintErrorCode("wallet"), "failed", "the wallet may have sent it: never offer a resend");
  assert.equal(mintErrorCode("bad-stamp"), "failed");
  assert.equal(mintErrorCode("rejected"), "rejected");
});

// ---- the flow ------------------------------------------------------------------------

test("no contract configured: saved to your passport, and the wallet code is never loaded", async () => {
  const identity = identityWith({ wallet: fakeWallet() });
  const d = deckAtTrait({ identity });
  d.go();
  await settle();
  assert.equal(d.card.classList.contains("is-earned"), true, "pressed");
  assert.equal(visibleText(d.act().innerHTML), COPY.stampSaved);
  assert.equal(identity.calls.wallet, 0);
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
});

test("a contract and a wallet: Mint → switching to Base → confirm in the wallet → sent with the explorer link; remembered, so never offered again", async () => {
  let release;
  const wallet = fakeWallet({ send: () => new Promise((r) => (release = () => r(TX))) });
  const identity = identityWith({ wallet });
  const storage = memStorage();
  const stamps = createStamps({ fetch: async () => ({ ok: false, status: 500 }) });
  const d = deckAtTrait({ identity, a: appWith({ deployed: true }), storage, stamps });
  d.go();
  await settle();
  const btn = d.act().querySelector("[data-mint]");
  assert.equal(btn.textContent, COPY.mintStamp);
  click(btn);
  assert.equal(d.view.stamp.state.phase, "busy");
  assert.equal(d.view.stamp.state.step, "network");
  assert.ok(d.act().querySelector("button[disabled]"), "the button is disabled while the wallet works");
  // the real stamps module: chain check, switch, accounts, one send
  for (let i = 0; i < 50 && !release; i++) await settle();
  assert.equal(d.view.stamp.state.step, "confirm");
  assert.ok(visibleText(d.act().innerHTML).includes(COPY.mintPhase.confirm));
  assert.deepEqual(wallet.calls, ["eth_accounts", "eth_chainId", "wallet_switchEthereumChain", "eth_chainId", "eth_requestAccounts", "eth_sendTransaction"]);
  click(d.act().querySelector("button") ?? d.act());
  release();
  await settle();
  assert.equal(d.view.stamp.state.phase, "sent");
  const link = d.act().querySelector("a");
  assert.equal(link.getAttribute("href"), `https://basescan.org/tx/${TX}`);
  assert.equal(link.getAttribute("target"), "_blank");
  assert.equal(wallet.calls.filter((m) => m === "eth_sendTransaction").length, 1, "one transaction");
  const rec = d.citizen.get().minted.sovereign;
  assert.equal(rec.txHash, TX);
  assert.equal(rec.contract, CONTRACT);
  assert.equal(d.citizen.get().wallet, ACCOUNT, "the wallet's address, kept for previews and the passport");
  // the stamp preview now shows the wallet as holder
  const st = stampTraitOf(d.a, d.a.traits[0]);
  assert.ok(d.card.querySelector(".trait__press").innerHTML.includes(canon(stampMarkup(preview({ holder: ACCOUNT, stampId: 0, tokenId: 0, trait: st })))));
  // next time: sent, no button, no wallet lookup
  d.view.destroy();
  const identity2 = identityWith({ wallet: fakeWallet() });
  const again = deckAtTrait({ identity: identity2, a: appWith({ deployed: true }), storage });
  again.go();
  await settle();
  assert.equal(again.view.stamp.state.phase, "sent");
  assert.equal(again.act().querySelector("[data-mint]"), null);
  assert.equal(identity2.calls.wallet, 0);
});

test("pressing Mint again while the wallet works sends nothing more", async () => {
  let release;
  const wallet = fakeWallet({ send: () => new Promise((r) => (release = () => r(TX))) });
  const calls = [];
  const stamps = { ...createStamps(), mint: (o) => (calls.push(o), createStamps().mint(o)) };
  stamps.config = createStamps().config;
  const d = deckAtTrait({ identity: identityWith({ wallet }), a: appWith({ deployed: true }), stamps });
  d.go();
  await settle();
  const btn = d.act().querySelector("[data-mint]");
  click(btn);
  click(btn);
  for (let i = 0; i < 50 && !release; i++) await settle();
  click(d.act().querySelector("button"));
  release();
  await settle();
  assert.equal(calls.length, 1);
  assert.equal(wallet.calls.filter((m) => m === "eth_sendTransaction").length, 1);
});

test("rejected in the wallet: says nothing was sent, and Try again may start over", async () => {
  const err = Object.assign(new Error("User rejected the request."), { code: 4001 });
  const wallet = fakeWallet({ send: async () => Promise.reject(err) });
  const d = deckAtTrait({ identity: identityWith({ wallet }), a: appWith({ deployed: true }), stamps: createStamps() });
  d.go();
  await settle();
  click(d.act().querySelector("[data-mint]"));
  for (let i = 0; i < 50 && d.view.stamp.state.phase === "busy"; i++) await settle();
  assert.deepEqual(d.view.stamp.state, { phase: "error", code: "rejected" });
  assert.equal(d.act().querySelector(".trait__error").textContent, COPY.mintError.rejected);
  assert.equal(d.act().querySelector(".trait__error").getAttribute("role"), "alert");
  click(d.act().querySelector("[data-mint]"));
  for (let i = 0; i < 50 && d.view.stamp.state.phase === "busy"; i++) await settle();
  assert.equal(wallet.calls.filter((m) => m === "eth_sendTransaction").length, 2, "a refused send can be asked again: nothing went out");
  assert.equal(d.citizen.get().minted.sovereign, undefined);
});

test("a wallet that won't switch to Base: wrong network, Try again", async () => {
  const wallet = fakeWallet({ switchErr: Object.assign(new Error("nope"), { code: -32000 }) });
  const d = deckAtTrait({ identity: identityWith({ wallet }), a: appWith({ deployed: true }), stamps: createStamps() });
  d.go();
  await settle();
  click(d.act().querySelector("[data-mint]"));
  for (let i = 0; i < 50 && d.view.stamp.state.phase === "busy"; i++) await settle();
  assert.deepEqual(d.view.stamp.state, { phase: "error", code: "wrong-chain" });
  assert.equal(d.act().querySelector(".trait__error").textContent, COPY.mintError["wrong-chain"]);
  assert.ok(d.act().querySelector("[data-mint]"));
  assert.ok(!wallet.calls.includes("eth_sendTransaction"));
});

test("a wallet failure after the send was asked for: failed, check the wallet, no resend offered", async () => {
  const wallet = fakeWallet({ send: async () => Promise.reject(new Error("internal error")) });
  const d = deckAtTrait({ identity: identityWith({ wallet }), a: appWith({ deployed: true }), stamps: createStamps() });
  d.go();
  await settle();
  click(d.act().querySelector("[data-mint]"));
  for (let i = 0; i < 50 && d.view.stamp.state.phase === "busy"; i++) await settle();
  assert.deepEqual(d.view.stamp.state, { phase: "error", code: "failed" });
  assert.equal(d.act().querySelector(".trait__error").textContent, COPY.mintError.failed);
  assert.equal(d.act().querySelector("[data-mint]"), null, "never resend");
});

test("a wallet that already holds this stamp on chain: says so instead of offering a mint that would revert", async () => {
  const wallet = fakeWallet({ accounts: [ACCOUNT] });
  const stamps = { ...createStamps(), owned: async (a) => (a === ACCOUNT ? { stamps: [{ tokenId: 4, stampId: 0 }] } : { stamps: [] }) };
  stamps.config = createStamps().config;
  const d = deckAtTrait({ identity: identityWith({ wallet }), a: appWith({ deployed: true }), stamps });
  d.go();
  await settle();
  assert.equal(d.view.stamp.state.phase, "held");
  assert.equal(visibleText(d.act().innerHTML), COPY.mintHeld);
  assert.equal(d.act().querySelector("[data-mint]"), null);
});

test("the preview's holder: the signed-in person's verified address, else the wallet once known, else a stand-in from the local id", async () => {
  const st = stampTraitOf(appWith(), appWith().traits[0]);
  const art = (holder) => canon(stampMarkup(preview({ holder, stampId: 0, tokenId: 0, trait: st })));
  const verified = "0x1111111111111111111111111111111111111111";
  const a = deckAtTrait({ identity: identityWith({ current: { fid: 3, verifications: [verified] } }) });
  assert.ok(a.card.querySelector(".trait__press").innerHTML.includes(art(verified)));
  const storage = memStorage({ [citizenKey("/Capable/")]: JSON.stringify({ id: "c".repeat(40), wallet: ACCOUNT, minted: {} }) });
  const b = deckAtTrait({ storage });
  assert.ok(b.card.querySelector(".trait__press").innerHTML.includes(art(ACCOUNT)));
  const c = deckAtTrait({ storage: memStorage({ [citizenKey("/Capable/")]: JSON.stringify({ id: "d".repeat(40), minted: {} }) }) });
  assert.ok(c.card.querySelector(".trait__press").innerHTML.includes(art(placeholderHolder("d".repeat(40)))));
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

test("citizen storage: hostile records are dropped on read", () => {
  const storage = memStorage({
    [citizenKey("/Capable/")]: JSON.stringify({
      id: "<script>",
      wallet: "0xnope",
      minted: { sovereign: { txHash: TX, explorerUrl: "javascript:alert(1)" }, civil: { txHash: TX, explorerUrl: `https://basescan.org/tx/${TX}` }, "../x": { txHash: TX, explorerUrl: `https://basescan.org/tx/${TX}` } },
    }),
  });
  const c = openCitizen(storage, { key: citizenKey("/Capable/") });
  assert.equal(c.get().id, null);
  assert.equal(c.get().wallet, null);
  assert.deepEqual(Object.keys(c.get().minted), ["civil"]);
  assert.match(c.localId(), /^[0-9a-f]{40}$/);
  const broken = openCitizen({ getItem: () => "{", setItem: () => { throw new Error("full"); } }, { key: "k" });
  assert.match(broken.localId(), /^[0-9a-f]{40}$/, "storage that throws: the id lasts the session");
});
