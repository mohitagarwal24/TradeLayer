// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { MockAtsSecurityToken } from "../contracts/mocks/MockAtsSecurityToken.sol";

contract AtsLifecycleTest is Test {
    MockAtsSecurityToken token;
    address alice = address(0xA11CE);
    address bob = address(0xB0B);

    function setUp() public {
        token = new MockAtsSecurityToken("TradeLayer Equity", "DSTOCK");
        token.grantKyc(alice);
        token.grantKyc(bob);
        token.mint(alice, 100);
    }

    function test_transferRequiresKyc() public {
        token.revokeKyc(bob);
        vm.prank(alice);
        vm.expectRevert("KYC required");
        token.transfer(bob, 1);
    }

    function test_freezeBlocksTransfer() public {
        token.setAddressFrozen(bob, true);
        vm.prank(alice);
        vm.expectRevert("frozen");
        token.transfer(bob, 1);
    }

    function test_compliantTransferSucceeds() public {
        vm.prank(alice);
        token.transfer(bob, 5);
        assertEq(token.balanceOf(bob), 5);
    }
}
