// Foundry's anvil and cast, pinned through npm (@foundry-rs/*). No foundryup needed:
// `npm ci` in chain/ installs the binary for this platform.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { CHAIN_DIR } from "./build.mjs";

const PLATFORM = { linux: "linux", darwin: "darwin", win32: "win32" }[process.platform];
const ARCH = { x64: "amd64", arm64: "arm64" }[process.arch];

/** Absolute path of a Foundry binary installed by npm in chain/node_modules. */
export function tool(name) {
  const bin = join(CHAIN_DIR, "node_modules/@foundry-rs", `${name}-${PLATFORM}-${ARCH}`, "bin", process.platform === "win32" ? `${name}.exe` : name);
  if (!existsSync(bin)) throw new Error(`${name} not found at ${bin}: run \`npm ci\` in chain/ (Foundry ${name} comes from @foundry-rs/${name})`);
  return bin;
}

/** anvil's well-known, public test accounts (mnemonic "test test … junk"). Local chains only. */
export const ANVIL_ACCOUNTS = [
  "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
  "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
  "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65",
];

/**
 * Start a throwaway anvil on a free localhost port. Resolves { url, chainId, stop() }.
 * Every account above is unlocked, so no key is ever needed.
 */
export function startAnvil({ chainId = 31337, args = [] } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(tool("anvil"), ["--host", "127.0.0.1", "--port", "0", "--chain-id", String(chainId), "--hardfork", "cancun", ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let buf = "";
    let done = false;
    const timer = setTimeout(() => fail(new Error(`anvil did not start in 15 s:\n${buf}`)), 15_000);
    const fail = (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.kill("SIGKILL");
      reject(err);
    };
    const onData = (d) => {
      buf += d;
      const m = buf.match(/Listening on (127\.0\.0\.1:\d+)/);
      if (m && !done) {
        done = true;
        clearTimeout(timer);
        child.stdout.removeAllListeners("data");
        child.stdout.resume();
        const stop = () =>
          new Promise((res) => {
            if (child.exitCode !== null || child.signalCode !== null) return res();
            child.once("exit", () => res());
            child.kill("SIGTERM");
            setTimeout(() => child.kill("SIGKILL"), 3000).unref();
          });
        resolve({ url: `http://${m[1]}`, chainId, stop, process: child });
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", (d) => (buf += d));
    child.on("error", fail);
    child.on("exit", (code) => fail(new Error(`anvil exited (${code}):\n${buf}`)));
  });
}
