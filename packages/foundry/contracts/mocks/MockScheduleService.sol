// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Anvil stand-in for the Hedera Schedule Service (HIP-1215) at 0x16b. Records
/// scheduled calls; tests and the local demo `fire()` them once the expiry has passed, which is
/// what the network does on its own on testnet.
contract MockScheduleService {
    struct Scheduled {
        address to;
        uint256 expirySecond;
        uint256 gasLimit;
        bytes callData;
        bool executed;
    }

    Scheduled[] private _schedules;
    bool public capacity = true;

    event Scheduled_(uint256 indexed index, address indexed to, uint256 expirySecond);
    event Fired(uint256 indexed index, bool success);

    error NotDue(uint256 index, uint256 expirySecond);
    error AlreadyExecuted(uint256 index);

    function setCapacity(bool value) external {
        capacity = value;
    }

    function hasScheduleCapacity(uint256, uint256) external view returns (bool) {
        return capacity;
    }

    function scheduleCall(address to, uint256 expirySecond, uint256 gasLimit, uint64, bytes memory callData)
        external
        returns (int64, address)
    {
        _schedules.push(Scheduled(to, expirySecond, gasLimit, callData, false));
        uint256 index = _schedules.length;
        emit Scheduled_(index - 1, to, expirySecond);
        // Fake schedule address: non-zero and unique per schedule.
        return (22, address(uint160(0x5c4ed000 + index)));
    }

    function deleteSchedule(address) external pure returns (int64) {
        return 22;
    }

    /// @notice Execute schedule `index`. Reverts if not yet due.
    function fire(uint256 index) external returns (bool success) {
        Scheduled storage s = _schedules[index];
        if (s.executed) revert AlreadyExecuted(index);
        if (block.timestamp < s.expirySecond) revert NotDue(index, s.expirySecond);
        s.executed = true;
        (success,) = s.to.call{ gas: s.gasLimit }(s.callData);
        emit Fired(index, success);
    }

    /// @notice Execute the schedule the contract was handed at open time. Callers hold the
    /// address `scheduleCall` returned, not the array index, so resolve one to the other here
    /// rather than making every test decode the fake address.
    function fireBySchedule(address schedule) external returns (bool) {
        return this.fire(indexOf(schedule));
    }

    function indexOf(address schedule) public pure returns (uint256) {
        return uint256(uint160(schedule)) - 0x5c4ed000 - 1;
    }

    function count() external view returns (uint256) {
        return _schedules.length;
    }

    function get(uint256 index) external view returns (Scheduled memory) {
        return _schedules[index];
    }
}
