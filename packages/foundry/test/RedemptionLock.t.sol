// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { TradeLayer } from "../contracts/TradeLayer.sol";
import { MockAtsSecurityToken } from "../contracts/mocks/MockAtsSecurityToken.sol";
import { MockUSDC } from "../contracts/mocks/MockUSDC.sol";

contract RedemptionLockTest is Test {
    TradeLayer tradeLayer;
    MockAtsSecurityToken dstock;
    MockUSDC usdc;
    address alice = address(0xA11CE);
    address bob = address(0xB0B);

    function setUp() public {
        usdc = new MockUSDC();
        dstock = new MockAtsSecurityToken("TradeLayer Private Holdings Equity", "DSTOCK");
        tradeLayer = new TradeLayer(address(usdc), address(2), address(dstock));
        dstock.setAgent(address(tradeLayer));
        dstock.grantKyc(alice);
        dstock.grantKyc(bob);
        dstock.mint(alice, 10);
    }

    function test_redeemRequestFreezesCommittedTokens() public {
        vm.prank(alice);
        tradeLayer.redeemStock("redeem-1", "encrypted", 6);

        assertEq(tradeLayer.balanceOf(alice), 10);
        assertEq(dstock.balanceOf(alice), 4);
        assertEq(dstock.frozenAmount(alice), 6);

        vm.prank(alice);
        vm.expectRevert("insufficient unfrozen balance");
        dstock.transfer(bob, 5);
    }

    function test_cancelRedeemUnfreezesTokens() public {
        vm.prank(alice);
        tradeLayer.redeemStock("redeem-2", "encrypted", 6);

        tradeLayer.cancelRequest("redeem-2");

        assertEq(dstock.balanceOf(alice), 10);
        assertEq(dstock.frozenAmount(alice), 0);
        assertEq(tradeLayer.lockedForRedeem(alice), 0);
        assertTrue(tradeLayer.orderProcessed("redeem-2"));
    }
}
