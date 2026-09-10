// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice HIP-1215 subset of the Hedera Schedule Service system contract at 0x16b.
/// `scheduleCall` schedules a call with the *calling contract* as payer, executed once
/// consensus time reaches `expirySecond`. It does not revert on failure — it returns
/// (responseCode, address(0)) — so callers must check the response code.
/// Selectors: scheduleCall 0x6f5bfde8 · hasScheduleCapacity 0xdfb4a999 · deleteSchedule 0x72d42394
interface IHederaScheduleService {
    function scheduleCall(address to, uint256 expirySecond, uint256 gasLimit, uint64 value, bytes memory callData)
        external
        returns (int64 responseCode, address scheduleAddress);

    function hasScheduleCapacity(uint256 expirySecond, uint256 gasLimit) external view returns (bool hasCapacity);

    function deleteSchedule(address scheduleAddress) external returns (int64 responseCode);
}
