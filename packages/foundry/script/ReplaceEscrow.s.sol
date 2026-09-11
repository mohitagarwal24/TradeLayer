// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Script.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ConfidentialLedger } from "../contracts/ConfidentialLedger.sol";
import { OrderEscrow } from "../contracts/OrderEscrow.sol";
import { OmnibusVault } from "../contracts/OmnibusVault.sol";
import { OrgWalletRegistry } from "../contracts/OrgWalletRegistry.sol";
import { IHederaScheduleService } from "../contracts/interfaces/IHederaScheduleService.sol";
import { IOrgWalletRegistry } from "../contracts/interfaces/IOrgWalletRegistry.sol";

/// @notice Swap in a new OrderEscrow without redeploying anything else.
///
/// Both the vault and the ledger expose `setEscrow`, so the escrow is the one component that can
/// be replaced in place — which matters because the vault holds the institutions' USDC. Drain any
/// open order on the old escrow first: once the vault stops recognising it, it can no longer
/// return funds and whatever it still holds is stranded.
contract ReplaceEscrow is Script {
    address constant HEDERA_HSS = 0x000000000000000000000000000000000000016B;
    address constant HEDERA_TESTNET_USDC = 0x0000000000000000000000000000000000068cDa;

    function run() external {
        uint256 key = vm.envOr("PRIVATE_KEY", uint256(0));
        require(key != 0, "Set PRIVATE_KEY");
        address deployer = vm.addr(key);
        address signer = vm.envOr("ENCLAVE_SIGNER", address(0));
        require(signer != address(0), "Set ENCLAVE_SIGNER");

        OmnibusVault vault = OmnibusVault(payable(vm.envAddress("OMNIBUS_VAULT")));
        ConfidentialLedger ledger = ConfidentialLedger(vm.envAddress("CONFIDENTIAL_LEDGER"));
        OrgWalletRegistry registry = OrgWalletRegistry(vm.envAddress("ORG_WALLET_REGISTRY"));
        uint256 escrowHbar = vm.envOr("ESCROW_HBAR_WEI", uint256(5 ether));

        console.log("old escrow:", vault.escrow());

        vm.startBroadcast(key);

        OrderEscrow escrow = new OrderEscrow(
            deployer,
            signer,
            ledger,
            vault,
            IOrgWalletRegistry(address(registry)),
            IERC20(HEDERA_TESTNET_USDC),
            IHederaScheduleService(HEDERA_HSS)
        );

        ledger.setEscrow(address(escrow));
        vault.setEscrow(address(escrow));
        registry.bindPlatformAccount(address(escrow));

        if (escrowHbar > 0) {
            (bool funded,) = payable(address(escrow)).call{ value: escrowHbar }("");
            require(funded, "fund escrow with HBAR");
        }

        vm.stopBroadcast();

        console.log("new escrow:", address(escrow));
        console.log("refund buffer (s):", escrow.REFUND_SCHEDULE_BUFFER());
        console.log("Next: associate the new escrow with USDC, then update the configs.");
    }
}
