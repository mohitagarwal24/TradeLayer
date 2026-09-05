// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Script.sol";
import {TradeLayer} from "../contracts/TradeLayer.sol";
import {MockUSDC} from "../contracts/mocks/MockUSDC.sol";
import {MockPyth} from "../contracts/mocks/MockPyth.sol";

/// @notice Deploys TradeLayer with network-appropriate dependencies.
///
/// Localhost (anvil): deploys MockUSDC and MockPyth, seeds equity prices,
/// and funds the deployer so demos work end to end without external services.
///
/// Hedera testnet (chain 296): wires the official Circle USDC (HTS token
/// surfaced at a system address) and Pyth's on-chain contract. Prices must be
/// pushed via Hermes updates; no seeding is possible.
contract Deploy is Script {
    // Chain IDs
    uint256 constant ANVIL = 31_337;
    uint256 constant HEDERA_TESTNET = 296;

    // Hedera testnet constants
    // Circle's native USDC is an HTS token (0.0.429274). The JSON-RPC relay
    // exposes HTS tokens at padded system addresses.
    address constant HEDERA_TESTNET_USDC = 0x0000000000000000000000000000000000068C8a;
    // Same deterministic Pyth contract on mainnet and testnet
    // (hashscan 0.0.4622850 / 0.0.3042133).
    address constant HEDERA_TESTNET_PYTH = 0xA2aa501b19aff244D90cc15a4Cf739D2725B5729;

    // Pyth equity feed IDs are chain-agnostic.
    bytes32 constant AAPL_ID = 0x49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688;
    bytes32 constant GOOGL_ID = 0x5a48c03e9b9cb337801073ed9d166817473697efff0d138874e0f6a33d6d5aa6;
    bytes32 constant TSLA_ID = 0x16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1;
    bytes32 constant MSFT_ID = 0xd0ca23c1cc005e004ccf1db5bf76aeb6a49218f43dac3d4b275e92de12ded4d1;

    function run() external {
        uint256 deployerKey = vm.envOr("PRIVATE_KEY", uint256(0));
        uint256 chainId = block.chainid;

        // Local chains can use anvil's well-known dev account when no key is
        // configured; live networks must provide one.
        if (deployerKey == 0) {
            require(
                chainId == ANVIL,
                "Set PRIVATE_KEY in packages/foundry/.env (use `yarn generate` before deploying off-chain)"
            );
            deployerKey = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
        }
        address deployer = vm.addr(deployerKey);

        console.log("==============================================");
        console.log("Network chain id:", chainId);
        console.log("Deployer:", deployer);

        address usdcAddress;
        address pythAddress;

        if (chainId == ANVIL) {
            vm.startBroadcast(deployerKey);

            MockUSDC usdc = new MockUSDC();
            MockPyth pyth = new MockPyth();
            TradeLayer tradeLayer = new TradeLayer(address(usdc), address(pyth));

            _seedPrices(address(pyth));

            // Fund the deployer for demo trades (10k USDC).
            usdc.mint(deployer, 10_000e6);
            usdc.transfer(address(tradeLayer), 500_000e6);

            vm.stopBroadcast();

            usdcAddress = address(usdc);
            pythAddress = address(pyth);

            console.log("MockUSDC:", usdcAddress);
            console.log("MockPyth:", pythAddress);
            console.log("TradeLayer:", address(tradeLayer));
            console.log("Seeded AAPL/GOOGL/TSLA/MSFT prices; funded demo liquidity.");
        } else if (chainId == HEDERA_TESTNET) {
            usdcAddress = HEDERA_TESTNET_USDC;
            pythAddress = HEDERA_TESTNET_PYTH;

            vm.startBroadcast(deployerKey);
            TradeLayer tradeLayer = new TradeLayer(usdcAddress, pythAddress);
            vm.stopBroadcast();

            console.log("USDC (HTS 0.0.429274):", usdcAddress);
            console.log("Pyth:", pythAddress);
            console.log("TradeLayer:", address(tradeLayer));
            console.log("Next: forge verify-contract --chain-id 296 --verifier sourcify");
        } else {
            revert(string(abi.encodePacked("Unsupported chain id: ", vm.toString(chainId))));
        }

        console.log("==============================================");
    }

    function _seedPrices(address pyth) internal {
        // int64 price / expo pairs => scaled to 18-decimal USD by TradeLayer.
        MockPyth(pyth).setPrice(AAPL_ID, 23010, -2); // $230.10
        MockPyth(pyth).setPrice(GOOGL_ID, 17540, -2); // $175.40
        MockPyth(pyth).setPrice(TSLA_ID, 24875, -2); // $248.75
        MockPyth(pyth).setPrice(MSFT_ID, 41520, -2); // $415.20
    }
}
