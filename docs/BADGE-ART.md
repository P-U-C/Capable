# Badge art: the parity rule

Planner-owned. `contract/badge-art.mjs` is the oracle for stamp art.

- The art lane imports `badgeSvg` from it as-is (`ArtAPI.stamp`). It does not
  copy or fork it.
- The stamps lane ports it to Solidity (`chain/`), and `cd chain && npm test`
  must prove the port is **byte-identical**:
  1. every vector in `contract/fixtures/badge-vectors.json` (input → `svg`),
  2. 200 random inputs generated in the test from a fixed seed, rendered by
     both `badgeSvg` and the contract on a local chain, compared as strings.
- Inputs: `seed` (bytes32), `name` (1–12 of A–Z and space, starting with a
  letter), `color` (`#RRGGBB` uppercase), `emblem` (uint8), `serial`
  (`< 10^9`). The contract rejects anything else at `addTrait`.
- On chain, `seed = keccak256(abi.encodePacked(holder, uint8 stampId,
  uint256 tokenId))`, computed and stored at mint.
- Metadata is `badgeMetadata()` from the same file, base64-encoded into a
  `data:application/json;base64,` URI; its `image` is the base64 SVG.
- Any change to the look is a planner change to `badge-art.mjs` plus
  regenerated vectors, then the port follows. Never the other way round.
