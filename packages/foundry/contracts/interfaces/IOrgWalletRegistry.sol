// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice The read surface other contracts use to answer "which institution owns this wallet?".
interface IOrgWalletRegistry {
    /// @return orgId the institution this wallet is bound to, or bytes32(0) if unbound.
    function orgOf(address wallet) external view returns (bytes32 orgId);

    /// @return admin the address allowed to act for `orgId`, or address(0) if unregistered.
    function adminOf(bytes32 orgId) external view returns (address admin);
}
