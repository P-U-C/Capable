// The slice of CapableStamps (chain/src/CapableStamps.sol) the app calls.
// chain/test/build.test.mjs checks every entry against the compiled contract.
export const STAMPS_ABI = [
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [{ name: "stampId", type: "uint8" }],
    outputs: [{ name: "tokenId", type: "uint256" }],
  },
  {
    type: "function",
    name: "tokensOf",
    stateMutability: "view",
    inputs: [{ name: "holder", type: "address" }],
    outputs: [{ name: "", type: "uint256[]" }],
  },
  {
    type: "function",
    name: "stampOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "hasStamp",
    stateMutability: "view",
    inputs: [
      { name: "holder", type: "address" },
      { name: "stampId", type: "uint8" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "traitOf",
    stateMutability: "view",
    inputs: [{ name: "stampId", type: "uint8" }],
    outputs: [
      { name: "name", type: "string" },
      { name: "color", type: "string" },
      { name: "emblem", type: "uint8" },
      { name: "open", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "tokenURI",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "string" }],
  },
];
