// Minimal ABIs for the TradeLayer contracts — hand-maintained; keep in sync with
// packages/foundry/contracts. Only the functions the relayer, intake API and UI status need.

export const ORDER_ESCROW_ABI = [
  "function settle(bytes32 orderId, uint256 spent, bytes enclaveBlob, bytes userBlob, uint64 expectedVersion, bytes sig)",
  "function cancel(bytes32 orderId, bytes sig)",
  "function refund(bytes32 orderId)",
  "function order(bytes32 orderId) view returns (tuple(address requester, bytes32 accountId, bytes32 orgId, uint256 amount, bytes32 commit, uint64 expiry, uint8 status, address schedule))",
  "function openCount() view returns (uint256)",
  "function openOrders(uint256 start, uint256 count) view returns (bytes32[])",
  "function enclaveSigner() view returns (address)",
  "function domainSeparator() view returns (bytes32)",
  "function usedDigest(bytes32) view returns (bool)",
  "event OrderOpened(bytes32 indexed orderId, address indexed requester, bytes32 indexed orgId, uint256 amount, bytes32 commit, uint64 expiry, address schedule)",
  "event OrderSettled(bytes32 indexed orderId, uint256 spent, uint256 returned, bytes32 digest)",
  "event OrderCancelled(bytes32 indexed orderId, uint256 returned, bytes32 digest)",
  "event OrderRefunded(bytes32 indexed orderId, uint256 returned)",
] as const;

export const CONFIDENTIAL_LEDGER_ABI = [
  "function update(bytes32 accountId, bytes enclaveBlob, bytes userBlob, uint64 expectedVersion, bytes sig)",
  "function setPolicy(bytes32 orgId, bytes blob, uint64 expectedVersion, bytes sig)",
  "function entry(bytes32 accountId) view returns (tuple(bytes enclaveBlob, bytes userBlob, uint64 version, bytes32 blobHash))",
  "function version(bytes32 accountId) view returns (uint64)",
  "function policy(bytes32 orgId) view returns (tuple(bytes blob, uint64 version))",
  "function enclaveSigner() view returns (address)",
  "function usedDigest(bytes32) view returns (bool)",
] as const;

export const OMNIBUS_VAULT_ABI = [
  "function mintAts(bytes32 symbol, uint256 amount, uint256 expectedSupply, bytes sig)",
  "function burnAts(bytes32 symbol, uint256 amount, uint256 expectedSupply, bytes sig)",
  "function transferAts(bytes32 symbol, address to, uint256 amount, uint256 nonce, bytes sig)",
  "function payout(bytes32 orgId, address to, uint256 amount, uint256 nonce, bytes sig)",
  "function atsSupply(bytes32 symbol) view returns (uint256)",
  "function atsToken(bytes32 symbol) view returns (address)",
  "function reserve() view returns (uint256)",
  "function available() view returns (uint256)",
  "function committed() view returns (uint256)",
  "function enclaveSigner() view returns (address)",
  "function usedDigest(bytes32) view returns (bool)",
  "event Deposited(bytes32 indexed orgId, address indexed from, uint256 amount)",
] as const;

/// The public record of which institution owns which wallet — the only thing about an account
/// that is not encrypted, and the input every compliance decision is checked against.
export const ORG_REGISTRY_ABI = [
  "function registerOrg(bytes32 orgId)",
  "function proposeJoin(bytes32 orgId)",
  "function approveJoin(address wallet)",
  "function revokeMembership(address wallet)",
  "function transferOrgAdmin(bytes32 orgId, address next)",
  "function orgOf(address wallet) view returns (bytes32)",
  "function adminOf(bytes32 orgId) view returns (address)",
  "function isOrgAdmin(address who) view returns (bool)",
  "function pendingJoin(address wallet) view returns (bool pending, bytes32 orgId)",
  "function walletCountOf(bytes32 orgId) view returns (uint256)",
  "event OrgRegistered(bytes32 indexed orgId, address indexed admin)",
  "event JoinProposed(bytes32 indexed orgId, address indexed wallet)",
  "event JoinApproved(bytes32 indexed orgId, address indexed wallet, address indexed admin)",
  "event MembershipRevoked(bytes32 indexed orgId, address indexed wallet, address indexed by)",
] as const;

export const COMPLIANCE_ROUTER_ABI = [
  "function admitMember(address wallet)",
  "function revokeMember(address wallet)",
  "function setMemberFrozen(address wallet, bool frozen)",
  "function statusOf(bytes32 symbol, address wallet) view returns (bool kyc, bool listed, bool frozen)",
  "function symbols() view returns (bytes32[])",
  "event MemberAdmitted(bytes32 indexed orgId, address indexed wallet, bytes32 indexed symbol)",
  "event MemberFrozen(bytes32 indexed orgId, address indexed wallet, bool frozen)",
] as const;

export enum OrderStatus {
  NONE = 0,
  OPEN = 1,
  SETTLED = 2,
  CANCELLED = 3,
  REFUNDED = 4,
}
