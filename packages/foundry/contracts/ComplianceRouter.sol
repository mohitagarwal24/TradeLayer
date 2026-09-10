// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Ownable, Ownable2Step } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { IAtsCompliance } from "./interfaces/IAtsCompliance.sol";
import { IOrgWalletRegistry } from "./interfaces/IOrgWalletRegistry.sol";

/// @notice The only path to KYC and freeze on the equity tokens.
///
/// This contract — not any institution's admin — holds `KYC`, `CONTROL_LIST` and
/// `FREEZE_MANAGER` on the ATS diamonds. An admin asks it to admit or suspend a wallet, and it
/// refuses unless the registry says that wallet actually belongs to the caller's institution.
/// That turns "institution B freezes institution A's employee" from something support has to
/// catch into something the contract makes impossible.
///
/// Nothing here touches the settlement leg. USDC is Circle's token; we hold no keys over it, and
/// who may trade is decided by `OrgWalletRegistry` plus the enclave's private policy checks —
/// never by holding or lacking a token of ours.
contract ComplianceRouter is Ownable2Step {
    IOrgWalletRegistry public immutable registry;

    /// @dev Passed as the `issuer` argument to `grantKyc`, which reverts unless that address is
    /// registered as an SSI issuer on the diamond. It is not the caller — this contract is.
    address public atsIssuer;
    uint64 public kycValidity = 365 days;

    mapping(bytes32 symbol => IAtsCompliance) public tokenOf;
    bytes32[] private _symbols;

    event AtsIssuerUpdated(address indexed previous, address indexed next);
    event KycValidityUpdated(uint64 seconds_);
    event TokenRegistered(bytes32 indexed symbol, address indexed token);
    event MemberAdmitted(bytes32 indexed orgId, address indexed wallet, bytes32 indexed symbol);
    event MemberRevoked(bytes32 indexed orgId, address indexed wallet, bytes32 indexed symbol);
    event MemberFrozen(bytes32 indexed orgId, address indexed wallet, bool frozen);
    event EmergencyFreeze(address indexed wallet, address indexed by, string justification);

    error ZeroAddress();
    error UnknownSymbol(bytes32 symbol);
    error AlreadyRegistered(bytes32 symbol);
    error NotOrgAdmin(address caller);
    error NotYourWallet(address wallet, bytes32 walletOrg, bytes32 callerOrg);
    error NoTokensRegistered();

    constructor(address initialOwner, IOrgWalletRegistry registry_, address issuer) Ownable(initialOwner) {
        if (address(registry_) == address(0) || issuer == address(0)) revert ZeroAddress();
        registry = registry_;
        atsIssuer = issuer;
        emit AtsIssuerUpdated(address(0), issuer);
    }

    /* ---------- platform admin ---------- */

    function setAtsIssuer(address next) external onlyOwner {
        if (next == address(0)) revert ZeroAddress();
        emit AtsIssuerUpdated(atsIssuer, next);
        atsIssuer = next;
    }

    function setKycValidity(uint64 seconds_) external onlyOwner {
        kycValidity = seconds_;
        emit KycValidityUpdated(seconds_);
    }

    /// @notice Register an equity diamond. The issuer must separately grant this contract
    /// `KYC`, `CONTROL_LIST` and `FREEZE_MANAGER` on it (see packages/ats grant-router-roles).
    function registerToken(bytes32 symbol, IAtsCompliance token) external onlyOwner {
        if (address(token) == address(0)) revert ZeroAddress();
        if (address(tokenOf[symbol]) != address(0)) revert AlreadyRegistered(symbol);
        tokenOf[symbol] = token;
        _symbols.push(symbol);
        emit TokenRegistered(symbol, address(token));
    }

    /* ---------- institution admin ---------- */

    /// @notice Admit one of your own people to every registered equity, so they can take
    /// delivery of shares. Idempotent: already-granted KYC and existing list entries are skipped
    /// rather than reverting, because the diamond rejects a repeat of either.
    function admitMember(address wallet) external {
        bytes32 orgId = _requireOwnWallet(wallet);
        uint256 n = _symbols.length;
        if (n == 0) revert NoTokensRegistered();
        for (uint256 i = 0; i < n; i++) {
            bytes32 symbol = _symbols[i];
            IAtsCompliance token = tokenOf[symbol];
            if (token.getKycStatusFor(wallet) != 1) {
                token.grantKyc(wallet, "tradelayer", block.timestamp, block.timestamp + kycValidity, atsIssuer);
            }
            if (token.getControlListType() && !token.isInControlList(wallet)) {
                token.addToControlList(wallet);
            }
            emit MemberAdmitted(orgId, wallet, symbol);
        }
    }

    /// @notice Withdraw a member's ability to hold shares — someone leaving the institution.
    function revokeMember(address wallet) external {
        bytes32 orgId = _requireOwnWallet(wallet);
        uint256 n = _symbols.length;
        for (uint256 i = 0; i < n; i++) {
            bytes32 symbol = _symbols[i];
            IAtsCompliance token = tokenOf[symbol];
            if (token.getKycStatusFor(wallet) == 1) token.revokeKyc(wallet);
            if (token.getControlListType() && token.isInControlList(wallet)) token.removeFromControlList(wallet);
            emit MemberRevoked(orgId, wallet, symbol);
        }
    }

    /// @notice Freeze or unfreeze one of your own people across every registered equity — the
    /// instant incident response an institution needs, enforced by the token itself.
    function setMemberFrozen(address wallet, bool frozen) external {
        bytes32 orgId = _requireOwnWallet(wallet);
        uint256 n = _symbols.length;
        for (uint256 i = 0; i < n; i++) {
            IAtsCompliance token = tokenOf[_symbols[i]];
            if (token.isFrozen(wallet) != frozen) token.setAddressFrozen(wallet, frozen);
        }
        emit MemberFrozen(orgId, wallet, frozen);
    }

    /* ---------- platform emergency ---------- */

    /// @notice Deliberately separate from the normal path and distinctly logged: sanctions, court
    /// orders. Bypasses the ownership check precisely because those cases are not the
    /// institution's call.
    function emergencyFreeze(address wallet, string calldata justification) external onlyOwner {
        uint256 n = _symbols.length;
        for (uint256 i = 0; i < n; i++) {
            IAtsCompliance token = tokenOf[_symbols[i]];
            if (!token.isFrozen(wallet)) token.setAddressFrozen(wallet, true);
        }
        emit EmergencyFreeze(wallet, msg.sender, justification);
    }

    /* ---------- views ---------- */

    function symbols() external view returns (bytes32[] memory) {
        return _symbols;
    }

    function symbolCount() external view returns (uint256) {
        return _symbols.length;
    }

    /// @notice Compliance status of a wallet on one equity, for the admin UI.
    function statusOf(bytes32 symbol, address wallet)
        external
        view
        returns (bool kyc, bool listed, bool frozen)
    {
        IAtsCompliance token = tokenOf[symbol];
        if (address(token) == address(0)) revert UnknownSymbol(symbol);
        return (token.getKycStatusFor(wallet) == 1, token.isInControlList(wallet), token.isFrozen(wallet));
    }

    /* ---------- internal ---------- */

    /// @dev The whole point of this contract: the caller must be an institution's admin, and the
    /// target must be a wallet that institution actually owns per the registry.
    function _requireOwnWallet(address wallet) internal view returns (bytes32 orgId) {
        bytes32 callerOrg = registry.orgOf(msg.sender);
        if (callerOrg == bytes32(0) || registry.adminOf(callerOrg) != msg.sender) revert NotOrgAdmin(msg.sender);
        orgId = registry.orgOf(wallet);
        if (orgId != callerOrg) revert NotYourWallet(wallet, orgId, callerOrg);
    }
}
