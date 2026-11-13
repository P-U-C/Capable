// Loaded only through import() from ./index.mjs, so the Mini App SDK becomes a
// lazy chunk. Re-exporting just `sdk` lets the bundler drop the rest.
export { sdk } from "@farcaster/miniapp-sdk";
