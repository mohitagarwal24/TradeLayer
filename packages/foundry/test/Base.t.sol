// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { EnclaveAuth } from "../contracts/EnclaveAuth.sol";
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
import { MockUSDC } from "../contracts/mocks/MockUSDC.sol";
import { MockAts } from "../contracts/mocks/MockAts.sol";
import { MockHts } from "../contracts/mocks/MockHts.sol";
import { MockScheduleService } from "../contracts/mocks/MockScheduleService.sol";

/// @dev Shared fixture mirroring a real testnet deploy: two institutions (ACME and a RIVAL used
/// to prove cross-institution attacks fail), mutual-consent membership, two shared equities whose
/// compliance roles sit with the router, and a funded omnibus. There is no per-institution token
/// and no employee cash — the vault funds every order out of the pool.
///
/// The test contract is the platform owner and ACME's admin; `rivalAdmin` runs the other one.
abstract contract BaseTest is Test {
    uint256 internal constant ENCLAVE_KEY = 0xE1C1A7E;
    uint256 internal constant ROGUE_KEY = 0xBAD;
    bytes32 internal constant ORG = "ACME";
    bytes32 internal constant RIVAL = "RIVAL";
    bytes32 internal constant TSLA = "TSLA";
    bytes32 internal constant VOO = "VOO";

    uint256 internal constant FUNDING = 100_000e6;

    address internal enclave;
    address internal alice;
    address internal bob;
    address internal outsider;
    address internal rivalAdmin;
    address internal rivalStaff;

    MockUSDC internal usdc;
    MockHts internal hts;
    MockScheduleService internal hss;
    MockAts internal tsla;
    MockAts internal voo;
    OrgWalletRegistry internal registry;
    ComplianceRouter internal router;
    ConfidentialLedger internal ledger;
    OmnibusVault internal vault;
    OrderEscrow internal escrow;

    function setUp() public virtual {
        enclave = vm.addr(ENCLAVE_KEY);
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        outsider = makeAddr("outsider");
        rivalAdmin = makeAddr("rivalAdmin");
        rivalStaff = makeAddr("rivalStaff");

        usdc = new MockUSDC();
        hts = new MockHts();
        hss = new MockScheduleService();

        registry = new OrgWalletRegistry(address(this));
        ledger = new ConfidentialLedger(address(this), enclave);
        vault = new OmnibusVault(
            address(this), enclave, IHederaTokenService(address(hts)), IERC20(address(usdc)), IOrgWalletRegistry(address(registry))
        );
        escrow = new OrderEscrow(
            address(this),
            enclave,
            ledger,
            vault,
            IOrgWalletRegistry(address(registry)),
            IERC20(address(usdc)),
            IHederaScheduleService(address(hss))
        );
        router = new ComplianceRouter(address(this), IOrgWalletRegistry(address(registry)), address(this));

        ledger.setEscrow(address(escrow));
        vault.setEscrow(address(escrow));
        registry.bindPlatformAccount(address(vault));
        registry.bindPlatformAccount(address(escrow));

        // Two institutions. Registering binds the caller as both admin and first member.
        registry.registerOrg(ORG);
        vm.prank(rivalAdmin);
        registry.registerOrg(RIVAL);

        _join(alice, ORG);
        _join(bob, ORG);
        _joinAs(rivalStaff, RIVAL, rivalAdmin);

        tsla = new MockAts("Tesla Equity", "TSLA-t", 0);
        voo = new MockAts("Vanguard S&P 500 Equity", "VOO-t", 0);
        _configureAts(tsla);
        _configureAts(voo);
        vault.registerAts(TSLA, IAtsSecurityToken(address(tsla)));
        vault.registerAts(VOO, IAtsSecurityToken(address(voo)));
        router.registerToken(TSLA, IAtsCompliance(address(tsla)));
        router.registerToken(VOO, IAtsCompliance(address(voo)));

        // Fund the institution. The USDC joins the shared pool; who owns it is off-chain.
        usdc.approve(address(vault), type(uint256).max);
        vault.deposit(FUNDING);
        vm.deal(address(escrow), 1 ether);
    }

    /// @dev The vault mints and burns; the router administers everyone else's access.
    function _configureAts(MockAts token) internal {
        token.grantRole(token.AGENT_ROLE(), address(vault));
        token.grantRole(token.KYC_ROLE(), address(router));
        token.grantRole(token.CONTROL_LIST_ROLE(), address(router));
        token.grantRole(token.FREEZE_MANAGER_ROLE(), address(router));
        // The omnibus must itself be an eligible holder before it can be minted to.
        token.grantKyc(address(vault), "setup", block.timestamp, block.timestamp + 365 days, address(this));
        token.addToControlList(address(vault));
    }

    function _join(address wallet, bytes32 orgId) internal {
        _joinAs(wallet, orgId, registry.adminOf(orgId));
    }

    function _joinAs(address wallet, bytes32 orgId, address admin) internal {
        vm.prank(wallet);
        registry.proposeJoin(orgId);
        vm.prank(admin);
        registry.approveJoin(wallet);
    }

    /* ---------- EIP-712 helpers ---------- */

    function _digest(EnclaveAuth target, bytes32 structHash) internal view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", target.domainSeparator(), structHash));
    }

    function _signWith(uint256 key, EnclaveAuth target, bytes32 structHash) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, _digest(target, structHash));
        return abi.encodePacked(r, s, v);
    }

    function _sign(EnclaveAuth target, bytes32 structHash) internal view returns (bytes memory) {
        return _signWith(ENCLAVE_KEY, target, structHash);
    }

    function _ledgerUpdateHash(bytes32 accountId, bytes memory eBlob, bytes memory uBlob, uint64 expectedVersion)
        internal
        view
        returns (bytes32)
    {
        return keccak256(
            abi.encode(ledger.LEDGER_UPDATE_TYPEHASH(), accountId, keccak256(eBlob), keccak256(uBlob), expectedVersion)
        );
    }

    function _settlementHash(bytes32 orderId, uint256 spent, bytes memory eBlob, bytes memory uBlob, uint64 expectedVersion)
        internal
        view
        returns (bytes32)
    {
        return keccak256(
            abi.encode(escrow.SETTLEMENT_TYPEHASH(), orderId, spent, keccak256(eBlob), keccak256(uBlob), expectedVersion)
        );
    }

    function _cancelHash(bytes32 orderId) internal view returns (bytes32) {
        return keccak256(abi.encode(escrow.CANCEL_TYPEHASH(), orderId));
    }

    function _mintHash(bytes32 symbol, uint256 amount, uint256 expectedSupply) internal view returns (bytes32) {
        return keccak256(abi.encode(vault.ATS_MINT_TYPEHASH(), symbol, amount, expectedSupply));
    }

    function _burnHash(bytes32 symbol, uint256 amount, uint256 expectedSupply) internal view returns (bytes32) {
        return keccak256(abi.encode(vault.ATS_BURN_TYPEHASH(), symbol, amount, expectedSupply));
    }

    function _transferHash(bytes32 symbol, address to, uint256 amount, uint256 nonce) internal view returns (bytes32) {
        return keccak256(abi.encode(vault.ATS_TRANSFER_TYPEHASH(), symbol, to, amount, nonce));
    }

    function _payoutHash(bytes32 orgId, address to, uint256 amount, uint256 nonce) internal view returns (bytes32) {
        return keccak256(abi.encode(vault.PAYOUT_TYPEHASH(), orgId, to, amount, nonce));
    }

    /* ---------- flow helpers ---------- */

    function _accountId(address who) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(who));
    }

    function _openBuy(address who, bytes32 orderId, uint256 amount) internal returns (uint64 expiry) {
        expiry = uint64(block.timestamp + 1 hours);
        vm.prank(who);
        escrow.openBuy(orderId, amount, keccak256(abi.encodePacked("ct", orderId)), expiry);
    }

    function _settle(bytes32 orderId, uint256 spent, bytes memory eBlob, bytes memory uBlob, uint64 expectedVersion)
        internal
    {
        bytes memory sig = _sign(escrow, _settlementHash(orderId, spent, eBlob, uBlob, expectedVersion));
        escrow.settle(orderId, spent, eBlob, uBlob, expectedVersion, sig);
    }
}
