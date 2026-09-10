// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { IAtsSecurityToken } from "../interfaces/IAtsSecurityToken.sol";
import { IAtsCompliance } from "../interfaces/IAtsCompliance.sol";

/// @notice Local stand-in for an ATS equity diamond, kept faithful to the real one's semantics so
/// tests fail where testnet would:
///  - `balanceOf` is the full balance; compliance gates transfers rather than adjusting arithmetic.
///  - Whitelist control list: mint and transfer require the counterparty KYC'd *and* listed.
///  - Compliance is **role-gated**, not owner-gated — ComplianceRouter holds the roles, and the
///    role hashes below are the real ATS ones.
///  - `grantKyc` validates the `issuer` **argument** against a registered SSI issuer list, which
///    is the constraint most likely to be missed when wiring a new deployment.
///  - Re-granting KYC or re-listing an account reverts, as upstream does.
/// Never deploy for real.
contract MockAts is ERC20, IAtsSecurityToken, IAtsCompliance {
    bytes32 public constant AGENT_ROLE = 0x9830aa071a741c08855dd42130bdb0ff50f7bdf5a4b72f12181eefded0c6542b;
    bytes32 public constant KYC_ROLE = 0x754f499f9fdfbb089d12bdec817a6863d593d8a3ea7f546c00a5cafd20957bfc;
    bytes32 public constant CONTROL_LIST_ROLE = 0x6ed9a91e996c6475ecdc28ecbdbe9bd1122fc62b30cdbe6da8271884b51ec74d;
    bytes32 public constant FREEZE_MANAGER_ROLE = 0x71ae38482e1ab1c28e767d64766d686215b490c8c1bd7dfe6b101525187c2155;

    address public immutable owner;
    uint8 private immutable _decimals;
    bool public paused;
    /// @dev Whitelist mode, as `issueEquity.ts` configures on testnet.
    bool public whitelist = true;

    mapping(bytes32 role => mapping(address account => bool)) private _roles;
    mapping(address account => bool) public isIssuer;
    mapping(address account => bool) public kyc;
    mapping(address account => bool) public listed;
    mapping(address account => bool) public frozen;

    error NotOwner();
    error MissingRole(bytes32 role, address account);
    error Paused();
    error NotKyc(address account);
    error NotInControlList(address account);
    error AddressFrozen(address account);
    error AccountIsNotIssuer(address issuer);
    error KycAlreadyGranted(address account);
    error ListedAccount(address account);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyRole(bytes32 role) {
        if (!_roles[role][msg.sender] && msg.sender != owner) revert MissingRole(role, msg.sender);
        _;
    }

    constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) {
        owner = msg.sender;
        _decimals = decimals_;
        kyc[msg.sender] = true;
        listed[msg.sender] = true;
        isIssuer[msg.sender] = true;
    }

    /* ---------- issuer administration ---------- */

    function grantRole(bytes32 role, address account) external onlyOwner returns (bool) {
        _roles[role][account] = true;
        return true;
    }

    function revokeRole(bytes32 role, address account) external onlyOwner returns (bool) {
        _roles[role][account] = false;
        return true;
    }

    function hasRole(bytes32 role, address account) external view returns (bool) {
        return _roles[role][account];
    }

    /// @dev Mirrors ATS `SsiManagement.addIssuer`. Only a registered issuer may be named as the
    /// `issuer` argument of `grantKyc`.
    function addIssuer(address account) external onlyOwner {
        isIssuer[account] = true;
    }

    function setWhitelistMode(bool value) external onlyOwner {
        whitelist = value;
    }

    function setPaused(bool value) external onlyOwner {
        paused = value;
    }

    /* ---------- IAtsCompliance ---------- */

    function getKycStatusFor(address account) external view returns (uint8) {
        return kyc[account] ? 1 : 0;
    }

    function grantKyc(address account, string calldata, uint256, uint256, address issuer)
        external
        onlyRole(KYC_ROLE)
        returns (bool)
    {
        if (!isIssuer[issuer]) revert AccountIsNotIssuer(issuer);
        if (kyc[account]) revert KycAlreadyGranted(account);
        kyc[account] = true;
        return true;
    }

    function revokeKyc(address account) external onlyRole(KYC_ROLE) returns (bool) {
        kyc[account] = false;
        return true;
    }

    function getControlListType() external view returns (bool) {
        return whitelist;
    }

    function isInControlList(address account) external view returns (bool) {
        return listed[account];
    }

    function addToControlList(address account) external onlyRole(CONTROL_LIST_ROLE) returns (bool) {
        if (listed[account]) revert ListedAccount(account);
        listed[account] = true;
        return true;
    }

    function removeFromControlList(address account) external onlyRole(CONTROL_LIST_ROLE) returns (bool) {
        listed[account] = false;
        return true;
    }

    function isFrozen(address account) external view returns (bool) {
        return frozen[account];
    }

    /// @dev Upstream accepts FREEZE_MANAGER **or** AGENT here.
    function setAddressFrozen(address account, bool value) external {
        if (
            !_roles[FREEZE_MANAGER_ROLE][msg.sender] && !_roles[AGENT_ROLE][msg.sender] && msg.sender != owner
        ) revert MissingRole(FREEZE_MANAGER_ROLE, msg.sender);
        frozen[account] = value;
    }

    /* ---------- agent operations ---------- */

    function mint(address to, uint256 amount) external onlyRole(AGENT_ROLE) {
        _requireEligible(to);
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external onlyRole(AGENT_ROLE) {
        if (frozen[from]) revert AddressFrozen(from);
        _burn(from, amount);
    }

    /* ---------- ERC-20 with compliance gates ---------- */

    function decimals() public view override(ERC20, IERC20Metadata) returns (uint8) {
        return _decimals;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (paused) revert Paused();
        if (from != address(0)) {
            if (frozen[from]) revert AddressFrozen(from);
            if (!kyc[from]) revert NotKyc(from);
        }
        if (to != address(0)) _requireEligible(to);
        super._update(from, to, value);
    }

    function _requireEligible(address account) internal view {
        if (frozen[account]) revert AddressFrozen(account);
        if (!kyc[account]) revert NotKyc(account);
        if (whitelist && !listed[account]) revert NotInControlList(account);
    }
}
