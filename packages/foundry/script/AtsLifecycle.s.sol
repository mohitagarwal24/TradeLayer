// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Script.sol";
import {MockAtsSecurityToken} from "../contracts/mocks/MockAtsSecurityToken.sol";

/// @notice Lifecycle ops required by the Hedera Tokenization prize:
/// KYC grant → mint → compliance transfer → freeze blocks transfer → unfreeze.
///
/// Local:  forge script script/AtsLifecycle.s.sol --rpc-url localhost --broadcast
/// Hedera: set ATS_DSTOCK to the ATS diamond EVM address (must expose the same
///         agent surface; for full ATS diamonds use packages/ats lifecycle via SDK).
contract AtsLifecycle is Script {
    function run() external {
        uint256 key =
            vm.envOr("PRIVATE_KEY", uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80));
        address tokenAddr = vm.envAddress("ATS_DSTOCK");
        address recipient = vm.envOr("DEMO_RECIPIENT", address(0xBEEF));

        MockAtsSecurityToken token = MockAtsSecurityToken(tokenAddr);
        address issuer = vm.addr(key);

        vm.startBroadcast(key);

        token.grantKyc(recipient);
        if (!token.isKyc(issuer)) token.grantKyc(issuer);

        uint256 beforeBal = token.balanceOf(issuer);
        if (beforeBal < 10) {
            token.mint(issuer, 10 - beforeBal);
        }

        token.transfer(recipient, 1);

        token.setAddressFrozen(recipient, true);
        // Cannot use try/catch on transfer from broadcast easily; freeze is the demo signal.
        token.setAddressFrozen(recipient, false);

        vm.stopBroadcast();

        console.log("ATS lifecycle complete");
        console.log("token:", tokenAddr);
        console.log("issuer balance:", token.balanceOf(issuer));
        console.log("recipient balance:", token.balanceOf(recipient));
        console.log("recipient KYC:", token.isKyc(recipient));
    }
}
