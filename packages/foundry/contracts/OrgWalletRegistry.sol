// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Ownable, Ownable2Step } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { IOrgWalletRegistry } from "./interfaces/IOrgWalletRegistry.sol";

/// @notice The single source of truth for which institution owns which wallet.
///
/// A wallet is bound to an institution only after **both sides separately consent on-chain**:
/// the wallet calls `proposeJoin` with its own key, and the institution's admin calls
/// `approveJoin`. Neither half is sufficient. That ordering is what makes it impossible for one
/// institution to claim another's wallet — it never controls that wallet's signing key — and it
/// is what `ComplianceRouter` checks before forwarding any freeze or KYC change, so an
/// institution can only ever act on people who actually work for it.
///
/// Everything here is deliberately public and unencrypted: it records *membership*, never
/// balances, limits or trades. Those live only in `ConfidentialLedger`.
contract OrgWalletRegistry is Ownable2Step, IOrgWalletRegistry {
    /// @dev Reserved for infrastructure accounts (vault, escrow). Bound by the owner at deploy
    /// time, bypassing mutual consent because there is no external counterparty to consent.
    bytes32 public constant PLATFORM = "PLATFORM";

    struct Membership {
        bytes32 orgId;
        bool proposedByWallet;
        bool approvedByAdmin;
        uint64 boundAt;
    }

    mapping(address wallet => Membership) public membershipOf;
    mapping(bytes32 orgId => address admin) public adminOf;
    /// @dev For the UI only — never used as an authorization input.
    mapping(bytes32 orgId => uint256 count) public walletCountOf;

    event OrgRegistered(bytes32 indexed orgId, address indexed admin);
    event OrgAdminTransferred(bytes32 indexed orgId, address indexed previous, address indexed next);
    event JoinProposed(bytes32 indexed orgId, address indexed wallet);
    event JoinApproved(bytes32 indexed orgId, address indexed wallet, address indexed admin);
    event MembershipRevoked(bytes32 indexed orgId, address indexed wallet, address indexed by);
    event PlatformAccountBound(address indexed account);

    error ZeroAddress();
    error ZeroOrgId();
    error OrgExists(bytes32 orgId);
    error UnknownOrg(bytes32 orgId);
    error NotOrgAdmin(bytes32 orgId, address caller);
    error AlreadyBound(address wallet, bytes32 orgId);
    error NoProposalFrom(address wallet);
    error ProposalForDifferentOrg(address wallet, bytes32 proposed, bytes32 expected);
    error ReservedOrgId();

    constructor(address initialOwner) Ownable(initialOwner) { }

    /* ---------- institutions ---------- */

    /// @notice Register an institution. Permissionless and self-serve: whoever calls this becomes
    /// its admin, and is bound to it immediately (registering is both halves of the consent —
    /// they hold the wallet's key and they are the admin).
    function registerOrg(bytes32 orgId) external {
        if (orgId == bytes32(0)) revert ZeroOrgId();
        if (orgId == PLATFORM) revert ReservedOrgId();
        if (adminOf[orgId] != address(0)) revert OrgExists(orgId);
        Membership storage m = membershipOf[msg.sender];
        if (m.orgId != bytes32(0)) revert AlreadyBound(msg.sender, m.orgId);

        adminOf[orgId] = msg.sender;
        emit OrgRegistered(orgId, msg.sender);
        _bind(msg.sender, orgId);
        emit JoinApproved(orgId, msg.sender, msg.sender);
    }

    /// @notice Hand the institution to a new admin. The successor must already be a member, so an
    /// institution can never be handed to someone who has not joined it.
    function transferOrgAdmin(bytes32 orgId, address next) external {
        _requireOrgAdmin(orgId);
        if (next == address(0)) revert ZeroAddress();
        if (membershipOf[next].orgId != orgId) revert ProposalForDifferentOrg(next, membershipOf[next].orgId, orgId);
        emit OrgAdminTransferred(orgId, msg.sender, next);
        adminOf[orgId] = next;
    }

    /* ---------- mutual-consent membership ---------- */

    /// @notice Half one: the wallet consents, proving it holds the key. Does not bind anything.
    function proposeJoin(bytes32 orgId) external {
        if (adminOf[orgId] == address(0)) revert UnknownOrg(orgId);
        Membership storage m = membershipOf[msg.sender];
        if (m.approvedByAdmin) revert AlreadyBound(msg.sender, m.orgId);
        m.orgId = orgId;
        m.proposedByWallet = true;
        emit JoinProposed(orgId, msg.sender);
    }

    /// @notice Half two: the institution consents. Only now is the wallet actually bound.
    function approveJoin(address wallet) external {
        Membership storage m = membershipOf[wallet];
        if (!m.proposedByWallet) revert NoProposalFrom(wallet);
        if (m.approvedByAdmin) revert AlreadyBound(wallet, m.orgId);
        _requireOrgAdmin(m.orgId);
        _bind(wallet, m.orgId);
        emit JoinApproved(m.orgId, wallet, msg.sender);
    }

    /// @notice Remove a wallet from the institution — someone leaving, or a mistaken approval.
    /// The admin may not remove themselves; hand the institution over first.
    function revokeMembership(address wallet) external {
        Membership storage m = membershipOf[wallet];
        bytes32 orgId = m.orgId;
        if (orgId == bytes32(0)) revert NoProposalFrom(wallet);
        _requireOrgAdmin(orgId);
        if (wallet == adminOf[orgId]) revert NotOrgAdmin(orgId, wallet);
        if (m.approvedByAdmin) walletCountOf[orgId] -= 1;
        delete membershipOf[wallet];
        emit MembershipRevoked(orgId, wallet, msg.sender);
    }

    /* ---------- platform accounts ---------- */

    /// @notice Bind an infrastructure account (vault, escrow) to the reserved PLATFORM org.
    function bindPlatformAccount(address account) external onlyOwner {
        if (account == address(0)) revert ZeroAddress();
        Membership storage m = membershipOf[account];
        if (m.orgId != bytes32(0)) revert AlreadyBound(account, m.orgId);
        m.proposedByWallet = true;
        _bind(account, PLATFORM);
        emit PlatformAccountBound(account);
    }

    /* ---------- views ---------- */

    /// @inheritdoc IOrgWalletRegistry
    function orgOf(address wallet) external view returns (bytes32) {
        Membership storage m = membershipOf[wallet];
        return m.approvedByAdmin ? m.orgId : bytes32(0);
    }

    /// @notice True when `who` is the registered admin of the institution they belong to.
    function isOrgAdmin(address who) external view returns (bool) {
        Membership storage m = membershipOf[who];
        return m.approvedByAdmin && adminOf[m.orgId] == who;
    }

    /// @notice A pending request the admin has not yet approved, for the UI's approval queue.
    function pendingJoin(address wallet) external view returns (bool pending, bytes32 orgId) {
        Membership storage m = membershipOf[wallet];
        return (m.proposedByWallet && !m.approvedByAdmin, m.orgId);
    }

    /* ---------- internal ---------- */

    function _bind(address wallet, bytes32 orgId) internal {
        Membership storage m = membershipOf[wallet];
        m.orgId = orgId;
        m.approvedByAdmin = true;
        m.boundAt = uint64(block.timestamp);
        walletCountOf[orgId] += 1;
    }

    function _requireOrgAdmin(bytes32 orgId) internal view {
        if (adminOf[orgId] == address(0)) revert UnknownOrg(orgId);
        if (adminOf[orgId] != msg.sender) revert NotOrgAdmin(orgId, msg.sender);
    }
}
