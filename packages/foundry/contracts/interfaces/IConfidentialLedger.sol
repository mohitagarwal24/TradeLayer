// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IConfidentialLedger {
    /// @dev Trusted path used by OrderEscrow.settle: the escrow has already verified an
    /// enclave signature that binds keccak256(enclaveBlob) and keccak256(userBlob).
    function applyUpdate(bytes32 accountId, bytes calldata enclaveBlob, bytes calldata userBlob, uint64 expectedVersion)
        external;

    function version(bytes32 accountId) external view returns (uint64);
}
