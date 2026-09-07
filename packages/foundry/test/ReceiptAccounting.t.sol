// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { TradeLayer } from "../contracts/TradeLayer.sol";
import { MockAtsSecurityToken } from "../contracts/mocks/MockAtsSecurityToken.sol";
import { MockUSDC } from "../contracts/mocks/MockUSDC.sol";

contract ReceiptAccountingTest is Test {
    TradeLayer tradeLayer;
    MockAtsSecurityToken dstock;
    MockUSDC usdc;
    address alice = address(0xA11CE);

    function setUp() public {
        usdc = new MockUSDC();
        dstock = new MockAtsSecurityToken("TradeLayer Private Holdings Equity", "DSTOCK");
        tradeLayer = new TradeLayer(address(usdc), address(2), address(dstock));
        dstock.setAgent(address(tradeLayer));
        dstock.grantKyc(alice);
        usdc.mint(alice, 100e6);
        usdc.mint(address(tradeLayer), 50e6); // settlement reserve
        vm.prank(alice);
        usdc.approve(address(tradeLayer), type(uint256).max);
    }

    function test_buyRequiresWholeCentsAndMinDollar() public {
        vm.startPrank(alice);
        vm.expectRevert("amount below $1 minimum");
        tradeLayer.buyStock("buy-low", "enc", 999_999);

        vm.expectRevert("amount must be whole cents");
        tradeLayer.buyStock("buy-frac", "enc", 1_000_001);
        vm.stopPrank();
    }

    function test_purchaseMintsExactNetCents() public {
        vm.prank(alice);
        tradeLayer.buyStock("buy-1", "enc", 5e6); // $5.00

        TradeLayer.Result memory result = TradeLayer.Result({
            dstockUnits: 500, // $5.00 → 500 cents
            amountToRefund: 0,
            executionCommitment: keccak256("buy-1")
        });
        tradeLayer.fulfillRequest("buy-1", abi.encode(result));

        assertEq(tradeLayer.balanceOf(alice), 500);
        assertEq(usdc.balanceOf(alice), 95e6);
    }

    function test_purchaseRefundReducesMintedUnits() public {
        vm.prank(alice);
        tradeLayer.buyStock("buy-2", "enc", 5e6);

        // Spend $4.50, refund $0.50 → mint 450 units
        TradeLayer.Result memory result =
            TradeLayer.Result({ dstockUnits: 450, amountToRefund: 500_000, executionCommitment: keccak256("buy-2") });
        tradeLayer.fulfillRequest("buy-2", abi.encode(result));

        assertEq(tradeLayer.balanceOf(alice), 450);
        assertEq(usdc.balanceOf(alice), 95e6 + 500_000);
    }

    function test_purchaseRejectsMismatchedUnits() public {
        vm.prank(alice);
        tradeLayer.buyStock("buy-3", "enc", 5e6);

        TradeLayer.Result memory result =
            TradeLayer.Result({ dstockUnits: 499, amountToRefund: 0, executionCommitment: keccak256("buy-3") });
        vm.expectRevert("units must equal net cents");
        tradeLayer.fulfillRequest("buy-3", abi.encode(result));
    }

    function test_redeemBurnsExactFrozenUnits() public {
        dstock.mint(alice, 500);
        vm.prank(alice);
        tradeLayer.redeemStock("redeem-1", "enc", 200);

        TradeLayer.Result memory result =
            TradeLayer.Result({ dstockUnits: 200, amountToRefund: 2e6, executionCommitment: keccak256("redeem-1") });
        tradeLayer.fulfillRequest("redeem-1", abi.encode(result));

        assertEq(tradeLayer.balanceOf(alice), 300);
        assertEq(usdc.balanceOf(alice), 102e6);
    }
}
