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

    bytes32 constant AAPL_ID = 0x49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688;
    bytes32 constant GOOGL_ID = 0x5a48c03e9b9cb337801073ed9d166817473697efff0d138874e0f6a33d6d5aa6;
    bytes32 constant TSLA_ID = 0x16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1;
    bytes32 constant MSFT_ID = 0xd0ca23c1cc005e004ccf1db5bf76aeb6a49218f43dac3d4b275e92de12ded4d1;

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
            console.log("Seeded live prices from Hermes; TradeLayer is ATS agent.");
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

    function _seedLivePrices(address pyth) internal {
        string[] memory cmds = new string[](3);
        cmds[0] = "bash";
        cmds[1] = "-c";
        cmds[2] =
            'curl -s "https://hermes.pyth.network/v2/updates/price/latest?ids%5B%5D=0x49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688&ids%5B%5D=0x5a48c03e9b9cb337801073ed9d166817473697efff0d138874e0f6a33d6d5aa6&ids%5B%5D=0x16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1&ids%5B%5D=0xd0ca23c1cc005e004ccf1db5bf76aeb6a49218f43dac3d4b275e92de12ded4d1"'
            ' | node -e \'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);(j.parsed||[]).forEach(p=>console.log(p.id+" "+p.price.price))})\'';

        string[] memory lines = _split(string(vm.ffi(cmds)), "\n");
        _applyLine(lines[0], AAPL_ID, pyth);
        _applyLine(lines[1], GOOGL_ID, pyth);
        _applyLine(lines[2], TSLA_ID, pyth);
        _applyLine(lines[3], MSFT_ID, pyth);
    }

    function _applyLine(string memory line, bytes32 expectedId, address pyth) internal {
        bytes memory b = bytes(line);
        if (b.length < 66) revert("Deploy: bad hermes line");
        bytes32 gotId = vm.parseBytes32(string.concat("0x", string(_slice(b, 0, 64))));
        require(gotId == expectedId, "Deploy: unexpected feed order");
        int64 rawPrice = int64(int256(vm.parseUint(string(_slice(b, 65, b.length - 65)))));
        MockPyth(pyth).setPrice(expectedId, rawPrice, -5);
    }

    function _slice(bytes memory data, uint256 start, uint256 len) internal pure returns (bytes memory part) {
        part = new bytes(len);
        for (uint256 i = 0; i < len && start + i < data.length; i++) {
            part[i] = data[start + i];
        }
    }

    function _split(string memory input, string memory sep) internal pure returns (string[] memory parts) {
        bytes memory src = bytes(input);
        bytes memory token = bytes(sep);
        uint256 count = 1;
        for (uint256 i = 0; i + token.length <= src.length; i++) {
            bool hit = true;
            for (uint256 j = 0; j < token.length; j++) {
                if (src[i + j] != token[j]) hit = false;
            }
            if (hit) count++;
        }
        parts = new string[](count);
        uint256 idx = 0;
        uint256 start = 0;
        uint256 i2 = 0;
        while (i2 <= src.length) {
            bool atSep = false;
            if (i2 + token.length <= src.length) {
                atSep = true;
                for (uint256 j = 0; j < token.length; j++) {
                    if (src[i2 + j] != token[j]) atSep = false;
                }
            } else if (i2 == src.length) {
                atSep = true;
            }
            if (atSep) {
                parts[idx++] = string(_slice(src, start, i2 - start));
                start = i2 + token.length;
                i2 += token.length;
            } else {
                i2++;
            }
        }
    }
}
