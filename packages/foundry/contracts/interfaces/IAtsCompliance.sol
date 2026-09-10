// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice The compliance surface of an ATS equity diamond — KYC registry, control list and
/// freeze. Deliberately separate from `IAtsSecurityToken`, which stays a pure value interface:
/// the vault moves shares, `ComplianceRouter` decides who is allowed to hold them.
///
/// Signatures mirror ATS v8 (`facets/kyc/IKyc.sol`, `facets/controlList`, `facets/freeze`).
/// Two behaviours callers must respect:
///  - `grantKyc` reverts unless the **`issuer` argument** is registered as an SSI issuer on the
///    diamond. It is the argument that is checked, not `msg.sender`.
///  - Re-granting KYC, or re-listing an already-listed account, reverts. Check first.
interface IAtsCompliance {
    /// @dev 0 = NOT_GRANTED, 1 = GRANTED.
    function getKycStatusFor(address account) external view returns (uint8);
    function grantKyc(address account, string calldata vcId, uint256 validFrom, uint256 validTo, address issuer)
        external
        returns (bool);
    function revokeKyc(address account) external returns (bool);

    /// @dev True when the diamond runs an allowlist (as ours do); false for a blocklist.
    function getControlListType() external view returns (bool);
    function isInControlList(address account) external view returns (bool);
    function addToControlList(address account) external returns (bool);
    function removeFromControlList(address account) external returns (bool);

    function isFrozen(address account) external view returns (bool);
    function setAddressFrozen(address account, bool frozen) external;

    function hasRole(bytes32 role, address account) external view returns (bool);
}
