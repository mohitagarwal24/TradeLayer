// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { BaseTest } from "./Base.t.sol";
import { OmnibusVault } from "../contracts/OmnibusVault.sol";
import { EnclaveAuth } from "../contracts/EnclaveAuth.sol";
import { MockAts } from "../contracts/mocks/MockAts.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";

/// @dev The omnibus: one pooled USDC reserve, shared equities, net batch mint/burn. Nothing here
/// should ever reveal which institution owns what.
contract OmnibusVaultTest is BaseTest {
    /* ---------- treasury ---------- */

    function test_depositJoinsTheSharedPool() public {
        uint256 before = vault.reserve();
        usdc.mint(alice, 1_000e6);
        vm.startPrank(alice);
        usdc.approve(address(vault), 1_000e6);
        bytes32 orgId = vault.deposit(1_000e6);
        vm.stopPrank();

        assertEq(orgId, ORG, "deposit credited the wrong institution");
        assertEq(vault.reserve(), before + 1_000e6, "reserve did not grow");
        // The pool is undifferentiated: there is deliberately no per-org balance to read.
        assertEq(vault.available(), vault.reserve(), "nothing should be committed yet");
    }

    function test_depositFromUnregisteredWalletReverts() public {
        usdc.mint(outsider, 1_000e6);
        vm.startPrank(outsider);
        usdc.approve(address(vault), 1_000e6);
        vm.expectRevert(abi.encodeWithSelector(OmnibusVault.NotRegistered.selector, outsider));
        vault.deposit(1_000e6);
        vm.stopPrank();
    }

    function test_depositZeroReverts() public {
        vm.expectRevert(OmnibusVault.ZeroAmount.selector);
        vault.deposit(0);
    }

    /* ---------- escrow hooks ---------- */

    function test_fundEscrowOnlyEscrow() public {
        vm.expectRevert(abi.encodeWithSelector(OmnibusVault.NotEscrow.selector, address(this)));
        vault.fundEscrow(bytes32("o1"), 1e6);
    }

    function test_releaseEscrowOnlyEscrow() public {
        vm.expectRevert(abi.encodeWithSelector(OmnibusVault.NotEscrow.selector, address(this)));
        vault.releaseEscrow(bytes32("o1"), 1e6, 0);
    }

    function test_fundEscrowCannotExceedAvailable() public {
        uint256 free = vault.available();
        vm.prank(address(escrow));
        vm.expectRevert(abi.encodeWithSelector(OmnibusVault.InsufficientReserve.selector, free + 1, free));
        vault.fundEscrow(bytes32("o1"), free + 1);
    }

    function test_committedTracksInFlightValueWithoutNamingAnOrg() public {
        _openBuy(alice, bytes32("o1"), 900e6);
        assertEq(vault.committed(), 900e6, "committed should track the open order");
        assertEq(vault.reserve(), FUNDING, "reserve counts escrowed value as still under management");
        assertEq(vault.available(), FUNDING - 900e6, "available should exclude the open order");
    }

    /* ---------- equities ---------- */

    function test_mintAtsAppliesWhenSupplyMatches() public {
        bytes memory sig = _sign(vault, _mintHash(TSLA, 5, 0));
        vault.mintAts(TSLA, 5, 0, sig);
        assertEq(tsla.totalSupply(), 5);
        assertEq(tsla.balanceOf(address(vault)), 5, "the omnibus is the sole holder");
    }

    function test_mintAtsRejectsStaleSupply() public {
        vault.mintAts(TSLA, 5, 0, _sign(vault, _mintHash(TSLA, 5, 0)));
        bytes memory stale = _sign(vault, _mintHash(TSLA, 5, 0));
        vm.expectRevert(abi.encodeWithSelector(OmnibusVault.SupplyMismatch.selector, TSLA, 0, 5));
        vault.mintAts(TSLA, 5, 0, stale);
    }

    function test_mintAtsRejectsWrongSignerAndReplay() public {
        bytes memory rogue = _signWith(ROGUE_KEY, vault, _mintHash(TSLA, 5, 0));
        vm.expectRevert(abi.encodeWithSelector(EnclaveAuth.InvalidEnclaveSignature.selector, vm.addr(ROGUE_KEY)));
        vault.mintAts(TSLA, 5, 0, rogue);

        bytes memory sig = _sign(vault, _mintHash(TSLA, 5, 0));
        vault.mintAts(TSLA, 5, 0, sig);
        vault.burnAts(TSLA, 5, 5, _sign(vault, _burnHash(TSLA, 5, 5)));
        // Supply is back to 0, so the identical mint is now a pure replay.
        vm.expectRevert(
            abi.encodeWithSelector(EnclaveAuth.DigestAlreadyUsed.selector, _digest(vault, _mintHash(TSLA, 5, 0)))
        );
        vault.mintAts(TSLA, 5, 0, sig);
    }

    function test_mintAtsUnknownSymbol() public {
        bytes memory sig = _sign(vault, _mintHash(bytes32("NOPE"), 1, 0));
        vm.expectRevert(abi.encodeWithSelector(OmnibusVault.UnknownSymbol.selector, bytes32("NOPE")));
        vault.mintAts(bytes32("NOPE"), 1, 0, sig);
    }

    function test_burnAtsNetsSupplyDown() public {
        vault.mintAts(TSLA, 9, 0, _sign(vault, _mintHash(TSLA, 9, 0)));
        vault.burnAts(TSLA, 4, 9, _sign(vault, _burnHash(TSLA, 4, 9)));
        assertEq(tsla.totalSupply(), 5);
    }

    /* ---------- withdrawal to an employee ---------- */

    function test_transferAtsToAdmittedMember() public {
        router.admitMember(alice);
        vault.mintAts(TSLA, 3, 0, _sign(vault, _mintHash(TSLA, 3, 0)));
        vault.transferAts(TSLA, alice, 2, 1, _sign(vault, _transferHash(TSLA, alice, 2, 1)));
        assertEq(tsla.balanceOf(alice), 2);
        assertEq(tsla.balanceOf(address(vault)), 1);
    }

    function test_transferAtsToUnadmittedWalletBlockedByTheDiamond() public {
        vault.mintAts(TSLA, 3, 0, _sign(vault, _mintHash(TSLA, 3, 0)));
        // outsider never joined an institution, so the router never admitted them.
        bytes memory sig = _sign(vault, _transferHash(TSLA, outsider, 1, 1));
        vm.expectRevert(abi.encodeWithSelector(MockAts.NotKyc.selector, outsider));
        vault.transferAts(TSLA, outsider, 1, 1, sig);
    }

    function test_transferAtsToFrozenMemberBlocked() public {
        router.admitMember(alice);
        vault.mintAts(TSLA, 3, 0, _sign(vault, _mintHash(TSLA, 3, 0)));
        router.setMemberFrozen(alice, true);
        bytes memory sig = _sign(vault, _transferHash(TSLA, alice, 1, 1));
        vm.expectRevert(abi.encodeWithSelector(MockAts.AddressFrozen.selector, alice));
        vault.transferAts(TSLA, alice, 1, 1, sig);
    }

    function test_transferAtsNonceReplay() public {
        router.admitMember(alice);
        vault.mintAts(TSLA, 3, 0, _sign(vault, _mintHash(TSLA, 3, 0)));
        bytes memory sig = _sign(vault, _transferHash(TSLA, alice, 1, 7));
        vault.transferAts(TSLA, alice, 1, 7, sig);
        vm.expectRevert(
            abi.encodeWithSelector(EnclaveAuth.DigestAlreadyUsed.selector, _digest(vault, _transferHash(TSLA, alice, 1, 7)))
        );
        vault.transferAts(TSLA, alice, 1, 7, sig);
    }

    function test_memberToMemberTransferIsCompliant() public {
        router.admitMember(alice);
        router.admitMember(bob);
        vault.mintAts(TSLA, 3, 0, _sign(vault, _mintHash(TSLA, 3, 0)));
        vault.transferAts(TSLA, alice, 2, 1, _sign(vault, _transferHash(TSLA, alice, 2, 1)));
        vm.prank(alice);
        tsla.transfer(bob, 1);
        assertEq(tsla.balanceOf(bob), 1);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(MockAts.NotKyc.selector, outsider));
        tsla.transfer(outsider, 1);
    }

    /* ---------- payout ---------- */

    function test_payoutSendsUsdcFromThePool() public {
        uint256 before = usdc.balanceOf(alice);
        vault.payout(ORG, alice, 250e6, 1, _sign(vault, _payoutHash(ORG, alice, 250e6, 1)));
        assertEq(usdc.balanceOf(alice), before + 250e6);
        assertEq(vault.reserve(), FUNDING - 250e6);
    }

    function test_payoutCannotExceedAvailable() public {
        uint256 free = vault.available();
        bytes memory sig = _sign(vault, _payoutHash(ORG, alice, free + 1, 1));
        vm.expectRevert(abi.encodeWithSelector(OmnibusVault.InsufficientReserve.selector, free + 1, free));
        vault.payout(ORG, alice, free + 1, 1, sig);
    }

    /* ---------- pause ---------- */

    function test_pauseBlocksEnclaveOps() public {
        bytes memory sig = _sign(vault, _mintHash(TSLA, 1, 0));
        vault.pause();
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vault.mintAts(TSLA, 1, 0, sig);
        vault.unpause();
        vault.mintAts(TSLA, 1, 0, sig);
        assertEq(tsla.totalSupply(), 1);
    }
}
