// Minimal backend ABI for the privacy-preserving TradeLayer settlement service.
export const abi = [
  "event RequestCreated(string orderId, string encryptedOrder)",
  "event OrderSettled(string indexed orderId, address indexed user, bool isRedeem, uint256 dstockUnits, uint256 usdcAmount, bytes32 indexed executionCommitment)",
  "function requests(string) view returns (address requester, uint256 usdcBalance, uint256 tokenBalance, bool isRedeem)",
  "function orderProcessed(string) view returns (bool)",
  "function orderIdUsed(string) view returns (bool)",
  "function lockedForRedeem(address) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function fulfillRequest(string orderId, bytes result)",
  "function cancelRequest(string orderId)",
] as const;
