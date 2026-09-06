// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {TradeLayer} from "../contracts/TradeLayer.sol";
import {MockAtsSecurityToken} from "../contracts/mocks/MockAtsSecurityToken.sol";
import {Test} from "forge-std/Test.sol";
import {console} from "forge-std/console.sol";

contract BaseTest is Test {
    TradeLayer trader;
    MockAtsSecurityToken dstock;

    function setUp() external {
        dstock = new MockAtsSecurityToken("TradeLayer Equity", "DSTOCK");
        trader = new TradeLayer(address(1), address(2), address(dstock));
        dstock.setAgent(address(trader));
    }

    function testHealth() public {
        console.log(address(trader));
        console.log(address(dstock));
    }
}
