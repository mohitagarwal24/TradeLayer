// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { BaseTest } from "./Base.t.sol";
import { OrderEscrow } from "../contracts/OrderEscrow.sol";
import { ConfidentialLedger } from "../contracts/ConfidentialLedger.sol";
import { EnclaveAuth } from "../contracts/EnclaveAuth.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";
import { MockScheduleService } from "../contracts/mocks/MockScheduleService.sol";

/// @dev The order state machine. The money is the institution's throughout: it leaves the pool
/// when an order opens and returns to it however the order ends. An employee's wallet is never
/// touched — they get authority from the private policy, not custody.
contract OrderEscrowTest is BaseTest {
    bytes32 internal constant ORDER = bytes32("order-1");

    function test_openBuyDrawsFromTheVaultNotTheEmployee() public {
        uint256 aliceBefore = usdc.balanceOf(alice);
        uint64 expiry = _openBuy(alice, ORDER, 900e6);

        OrderEscrow.Order memory o = escrow.order(ORDER);
        assertEq(o.requester, alice);
        assertEq(o.orgId, ORG, "the order must be attributed to the institution");
        assertEq(o.amount, 900e6);
        assertEq(o.expiry, expiry);
        assertEq(uint8(o.status), uint8(OrderEscrow.Status.OPEN));

        assertEq(usdc.balanceOf(alice), aliceBefore, "the employee's wallet must be untouched");
        assertEq(usdc.balanceOf(address(escrow)), 900e6, "value should sit in the escrow");
        assertEq(vault.available(), FUNDING - 900e6);
        assertTrue(o.schedule != address(0), "a refund should have been scheduled");
    }

    function test_openBuyFromUnregisteredWalletReverts() public {
        vm.prank(outsider);
        vm.expectRevert(abi.encodeWithSelector(OrderEscrow.NotRegistered.selector, outsider));
        escrow.openBuy(ORDER, 100e6, keccak256("ct"), uint64(block.timestamp + 1 hours));
    }

    function test_openBuyRejectsBadInputs() public {
        uint64 ok = uint64(block.timestamp + 1 hours);
        vm.startPrank(alice);
        vm.expectRevert(OrderEscrow.ZeroAmount.selector);
        escrow.openBuy(ORDER, 0, keccak256("ct"), ok);

        vm.expectRevert(OrderEscrow.ZeroCommit.selector);
        escrow.openBuy(ORDER, 100e6, bytes32(0), ok);

        uint64 tooSoon = uint64(block.timestamp + 1 minutes);
        vm.expectRevert(
            abi.encodeWithSelector(
                OrderEscrow.ExpiryTooSoon.selector, tooSoon, uint64(block.timestamp) + escrow.MIN_EXPIRY_WINDOW()
            )
        );
        escrow.openBuy(ORDER, 100e6, keccak256("ct"), tooSoon);
        vm.stopPrank();

        _openBuy(alice, ORDER, 100e6);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(OrderEscrow.OrderExists.selector, ORDER));
        escrow.openBuy(ORDER, 100e6, keccak256("ct"), ok);
    }

    function test_openBuyBlockedWhenPaused() public {
        escrow.pause();
        vm.prank(alice);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        escrow.openBuy(ORDER, 100e6, keccak256("ct"), uint64(block.timestamp + 1 hours));
        escrow.unpause();
        _openBuy(alice, ORDER, 100e6);
    }

    function test_openBuyWithoutScheduleCapacityStillOpens() public {
        hss.setCapacity(false);
        _openBuy(alice, ORDER, 100e6);
        assertEq(escrow.order(ORDER).schedule, address(0), "no schedule, but the order still opens");
        assertEq(uint8(escrow.order(ORDER).status), uint8(OrderEscrow.Status.OPEN));
    }

    /* ---------- settlement ---------- */

    function test_settleIsAtomicAndReturnsEverythingToThePool() public {
        _openBuy(alice, ORDER, 900e6);
        bytes memory eBlob = abi.encodePacked("enclave-v1");
        bytes memory uBlob = abi.encodePacked("user-v1");

        _settle(ORDER, 457_460_000, eBlob, uBlob, 0);

        assertEq(uint8(escrow.order(ORDER).status), uint8(OrderEscrow.Status.SETTLED));
        assertEq(ledger.version(_accountId(alice)), 1, "the ledger write must land with the release");
        assertEq(usdc.balanceOf(address(escrow)), 0, "the escrow must be emptied");
        assertEq(usdc.balanceOf(alice), 0, "the employee never receives company cash");
        assertEq(vault.reserve(), FUNDING, "cash never left the omnibus");
        assertEq(vault.available(), FUNDING, "and it is all available again");
        assertEq(vault.committed(), 0);
    }

    function test_settleRejectsSpentAboveEscrow() public {
        _openBuy(alice, ORDER, 100e6);
        bytes memory b = abi.encodePacked("x");
        bytes memory sig = _sign(escrow, _settlementHash(ORDER, 100e6 + 1, b, b, 0));
        vm.expectRevert(abi.encodeWithSelector(OrderEscrow.SpentExceedsEscrow.selector, 100e6 + 1, 100e6));
        escrow.settle(ORDER, 100e6 + 1, b, b, 0, sig);
    }

    function test_settleRejectsWrongSignerAndReplay() public {
        _openBuy(alice, ORDER, 100e6);
        bytes memory b = abi.encodePacked("x");
        bytes32 sh = _settlementHash(ORDER, 1e6, b, b, 0);
        bytes memory rogue = _signWith(ROGUE_KEY, escrow, sh);
        bytes memory good = _sign(escrow, sh);

        vm.expectRevert(abi.encodeWithSelector(EnclaveAuth.InvalidEnclaveSignature.selector, vm.addr(ROGUE_KEY)));
        escrow.settle(ORDER, 1e6, b, b, 0, rogue);

        escrow.settle(ORDER, 1e6, b, b, 0, good);
        vm.expectRevert(abi.encodeWithSelector(OrderEscrow.OrderNotOpen.selector, ORDER, OrderEscrow.Status.SETTLED));
        escrow.settle(ORDER, 1e6, b, b, 0, good);
    }

    function test_settleRevertsIfLedgerVersionStale() public {
        _openBuy(alice, ORDER, 100e6);
        bytes memory b = abi.encodePacked("x");
        bytes memory sig = _sign(escrow, _settlementHash(ORDER, 1e6, b, b, 3));
        vm.expectRevert(abi.encodeWithSelector(ConfidentialLedger.VersionMismatch.selector, _accountId(alice), 3, 0));
        escrow.settle(ORDER, 1e6, b, b, 3, sig);
        // Nothing moved.
        assertEq(usdc.balanceOf(address(escrow)), 100e6);
        assertEq(uint8(escrow.order(ORDER).status), uint8(OrderEscrow.Status.OPEN));
    }

    /* ---------- cancel and refund ---------- */

    function test_cancelReturnsEverythingToThePool() public {
        _openBuy(alice, ORDER, 900e6);
        escrow.cancel(ORDER, _sign(escrow, _cancelHash(ORDER)));
        assertEq(uint8(escrow.order(ORDER).status), uint8(OrderEscrow.Status.CANCELLED));
        assertEq(vault.available(), FUNDING);
        assertEq(usdc.balanceOf(alice), 0);
    }

    function test_cancelRequiresEnclave() public {
        _openBuy(alice, ORDER, 100e6);
        bytes memory rogue = _signWith(ROGUE_KEY, escrow, _cancelHash(ORDER));
        vm.expectRevert(abi.encodeWithSelector(EnclaveAuth.InvalidEnclaveSignature.selector, vm.addr(ROGUE_KEY)));
        escrow.cancel(ORDER, rogue);
    }

    function test_refundOnlyAfterExpiry() public {
        uint64 expiry = _openBuy(alice, ORDER, 900e6);
        vm.expectRevert(abi.encodeWithSelector(OrderEscrow.NotExpired.selector, ORDER, expiry));
        escrow.refund(ORDER);

        vm.warp(expiry);
        escrow.refund(ORDER);
        assertEq(uint8(escrow.order(ORDER).status), uint8(OrderEscrow.Status.REFUNDED));
        assertEq(vault.available(), FUNDING, "an abandoned order returns the institution's money");
    }

    /// @dev The scheduled refund must not fire *at* expiry. Hedera executes the call in the block
    /// at that second, and the EVM timestamp it sees can still be the previous one — which makes
    /// `refund` reject its own schedule with NotExpired. This happened on testnet. Pin the buffer.
    function test_scheduledRefundFiresAfterExpiryNotAtIt() public {
        uint64 expiry = _openBuy(alice, ORDER, 900e6);
        address schedule = escrow.order(ORDER).schedule;
        assertTrue(schedule != address(0), "nothing was scheduled");

        // Exactly at expiry the escrow would still consider the order live.
        vm.warp(expiry);
        vm.expectRevert(abi.encodeWithSelector(MockScheduleService.NotDue.selector, hss.indexOf(schedule), expiry + escrow.REFUND_SCHEDULE_BUFFER()));
        hss.fireBySchedule(schedule);
        assertEq(uint8(escrow.order(ORDER).status), uint8(OrderEscrow.Status.OPEN));

        // A moment later the scheduled call lands and the institution's money comes home.
        vm.warp(expiry + escrow.REFUND_SCHEDULE_BUFFER());
        hss.fireBySchedule(schedule);
        assertEq(uint8(escrow.order(ORDER).status), uint8(OrderEscrow.Status.REFUNDED));
        assertEq(vault.available(), FUNDING, "the refund did not return to the pool");
    }

    function test_settleAndRefundAreMutuallyExclusive() public {
        uint64 expiry = _openBuy(alice, ORDER, 900e6);
        bytes memory b = abi.encodePacked("x");
        _settle(ORDER, 10e6, b, b, 0);

        vm.warp(expiry);
        vm.expectRevert(abi.encodeWithSelector(OrderEscrow.OrderNotOpen.selector, ORDER, OrderEscrow.Status.SETTLED));
        escrow.refund(ORDER);
        assertEq(vault.reserve(), FUNDING, "the order must unwind exactly once");
    }

    function test_refundCannotFollowCancel() public {
        uint64 expiry = _openBuy(alice, ORDER, 100e6);
        escrow.cancel(ORDER, _sign(escrow, _cancelHash(ORDER)));
        vm.warp(expiry);
        vm.expectRevert(abi.encodeWithSelector(OrderEscrow.OrderNotOpen.selector, ORDER, OrderEscrow.Status.CANCELLED));
        escrow.refund(ORDER);
    }

    /* ---------- bookkeeping ---------- */

    function test_openOrdersPaging() public {
        _openBuy(alice, bytes32("a"), 10e6);
        _openBuy(bob, bytes32("b"), 10e6);
        _openBuy(alice, bytes32("c"), 10e6);
        assertEq(escrow.openCount(), 3);
        assertEq(escrow.openOrders(0, 2).length, 2);
        assertEq(escrow.openOrders(2, 5).length, 1);
        assertEq(escrow.openOrders(9, 5).length, 0);
    }

    function test_ordersFromDifferentInstitutionsCoexist() public {
        // The rival institution has no money in the pool of its own, but the pool is shared —
        // isolation is enforced by the enclave's private accounting, not by the contract.
        _openBuy(alice, bytes32("a"), 10e6);
        _openBuy(rivalStaff, bytes32("r"), 10e6);
        assertEq(escrow.order(bytes32("a")).orgId, ORG);
        assertEq(escrow.order(bytes32("r")).orgId, RIVAL);
    }
}
