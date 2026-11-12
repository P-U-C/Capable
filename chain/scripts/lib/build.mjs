// Compile with solcjs and load the artifact. Shared by compile, tests, rehearse and deploy.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import solc from "solc";

export const CHAIN_DIR = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
export const ROOT = new URL("../../..", import.meta.url).pathname.replace(/\/$/, "");
export const CONTRACT = { sourceName: "src/CapableStamps.sol", contractName: "CapableStamps" };

/** Compiler settings. evmVersion cancun: Base has run Cancun since Ecotone (2024); nothing newer is needed. */
export const SETTINGS = {
  optimizer: { enabled: true, runs: 200 },
  evmVersion: "cancun",
  metadata: { bytecodeHash: "ipfs" },
  outputSelection: { "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object", "metadata", "storageLayout"] } },
};

const require = createRequire(import.meta.url);

/** "@openzeppelin/contracts/…" → node_modules; everything else relative to chain/. */
function readSource(path) {
  const file = path.startsWith("@") ? require.resolve(path) : join(CHAIN_DIR, path);
  return readFileSync(file, "utf8");
}

/**
 * Compile src/*.sol. Imports are resolved through solc's callback and recorded, so
 * the returned `input` is the complete standard JSON (every source inlined) that
 * produced the artifact: the exact payload for source verification.
 */
export function compile() {
  const sources = {};
  for (const f of readdirSync(join(CHAIN_DIR, "src")).filter((f) => f.endsWith(".sol")).sort()) {
    sources[`src/${f}`] = { content: readSource(`src/${f}`) };
  }
  const imported = {};
  const findImports = (path) => {
    try {
      const content = readSource(path);
      imported[path] = { content };
      return { contents: content };
    } catch {
      return { error: `not found: ${path}` };
    }
  };
  const input = { language: "Solidity", sources, settings: SETTINGS };
  const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));
  const errors = (output.errors || []).filter((e) => e.severity === "error");
  if (errors.length) throw new Error(errors.map((e) => e.formattedMessage).join("\n"));
  const c = output.contracts[CONTRACT.sourceName][CONTRACT.contractName];
  const longVersion = solc.version(); // "0.8.30+commit.73712a01.Emscripten.clang"
  const version = longVersion.replace(/\.Emscripten\.clang$/, "");
  const full = {
    language: "Solidity",
    sources: Object.fromEntries(Object.entries({ ...sources, ...imported }).sort(([a], [b]) => a.localeCompare(b))),
    settings: SETTINGS,
  };
  return {
    input: full,
    warnings: (output.errors || []).filter((e) => e.severity !== "error").map((e) => e.formattedMessage),
    artifact: {
      ...CONTRACT,
      compiler: { version, longVersion },
      settings: SETTINGS,
      abi: c.abi,
      bytecode: `0x${c.evm.bytecode.object}`,
      deployedBytecode: `0x${c.evm.deployedBytecode.object}`,
      metadata: c.metadata,
      storageLayout: c.storageLayout,
    },
  };
}

/** Compile a standard-JSON input with no import callback (used to prove `input` is complete). */
export function compileStandardJson(input) {
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (output.errors || []).filter((e) => e.severity === "error");
  if (errors.length) throw new Error(errors.map((e) => e.formattedMessage).join("\n"));
  return output.contracts[CONTRACT.sourceName][CONTRACT.contractName];
}

/** The artifact written by scripts/compile.mjs (npm test / rehearse / deploy compile first). */
export function loadArtifact() {
  const path = join(CHAIN_DIR, "build/CapableStamps.json");
  if (!existsSync(path)) throw new Error("chain/build/CapableStamps.json missing: run `npm run build` in chain/");
  return JSON.parse(readFileSync(path, "utf8"));
}

export function loadInput() {
  return JSON.parse(readFileSync(join(CHAIN_DIR, "build/CapableStamps.input.json"), "utf8"));
}

/** Runtime bytecode size in bytes (EIP-170 limit: 24,576). */
export const codeSize = (hex) => (hex.length - 2) / 2;
