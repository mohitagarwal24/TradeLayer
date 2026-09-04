// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Script.sol";
import {TradeLayer} from "../contracts/TradeLayer.sol";

contract DeployTradeLayerBase is Script {
    // Base Mainnet addresses
    address constant PYTH_BASE_MAINNET = 0x8250f4aF4B972684F7b336503E2D6dFeDeB1487a;
    address constant USDC_BASE_MAINNET = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913; // Official USDC on Base
    
    // // Pyth Price Feed IDs (chain-agnostic, work on all chains)
    // // From: https://pyth.network/developers/price-feed-ids
    // bytes32 constant AAPL_PRICE_ID = 0x49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688;
    // bytes32 constant GOOGL_PRICE_ID = 0x0; // TODO: Get from Pyth docs
    // bytes32 constant TSLA_PRICE_ID = 0x16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc2d61df;
    // bytes32 constant MSFT_PRICE_ID = 0x0; // TODO: Get from Pyth docs
    
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        
        console.log("========================================");
        console.log("Deploying TradeLayer to Base Mainnet");
        console.log("========================================");
        console.log("Deployer:", deployer);
        console.log("Balance:", deployer.balance / 1e18, "ETH");
        console.log("");
        
        require(deployer.balance > 0.001 ether, "Insufficient balance for deployment");
        
        vm.startBroadcast(deployerPrivateKey);
        
        // Deploy TradeLayer
        console.log("Deploying TradeLayer...");
        TradeLayer tradeLayer = new TradeLayer(
            USDC_BASE_MAINNET,
            PYTH_BASE_MAINNET
        );
        
        console.log("TradeLayer deployed at:", address(tradeLayer));
        console.log("");
        
        // Verify stock price IDs are set correctly
        console.log("Verifying stock configurations...");
        console.log("AAPL Price ID:", vm.toString(tradeLayer.stockPriceIds("AAPL")));
        console.log("TSLA Price ID:", vm.toString(tradeLayer.stockPriceIds("TSLA")));
        
        vm.stopBroadcast();
        
        // Print deployment summary
        console.log("");
        console.log("========================================");
        console.log("Deployment Summary");
        console.log("========================================");
        console.log("Network: Base Mainnet");
        console.log("TradeLayer:", address(tradeLayer));
        console.log("Backend Wallet:", deployer);
        console.log("USDC:", USDC_BASE_MAINNET);
        console.log("Pyth Oracle:", PYTH_BASE_MAINNET);
        console.log("");
        console.log("Supported Stocks:");
        console.log("- AAPL (Apple)");
        console.log("- TSLA (Tesla)");
        console.log("- GOOGL (Google) - TODO: Add price ID");
        console.log("- MSFT (Microsoft) - TODO: Add price ID");
        console.log("");
        
        // Print next steps
        console.log("========================================");
        console.log("Next Steps");
        console.log("========================================");
        console.log("1. Verify contract on BaseScan:");
        console.log("   forge verify-contract", vm.toString(address(tradeLayer)));
        console.log("   --chain-id 8453 --watch");
        console.log("");
        console.log("2. Test price feeds:");
        console.log("   forge script script/TestPriceFeeds.s.sol --rpc-url base");
        console.log("");
        console.log("3. Update frontend with contract address");
        console.log("========================================");
    }
}