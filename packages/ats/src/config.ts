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

/** ATS v8 diamond surface used by lifecycle and role configuration scripts. */
export const ATS_SECURITY_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function mint(address to, uint256 amount)",
  "function burn(address from, uint256 amount)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function grantKyc(address account, string vcId, uint256 validFrom, uint256 validTo, address issuer) returns (bool)",
  "function revokeKyc(address account)",
  "function getKycStatusFor(address account) view returns (uint8)",
  "function setAddressFrozen(address account, bool frozen)",
  "function isFrozen(address account) view returns (bool)",
  "function grantRole(bytes32 role, address account) returns (bool)",
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function setNominalValue(uint256 nominalValue, uint8 nominalValueDecimals)",
  "function getNominalValue() view returns (uint256)",
  "function getNominalValueDecimals() view returns (uint8)",
  "function getControlListType() view returns (bool)",
  "function isInControlList(address account) view returns (bool)",
  "function addToControlList(address account) returns (bool)",
  "function pause()",
  "function unpause()",
  "function paused() view returns (bool)",
] as const;

export const ATS_ROLES = {
  AGENT: "0x9830aa071a741c08855dd42130bdb0ff50f7bdf5a4b72f12181eefded0c6542b",
  ISSUER: "0x5eeaf5602c75bf26e73b5206d0bd6ee82f621166255e5fd73cc06bc7bd84a95f",
  KYC: "0x754f499f9fdfbb089d12bdec817a6863d593d8a3ea7f546c00a5cafd20957bfc",
  FREEZE_MANAGER: "0x71ae38482e1ab1c28e767d64766d686215b490c8c1bd7dfe6b101525187c2155",
  CONTROL_LIST: "0x6ed9a91e996c6475ecdc28ecbdbe9bd1122fc62b30cdbe6da8271884b51ec74d",
  NOMINAL_VALUE: "0xebf9ab6852aef7bc1e4068a64bd360845c54d5d95d4fed9fd47c52bbe7c15b8b",
} as const;
