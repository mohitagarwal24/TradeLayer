// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Test, console } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ConfidentialLedger } from "../../contracts/ConfidentialLedger.sol";
import { OrderEscrow } from "../../contracts/OrderEscrow.sol";
import { OmnibusVault } from "../../contracts/OmnibusVault.sol";
import { OrgWalletRegistry } from "../../contracts/OrgWalletRegistry.sol";
import { ComplianceRouter } from "../../contracts/ComplianceRouter.sol";
import { IHederaTokenService } from "../../contracts/interfaces/IHederaTokenService.sol";
import { IHederaScheduleService } from "../../contracts/interfaces/IHederaScheduleService.sol";
import { IAtsSecurityToken } from "../../contracts/interfaces/IAtsSecurityToken.sol";
import { IAtsCompliance } from "../../contracts/interfaces/IAtsCompliance.sol";
import { IOrgWalletRegistry } from "../../contracts/interfaces/IOrgWalletRegistry.sol";
import { MockUSDC } from "../../contracts/mocks/MockUSDC.sol";
import { MockAts } from "../../contracts/mocks/MockAts.sol";
import { MockHts } from "../../contracts/mocks/MockHts.sol";
import { MockScheduleService } from "../../contracts/mocks/MockScheduleService.sol";
import { Handler } from "./Handler.t.sol";

/// @dev System-level properties under stateful fuzzing.
///
/// The old suite proved solvency through the company token's supply. With no token of our own,
/// solvency is now a statement about the USDC itself: every cent ever deposited is either still
/// in the omnibus, sitting in the escrow against an open order, or was explicitly paid out by an
/// enclave-signed authorization. Nothing else can move it.
contract TradeLayerInvariants is Test {
    uint256 internal constant ENCLAVE_KEY = 0xE1C1A7E;
    bytes32 internal constant ORG = "FUZZ";
    bytes32 internal constant TSLA = "TSLA";
    bytes32 internal constant VOO = "VOO";

    MockUSDC usdc;
    MockHts hts;
    MockScheduleService hss;
    MockAts tsla;
    MockAts voo;
    OrgWalletRegistry registry;
    ComplianceRouter router;
    ConfidentialLedger ledger;
    OmnibusVault vault;
    OrderEscrow escrow;
    Handler handler;

    function setUp() public {
        address enclave = vm.addr(ENCLAVE_KEY);
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

        tsla = new MockAts("Tesla Equity", "TSLA-t", 0);
        voo = new MockAts("Vanguard Equity", "VOO-t", 0);

        address[] memory actors = new address[](3);
        actors[0] = makeAddr("alice");
        actors[1] = makeAddr("bob");
        actors[2] = makeAddr("carol");

        MockAts[] memory equities = new MockAts[](2);
        equities[0] = tsla;
        equities[1] = voo;
        bytes32[] memory symbols = new bytes32[](2);
        symbols[0] = TSLA;
        symbols[1] = VOO;

        handler = new Handler(ledger, escrow, vault, router, usdc, equities, symbols, hss, actors);

        // The handler runs the institution; the actors are its employees, bound by mutual consent.
        vm.prank(address(handler));
        registry.registerOrg(ORG);
        for (uint256 i = 0; i < actors.length; i++) {
            vm.prank(actors[i]);
            registry.proposeJoin(ORG);
            vm.prank(address(handler));
            registry.approveJoin(actors[i]);
        }

        _configureAts(tsla);
        _configureAts(voo);
        vault.registerAts(TSLA, IAtsSecurityToken(address(tsla)));
        vault.registerAts(VOO, IAtsSecurityToken(address(voo)));
        router.registerToken(TSLA, IAtsCompliance(address(tsla)));
        router.registerToken(VOO, IAtsCompliance(address(voo)));

        // Only now can the institution admit its people — the router needs its tokens first.
        for (uint256 i = 0; i < actors.length; i++) {
            vm.prank(address(handler));
            router.admitMember(actors[i]);
        }

        usdc.mint(address(handler), 5_000_000e6);
        vm.deal(address(escrow), 100 ether);

        targetContract(address(handler));
    }

    function _configureAts(MockAts token) internal {
        token.grantRole(token.AGENT_ROLE(), address(vault));
        token.grantRole(token.KYC_ROLE(), address(router));
        token.grantRole(token.CONTROL_LIST_ROLE(), address(router));
        token.grantRole(token.FREEZE_MANAGER_ROLE(), address(router));
        token.grantKyc(address(vault), "setup", block.timestamp, block.timestamp + 365 days, address(this));
        token.addToControlList(address(vault));
    }

    /* ---------- solvency: every deposited cent is accounted for ---------- */

    function invariant_usdcIsFullyAccountedFor() public view {
        uint256 held = usdc.balanceOf(address(vault)) + usdc.balanceOf(address(escrow));
        assertEq(held, handler.ghost_deposited() - handler.ghost_paidOut(), "USDC appeared or vanished");
        assertEq(vault.reserve(), held, "reserve() must equal what the system actually holds");
    }

    /// @dev The product claim: an employee is given authority, never custody. The only way USDC
    /// can reach an employee's wallet is an enclave-signed payout.
    function invariant_employeesNeverHoldCompanyCash() public view {
        uint256 sum;
        for (uint256 i = 0; i < handler.actorCount(); i++) {
            sum += usdc.balanceOf(handler.actors(i));
        }
        assertEq(sum, handler.ghost_paidOut(), "employee wallets hold USDC that was never paid out");
    }

    function invariant_escrowHoldsExactlyTheOpenOrders() public view {
        uint256 sum;
        for (uint256 i = 0; i < handler.openCount(); i++) {
            OrderEscrow.Order memory o = escrow.order(handler.openId(i));
            assertEq(uint8(o.status), uint8(OrderEscrow.Status.OPEN), "tracked order is not OPEN");
            sum += o.amount;
        }
        assertEq(usdc.balanceOf(address(escrow)), sum, "escrow balance != sum of OPEN orders");
        assertEq(vault.committed(), sum, "committed != sum of OPEN orders");
        assertEq(handler.ghost_openEscrow(), sum, "ghost drifted from reality");
    }

    /* ---------- order lifecycle ---------- */

    function invariant_ordersTerminateAtMostOnce() public view {
        for (uint256 i = 0; i < handler.orderCount(); i++) {
            bytes32 id = handler.allOrders(i);
            assertLe(handler.ghost_terminalCount(id), 1, "an order terminated more than once");
            OrderEscrow.Order memory o = escrow.order(id);
            assertTrue(o.status != OrderEscrow.Status.NONE, "a tracked order does not exist");
        }
    }

    function invariant_ledgerVersionsMatchGhost() public view {
        for (uint256 i = 0; i < handler.actorCount(); i++) {
            bytes32 id = keccak256(abi.encodePacked(handler.actors(i)));
            assertEq(ledger.version(id), handler.ghost_ledgerVersion(id), "ledger version != ghost");
        }
    }

    /* ---------- equities ---------- */

    function invariant_atsSupplyEqualsNetMints() public view {
        MockAts[2] memory eq = [tsla, voo];
        bytes32[2] memory sym = [TSLA, VOO];
        for (uint256 i = 0; i < 2; i++) {
            uint256 expected = handler.ghost_minted(sym[i]) - handler.ghost_burned(sym[i]);
            assertEq(eq[i].totalSupply(), expected, "ATS supply != minted - burned");
            assertEq(
                eq[i].balanceOf(address(vault)) + handler.ghost_transferredOut(sym[i]),
                expected,
                "vault holdings + withdrawals != supply"
            );
        }
    }

    /// @dev Membership is the only public fact about a wallet, and it never changes by itself.
    function invariant_actorsStayBoundToTheirInstitution() public view {
        for (uint256 i = 0; i < handler.actorCount(); i++) {
            assertEq(registry.orgOf(handler.actors(i)), ORG, "an employee lost their institution");
        }
    }

    function invariant_callSummary() public view {
        console.log("deposit      ", handler.calls("deposit"));
        console.log("openBuy      ", handler.calls("openBuy"));
        console.log("settle       ", handler.calls("settle"));
        console.log("cancel       ", handler.calls("cancel"));
        console.log("refund       ", handler.calls("refund"), "(scheduled:", handler.ghost_scheduledRefundsFired());
        console.log("ledgerUpdate ", handler.calls("ledgerUpdate"));
        console.log("mintAts      ", handler.calls("mintAts"));
        console.log("burnAts      ", handler.calls("burnAts"));
        console.log("transferAts  ", handler.calls("transferAts"));
        console.log("payout       ", handler.calls("payout"));
    }
}
