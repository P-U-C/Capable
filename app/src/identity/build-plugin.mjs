// For the app's esbuild build (app/build.mjs), not for the browser.
//
// The identity module loads the Mini App SDK and the sign-in client through
// import(), so with `splitting: true` they become lazy chunks. One more step
// keeps those chunks small: @farcaster/miniapp-core declares no "sideEffects",
// so esbuild keeps every zod schema it defines (about 440 KB of zod, minified)
// although the SDK uses none of them at runtime (it takes only error classes
// and a Solana helper from the core). Marking the core side-effect free lets
// esbuild drop the unused schemas, and zod with them.
//
//   import { identityBuildPlugin } from "./src/identity/build-plugin.mjs";
//   esbuild.build({ ..., splitting: true, format: "esm", outdir, plugins: [identityBuildPlugin(), ...] })

const PURE = /^@farcaster\/miniapp-core$/;

export function identityBuildPlugin() {
  return {
    name: "identity-lazy-deps",
    setup(build) {
      build.onResolve({ filter: PURE }, async (args) => {
        if (args.pluginData?.identityPure) return undefined;
        const r = await build.resolve(args.path, {
          kind: args.kind,
          importer: args.importer,
          resolveDir: args.resolveDir,
          pluginData: { identityPure: true },
        });
        if (r.errors.length) return { errors: r.errors };
        return { path: r.path, namespace: r.namespace, external: r.external, sideEffects: false };
      });
    },
  };
}

/** docs/SPEC-V3.md "Budgets": lazy chunks (identity, wallet, chain reads) together. */
export const LAZY_BUDGET = 600 * 1024;
