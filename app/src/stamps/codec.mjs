// ABI encoding and decoding with viem. Loaded only on use (import("./codec.mjs")
// from index.mjs), so viem stays out of the first-paint bundle.
import { decodeFunctionResult, encodeFunctionData } from "viem";
import { STAMPS_ABI } from "./abi.mjs";

export const encode = (functionName, args) => encodeFunctionData({ abi: STAMPS_ABI, functionName, args });
export const decode = (functionName, data) => decodeFunctionResult({ abi: STAMPS_ABI, functionName, data });
