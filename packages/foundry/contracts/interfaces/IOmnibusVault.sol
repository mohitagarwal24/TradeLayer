// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice The hooks OrderEscrow calls on the omnibus vault.
///
/// The employee never holds company cash: the vault funds the escrow out of the shared pool when
/// an order opens, and the escrow hands it straight back when the order terminates. `spent` is
/// reported for the reserve check but the USDC never leaves the vault's custody chain.
interface IOmnibusVault {
    /// @dev Move `amount` USDC from the pool into the escrow for a newly opened order.
    function fundEscrow(bytes32 orderId, uint256 amount) external;

    /// @dev Called after the escrow has transferred `amount` back. `spent` is the portion that
    /// bought shares; the remainder simply rejoins the available pool.
    function releaseEscrow(bytes32 orderId, uint256 amount, uint256 spent) external;
}
