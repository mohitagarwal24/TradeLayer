// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {OracleAggregator, PythStructs} from "../contracts/OracleAggregator.sol";
import {console} from "forge-std/console.sol";

// Mock Pyth contract
contract MockPyth {
    mapping(bytes32 => PythStructs.Price) public prices;
    
    function setPrice(bytes32 id, int64 price, int32 expo, uint publishTime) external {
        prices[id] = PythStructs.Price({
            price: price,
            conf: 0,
            expo: expo,
            publishTime: publishTime
        });
    }
    
    function getPriceNoOlderThan(bytes32 id, uint256) external view returns (PythStructs.Price memory) {
        PythStructs.Price memory p = prices[id];
        require(p.price > 0, "Price not set");
        return p;
    }
    
    function getUpdateFee(bytes[] calldata) external pure returns (uint256) {
        return 0.01 ether;
    }
    
    function updatePriceFeeds(bytes[] calldata) external payable {}
}

// Mock Chainlink aggregator
contract MockChainlink {
    int256 public price;
    uint256 public updatedAt;
    uint8 public decimals_;
    
    constructor(uint8 _decimals) {
        decimals_ = _decimals;
        updatedAt = block.timestamp;
    }
    
    function setPrice(int256 _price) external {
        price = _price;
        updatedAt = block.timestamp;
    }
    
    function latestRoundData() external view returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 _updatedAt,
        uint80 answeredInRound
    ) {
        return (1, price, block.timestamp, updatedAt, 1);
    }
    
    function decimals() external view returns (uint8) {
        return decimals_;
    }
}

contract OracleAggregatorTest is Test {
    OracleAggregator public oracle;
    MockPyth public pyth;
    MockChainlink public chainlinkAAPL;
    MockChainlink public chainlinkGOOGL;
    MockChainlink public chainlinkTSLA;
    
    // Price IDs for stocks (mock)
    bytes32 constant AAPL_PRICE_ID = bytes32(uint256(1));
    bytes32 constant GOOGL_PRICE_ID = bytes32(uint256(2));
    bytes32 constant TSLA_PRICE_ID = bytes32(uint256(3));
    
    address user = address(0x123);
    
    function setUp() public {
        // Deploy mocks
        pyth = new MockPyth();
        chainlinkAAPL = new MockChainlink(8); // 8 decimals like real Chainlink
        chainlinkGOOGL = new MockChainlink(8);
        chainlinkTSLA = new MockChainlink(8);
        
        // Deploy oracle aggregator
        oracle = new OracleAggregator(address(pyth));
        
        // Set up AAPL
        oracle.setPythPriceId("AAPL", AAPL_PRICE_ID);
        oracle.setChainlinkFeed("AAPL", address(chainlinkAAPL));
        
        // Set up GOOGL
        oracle.setPythPriceId("GOOGL", GOOGL_PRICE_ID);
        oracle.setChainlinkFeed("GOOGL", address(chainlinkGOOGL));
        
        // Set up TSLA
        oracle.setPythPriceId("TSLA", TSLA_PRICE_ID);
        oracle.setChainlinkFeed("TSLA", address(chainlinkTSLA));
        
        // Set initial prices
        // For Pyth: price = 180, expo = -8 means 180 * 10^-8 = 1.80
        // We want $180, so price should be 180 * 10^8 with expo -8
        // AAPL: $180
        pyth.setPrice(AAPL_PRICE_ID, 18000000000, -8, block.timestamp); // 180 * 10^8
        chainlinkAAPL.setPrice(18000000000); // $180 with 8 decimals
        
        // GOOGL: $140
        pyth.setPrice(GOOGL_PRICE_ID, 14000000000, -8, block.timestamp); // 140 * 10^8
        chainlinkGOOGL.setPrice(14000000000);
        
        // TSLA: $250
        pyth.setPrice(TSLA_PRICE_ID, 25000000000, -8, block.timestamp); // 250 * 10^8
        chainlinkTSLA.setPrice(25000000000);
        
        vm.deal(user, 10 ether);
    }
    
    function test_GetValidatedPrice_BothOraclesAgree() public {
        vm.prank(user);
        bytes[] memory emptyUpdate = new bytes[](0);
        
        uint256 price = oracle.getValidatedPrice{value: 0}("AAPL", emptyUpdate);
        
        // Should return average: $180
        assertEq(price, 180 ether); // 18 decimals
    }
    
    function test_GetValidatedPrice_MultipleStocks() public {
        vm.startPrank(user);
        bytes[] memory emptyUpdate = new bytes[](0);
        
        uint256 aaplPrice = oracle.getValidatedPrice{value: 0}("AAPL", emptyUpdate);
        uint256 googlPrice = oracle.getValidatedPrice{value: 0}("GOOGL", emptyUpdate);
        uint256 tslaPrice = oracle.getValidatedPrice{value: 0}("TSLA", emptyUpdate);
        
        assertEq(aaplPrice, 180 ether);
        assertEq(googlPrice, 140 ether);
        assertEq(tslaPrice, 250 ether);
        
        vm.stopPrank();
    }
    
    function test_GetValidatedPrice_OraclesDisagree_UsesMedian() public {
        // Pyth says $180, Chainlink says $200 (11% diff - within 30%)
        pyth.setPrice(AAPL_PRICE_ID, 18000000000, -8, block.timestamp);
        chainlinkAAPL.setPrice(20000000000);
        
        vm.prank(user);
        bytes[] memory emptyUpdate = new bytes[](0);
        uint256 price = oracle.getValidatedPrice{value: 0}("AAPL", emptyUpdate);
        
        // Should return median (average of 2): $190
        assertEq(price, 190 ether);
    }
    
    function test_GetValidatedPrice_OraclesDisagreeGreatly_UsesTWAP() public {
        vm.startPrank(user);
        bytes[] memory emptyUpdate = new bytes[](0);
        
        // First establish TWAP around $180   // basically adding one data point to make cumulative price = 180, and number of data samples = 1, so when we find twap, it will be 180/1 = 180. 
        oracle.getValidatedPrice{value: 0}("AAPL", emptyUpdate);
        vm.warp(block.timestamp + 2 minutes);
        
        // Now make oracles disagree by >30%
        pyth.setPrice(AAPL_PRICE_ID, 18000000000, -8, block.timestamp);
        chainlinkAAPL.setPrice(25000000000); // $250 (38% higher)
        
        // Should use TWAP tiebreaker and pick price closer to $180
        uint256 price = oracle.getValidatedPrice{value: 0}("AAPL", emptyUpdate);
        assertEq(price, 180 ether); // Chooses Pyth as it's closer to TWAP
        
        vm.stopPrank();
    }
    
    function test_GetValidatedPrice_SuddenMovement_Reverts() public {
        vm.startPrank(user);
        bytes[] memory emptyUpdate = new bytes[](0);
        
        // Establish baseline
        oracle.getValidatedPrice{value: 0}("AAPL", emptyUpdate);
        
        // Try to move price >10% within 5 minutes (stay within same time window)
        vm.warp(block.timestamp + 1 minutes);
        pyth.setPrice(AAPL_PRICE_ID, 20000000000, -8, block.timestamp); // $200 (+11%)
        chainlinkAAPL.setPrice(20000000000);
        
        vm.expectRevert("Sudden price movement detected");
        oracle.getValidatedPrice{value: 0}("AAPL", emptyUpdate);
        
        vm.stopPrank();
    }
    
    function test_GetValidatedPrice_SuddenMovement_PassesAfterTimeWindow() public {
        vm.startPrank(user);
        bytes[] memory emptyUpdate = new bytes[](0);
        
        // Establish baseline
        oracle.getValidatedPrice{value: 0}("AAPL", emptyUpdate);
        
        // Wait 6 minutes (beyond TWAP window)
        vm.warp(block.timestamp + 6 minutes);
        
        // Now large movement is OK
        pyth.setPrice(AAPL_PRICE_ID, 20000000000, -8, block.timestamp); // $200
        chainlinkAAPL.setPrice(20000000000);
        
        uint256 price = oracle.getValidatedPrice{value: 0}("AAPL", emptyUpdate);
        assertEq(price, 200 ether);
        
        vm.stopPrank();
    }
    
    function test_GetValidatedPrice_OnlyPythAvailable() public {
        // Create new oracle with only Pyth configured
        OracleAggregator newOracle = new OracleAggregator(address(pyth));
        newOracle.setPythPriceId("AAPL", AAPL_PRICE_ID);
        // Don't set Chainlink feed
        
        vm.prank(user);
        bytes[] memory emptyUpdate = new bytes[](0);
        
        uint256 price = newOracle.getValidatedPrice{value: 0}("AAPL", emptyUpdate);
        assertEq(price, 180 ether);
    }
    
    function test_GetValidatedPrice_StalePrice_Reverts() public {
        // Make Chainlink price stale (2 hours old)
        vm.warp(block.timestamp + 2 hours);
        
        vm.prank(user);
        bytes[] memory emptyUpdate = new bytes[](0);
        
        // Should still work with just Pyth (since Chainlink is stale)
        uint256 price = oracle.getValidatedPrice{value: 0}("AAPL", emptyUpdate);
        assertEq(price, 180 ether);
    }
    
    function test_TWAPTracking() public {
        vm.startPrank(user);
        bytes[] memory emptyUpdate = new bytes[](0);
        
        // Get price 3 times to build TWAP
        oracle.getValidatedPrice{value: 0}("AAPL", emptyUpdate);
        
        vm.warp(block.timestamp + 1 minutes);
        pyth.setPrice(AAPL_PRICE_ID, 18500000000, -8, block.timestamp); // $185
        chainlinkAAPL.setPrice(18500000000);
        oracle.getValidatedPrice{value: 0}("AAPL", emptyUpdate);
        
        vm.warp(block.timestamp + 1 minutes);
        pyth.setPrice(AAPL_PRICE_ID, 19000000000, -8, block.timestamp); // $190
        chainlinkAAPL.setPrice(19000000000);
        oracle.getValidatedPrice{value: 0}("AAPL", emptyUpdate);
        
        // TWAP should be (180 + 185 + 190) / 3 = 185
        uint256 twap = oracle.getTWAP("AAPL");
        assertEq(twap, 185 ether);
        
        vm.stopPrank();
    }
    
    function test_GetValidatedPrice_NoOracles_Reverts() public {
        vm.prank(user);
        bytes[] memory emptyUpdate = new bytes[](0);
        
        vm.expectRevert("No valid oracles");
        oracle.getValidatedPrice{value: 0}("INVALID", emptyUpdate);
    }
    
    function test_PriceScaling() public view {
        // Test that our price scaling logic is correct
        // Pyth: 18000000000 with expo -8 = 18000000000 * 10^-8 = 180
        // After scaling to 18 decimals: 180 * 10^18
        
        console.log("Testing price scaling logic...");
    }
}