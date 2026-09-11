// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Script.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ConfidentialLedger } from "../contracts/ConfidentialLedger.sol";
import { OrderEscrow } from "../contracts/OrderEscrow.sol";
import { OmnibusVault } from "../contracts/OmnibusVault.sol";
import { OrgWalletRegistry } from "../contracts/OrgWalletRegistry.sol";
import { ComplianceRouter } from "../contracts/ComplianceRouter.sol";
import { IHederaTokenService } from "../contracts/interfaces/IHederaTokenService.sol";
import { IHederaScheduleService } from "../contracts/interfaces/IHederaScheduleService.sol";
import { IAtsSecurityToken } from "../contracts/interfaces/IAtsSecurityToken.sol";
import { IAtsCompliance } from "../contracts/interfaces/IAtsCompliance.sol";
import { IOrgWalletRegistry } from "../contracts/interfaces/IOrgWalletRegistry.sol";

/// @notice Deploys TradeLayer to Hedera testnet and wires it together.
///
/// Deploys storage and logic only. Everything that touches the HTS system contract — associating
/// the vault and escrow with USDC — happens afterwards in `packages/ats/src/setupHedera.ts`,
/// because `forge script` simulates against a local EVM where `0x167` does not exist and any such
/// call would revert before it could be broadcast. Granting the ComplianceRouter its ATS roles is
/// likewise a post-deploy step, signed by the equity issuer (`yarn ats:grant-router-roles`).
contract Deploy is Script {
    uint256 constant HEDERA_TESTNET = 296;

    address constant HEDERA_HTS = 0x0000000000000000000000000000000000000167;
    address constant HEDERA_HSS = 0x000000000000000000000000000000000000016B;
    /// @dev Circle native USDC on Hedera testnet, HTS 0.0.429274 at its long-zero EVM address.
    address constant HEDERA_TESTNET_USDC = 0x0000000000000000000000000000000000068cDa;

    function run() external {
        uint256 chainId = block.chainid;
        require(chainId == HEDERA_TESTNET, "TradeLayer deploys to Hedera testnet (296) only");

        uint256 deployerKey = vm.envOr("PRIVATE_KEY", uint256(0));
        require(deployerKey != 0, "Set PRIVATE_KEY in packages/foundry/.env");
        address deployer = vm.addr(deployerKey);

        address signer = vm.envOr("ENCLAVE_SIGNER", address(0));
        require(signer != address(0), "Set ENCLAVE_SIGNER (address of the enclave's signing key)");

        // The wallet registered as an SSI issuer on the equity diamonds. ComplianceRouter passes
        // it as the `issuer` argument to grantKyc, which the diamond validates against its own
        // issuer list — it is the argument that is checked, not the caller.
        address atsIssuer = vm.envOr("ATS_ISSUER", deployer);
        uint256 escrowHbar = vm.envOr("ESCROW_HBAR_WEI", uint256(5 ether));

        console.log("==============================================");
        console.log("Chain id:      ", chainId);
        console.log("Deployer:      ", deployer);
        console.log("Enclave signer:", signer);
        console.log("ATS issuer:    ", atsIssuer);

        vm.startBroadcast(deployerKey);

        OrgWalletRegistry registry = new OrgWalletRegistry(deployer);
        ConfidentialLedger ledger = new ConfidentialLedger(deployer, signer);
        OmnibusVault vault = new OmnibusVault(
            deployer, signer, IHederaTokenService(HEDERA_HTS), IERC20(HEDERA_TESTNET_USDC), IOrgWalletRegistry(address(registry))
        );
        OrderEscrow escrow = new OrderEscrow(
            deployer,
            signer,
            ledger,
            vault,
            IOrgWalletRegistry(address(registry)),
            IERC20(HEDERA_TESTNET_USDC),
            IHederaScheduleService(HEDERA_HSS)
        );
        ComplianceRouter router = new ComplianceRouter(deployer, IOrgWalletRegistry(address(registry)), atsIssuer);

        ledger.setEscrow(address(escrow));
        vault.setEscrow(address(escrow));

        // Infrastructure accounts belong to the reserved PLATFORM org, so the registry can answer
        // "who owns this wallet" for them too without anyone having to consent on their behalf.
        registry.bindPlatformAccount(address(vault));
        registry.bindPlatformAccount(address(escrow));

        _registerEquity(vault, router, "F", vm.envOr("ATS_F", address(0)));
        _registerEquity(vault, router, "TSLA", vm.envOr("ATS_TSLA", address(0)));
        _registerEquity(vault, router, "VOO", vm.envOr("ATS_VOO", address(0)));

        if (escrowHbar > 0) {
            // .transfer()'s 2300-gas stipend is not reliable on Hedera; use a full-gas call.
            (bool funded,) = payable(address(escrow)).call{ value: escrowHbar }("");
            require(funded, "fund escrow with HBAR");
        }

        vm.stopBroadcast();

        console.log("OrgWalletRegistry: ", address(registry));
        console.log("ConfidentialLedger:", address(ledger));
        console.log("OmnibusVault:      ", address(vault));
        console.log("OrderEscrow:       ", address(escrow));
        console.log("ComplianceRouter:  ", address(router));
        console.log("USDC (0.0.429274): ", HEDERA_TESTNET_USDC);
        console.log("==============================================");
        console.log("Next: yarn ats:setup-hedera        (associate vault + escrow with USDC)");
        console.log("Then: yarn ats:grant-router-roles  (KYC/control-list/freeze -> ComplianceRouter)");
    }

    /// @dev Pure storage writes on both sides — safe to simulate locally.
    function _registerEquity(OmnibusVault vault, ComplianceRouter router, bytes32 symbol, address token) internal {
        if (token == address(0)) return;
        vault.registerAts(symbol, IAtsSecurityToken(token));
        router.registerToken(symbol, IAtsCompliance(token));
        console.log("  equity registered:", vm.toString(symbol), token);
    }
}
