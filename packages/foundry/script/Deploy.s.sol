// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Script.sol";
import {TradeLayer} from "../contracts/TradeLayer.sol";
import {MockUSDC} from "../contracts/mocks/MockUSDC.sol";
import {MockPyth} from "../contracts/mocks/MockPyth.sol";
import {MockAtsSecurityToken} from "../contracts/mocks/MockAtsSecurityToken.sol";

/// @notice Deploys TradeLayer with network-appropriate dependencies.
///
/// Localhost (anvil): deploys local USDC, Pyth stand-in, and MockAtsSecurityToken
/// (ERC-3643-style KYC equity), seeds live Hermes prices, funds demo liquidity.
///
/// Hedera testnet (chain 296): wires Circle HTS USDC, on-chain Pyth, and an
/// ATS-issued DSTOCK address from env `ATS_DSTOCK` (EVM address of the equity
/// diamond created via Asset Tokenization Studio).
contract Deploy is Script {
    uint256 constant ANVIL = 31_337;
    uint256 constant HEDERA_TESTNET = 296;

    address constant HEDERA_TESTNET_USDC = 0x0000000000000000000000000000000000068cDa;
    address constant HEDERA_TESTNET_PYTH = 0xA2aa501b19aff244D90cc15a4Cf739D2725B5729;

    bytes32 constant TSLA_ID = 0x16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1;
    bytes32 constant VOO_ID = 0x236b30dd09a9c00dfeec156c7b1efd646c0f01825a1758e3e4a0679e3bdff179;
    bytes32 constant QQQ_ID = 0x9695e2b96ea7b3859da9ed25b7a46a920a776e2fdae19a7bcfdf2b219230452d;

    function run() external {
        uint256 deployerKey = vm.envOr("PRIVATE_KEY", uint256(0));
        uint256 chainId = block.chainid;

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

        if (chainId == ANVIL) {
            vm.startBroadcast(deployerKey);

            MockUSDC usdc = new MockUSDC();
            MockPyth pyth = new MockPyth();
            MockAtsSecurityToken dstock = new MockAtsSecurityToken("TradeLayer Equity", "DSTOCK");
            TradeLayer tradeLayer = new TradeLayer(address(usdc), address(pyth), address(dstock));

            // TradeLayer must be the ATS agent to mint/burn on settlement.
            dstock.setAgent(address(tradeLayer));
            // KYC the deployer so demo secondary transfers work after mint.
            dstock.grantKyc(deployer);

            _seedLivePrices(address(pyth));

            usdc.mint(deployer, 10_000e6);
            usdc.transfer(address(tradeLayer), 500_000e6);

            vm.stopBroadcast();

            console.log("LocalUSDC:", address(usdc));
            console.log("LocalPyth:", address(pyth));
            console.log("DSTOCK (Mock ATS):", address(dstock));
            console.log("TradeLayer:", address(tradeLayer));
            console.log("Seeded TSLA/VOO/QQQ mock prices; TradeLayer is ATS agent.");
        } else if (chainId == HEDERA_TESTNET) {
            address atsDstock = vm.envAddress("ATS_DSTOCK");
            require(atsDstock != address(0), "Set ATS_DSTOCK to the ATS equity EVM address");

            vm.startBroadcast(deployerKey);
            TradeLayer tradeLayer = new TradeLayer(HEDERA_TESTNET_USDC, HEDERA_TESTNET_PYTH, atsDstock);
            vm.stopBroadcast();

            console.log("USDC (HTS 0.0.429274):", HEDERA_TESTNET_USDC);
            console.log("Pyth:", HEDERA_TESTNET_PYTH);
            console.log("DSTOCK (ATS):", atsDstock);
            console.log("TradeLayer:", address(tradeLayer));
            console.log("Next: grant TradeLayer the ATS Minter/Agent role, then verify on Sourcify.");
        } else {
            revert(string(abi.encodePacked("Unsupported chain id: ", vm.toString(chainId))));
        }

        console.log("==============================================");
    }

    /// @dev Seed deterministic local prices (expo -5). Hermes now requires an API key.
    function _seedLivePrices(address pyth) internal {
        MockPyth(pyth).setPrice(TSLA_ID, 346_237_50, -5); // ~$346.24
        MockPyth(pyth).setPrice(VOO_ID, 706_390_00, -5); // ~$706.39
        MockPyth(pyth).setPrice(QQQ_ID, 716_040_00, -5); // ~$716.04
    }
}
