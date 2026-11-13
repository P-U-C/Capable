// Loaded only through import() from ./index.mjs, so the sign-in client (and
// the viem it brings) becomes a lazy chunk. Only what the web flow uses.
export { createAppClient, viemConnector } from "@farcaster/auth-client";
