/**
 * Hedera testnet ATS factory / resolver (Asset Tokenization Studio v8).
 * Source: @hashgraph/asset-tokenization-sdk README "Initialise the SDK".
 */
export const HEDERA_TESTNET = {
  network: "testnet" as const,
  mirrorNode: "https://testnet.mirrornode.hedera.com/api/v1/",
  rpcNode: "https://testnet.hashio.io/api",
  // Hedera entity IDs for the published ATS infrastructure
  factory: "0.0.6797955",
  resolver: "0.0.6797832",
};

/** Minimal ERC-3643 / ATS agent surface used by lifecycle demos. */
export const ATS_SECURITY_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function mint(address to, uint256 amount)",
  "function burn(address from, uint256 amount)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function grantKyc(address account)",
  "function revokeKyc(address account)",
  "function isKyc(address account) view returns (bool)",
  "function setAddressFrozen(address account, bool frozen)",
  "function isFrozen(address account) view returns (bool)",
  "function pause()",
  "function unpause()",
  "function paused() view returns (bool)",
] as const;
