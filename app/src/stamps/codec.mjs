// ABI encoding and decoding with viem. Loaded only on use (import("./codec.mjs")
// from index.mjs), so viem stays out of the first-paint bundle.
import { decodeFunctionResult, encodeFunctionData, encodeFunctionResult } from "viem";
import { STAMPS_ABI } from "./abi.mjs";

export const encode = (functionName, args) => encodeFunctionData({ abi: STAMPS_ABI, functionName, args });

/**
 * Decode a call's answer, accepting only the canonical encoding of what was decoded. viem alone reads a
 * uint8 from a word with dirty high bytes (256, 300, …) and ignores trailing bytes; the contract never
 * answers like that, so such an answer comes from a broken or hostile RPC and is refused.
 */
export function decode(functionName, data) {
  let value, again;
  try {
    value = decodeFunctionResult({ abi: STAMPS_ABI, functionName, data });
    again = encodeFunctionResult({ abi: STAMPS_ABI, functionName, result: value });
  } catch {
    throw new Error("unexpected answer from the contract");
  }
  if (typeof data !== "string" || again.toLowerCase() !== data.toLowerCase()) throw new Error("unexpected answer from the contract");
  return value;
}
