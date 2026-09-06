// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {TradeLayer} from "../../contracts/TradeLayer.sol";
import {MockUSDC} from "../../contracts/mocks/MockUSDC.sol";
import {MockAtsSecurityToken} from "../../contracts/mocks/MockAtsSecurityToken.sol";
import {Handler} from "./Handler.t.sol";

contract TradeLayerInvariantTest is Test {
    TradeLayer public tradeLayer;
    MockUSDC public usdc;
    MockAtsSecurityToken public dstock;
    Handler public handler;

    function setUp() public {
        usdc = new MockUSDC();
        dstock = new MockAtsSecurityToken("TradeLayer Equity", "DSTOCK");
        tradeLayer = new TradeLayer(address(usdc), address(2), address(dstock));
        dstock.setAgent(address(tradeLayer));
        handler = new Handler(tradeLayer, usdc, dstock);

        // Issuer (this contract) KYC's every fuzz actor so ATS mint succeeds.
        address[] memory actors = handler.getActors();
        for (uint256 i = 0; i < actors.length; i++) {
            dstock.grantKyc(actors[i]);
        }

        tradeLayer.setBackendWallet(address(handler));
        usdc.mint(address(tradeLayer), 10_000_000e6);

        targetContract(address(handler));

        bytes4[] memory selectors = new bytes4[](4);
        selectors[0] = Handler.buyStock.selector;
        selectors[1] = Handler.fulfillBuyRequest.selector;
        selectors[2] = Handler.redeemStock.selector;
        selectors[3] = Handler.fulfillRedeemRequest.selector;

        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    /* ---------- INVARIANT 1: USDC CONSERVATION ---------- */

    /// @notice Contract must hold enough USDC to cover all pending buy requests
    function invariant_usdcConservation() public view {
        uint256 contractBalance = usdc.balanceOf(address(tradeLayer));
        uint256 totalPendingUsdc = handler.getTotalPendingUsdc();

        assertGe(contractBalance, totalPendingUsdc, "INVARIANT VIOLATED: Contract USDC < Pending USDC");
    }

    /* ---------- INVARIANT 2: TOKEN SUPPLY = TOTAL HOLDINGS ---------- */

    /// @notice Total supply of DSTOCK must equal sum of all user holdings
    function invariant_tokenSupplyEqualsHoldings() public view {
        uint256 totalSupply = tradeLayer.totalSupply();
        uint256 sumOfHoldings = handler.getSumOfAllHoldings();

        assertEq(totalSupply, sumOfHoldings, "INVARIANT VIOLATED: Total Supply != Sum of Holdings");
    }

    /* ---------- INVARIANT 3: SETTLEMENT IS BOUND TO INTENT ---------- */

    /// @notice The contract's recorded per-user, per-stock holdings must equal the
    /// intended holdings the handler tracked from the stock/quantity each request
    /// actually committed to. If a settlement could be attributed to the wrong
    /// stock, user, or quantity, this diverges. (The original invariant #3 was a
    /// no-op `assertTrue(true)` and could not catch this class of bug at all.)
    function invariant_settlementMatchesIntent() public view {
        address[] memory actors = handler.getActors();
        string[] memory stocks = handler.getStocks();

        for (uint256 i = 0; i < actors.length; i++) {
            for (uint256 j = 0; j < stocks.length; j++) {
                assertEq(
                    tradeLayer.totalHoldings(actors[i], stocks[j]),
                    handler.ghost_holdings(actors[i], stocks[j]),
                    "INVARIANT VIOLATED: on-chain holdings != intended holdings"
                );
            }
        }
    }

    /* ---------- INVARIANT 4: USER BALANCE >= USER HOLDINGS ---------- */

    /// @notice Each user's token balance must be >= their total stock holdings
    function invariant_userBalanceCoversHoldings() public view {
        address[] memory actors = _getActors();
        string[] memory stocks = _getStocks();

        for (uint256 i = 0; i < actors.length; i++) {
            uint256 balance = tradeLayer.balanceOf(actors[i]);
            uint256 totalHoldings = 0;

            for (uint256 j = 0; j < stocks.length; j++) {
                totalHoldings += tradeLayer.totalHoldings(actors[i], stocks[j]);
            }

            assertGe(
                balance,
                totalHoldings,
                string(abi.encodePacked("INVARIANT VIOLATED: User balance < holdings for ", vm.toString(actors[i])))
            );
        }
    }

    /* ---------- INVARIANT 5: TRANSFERS REQUIRE KYC ---------- */

    /// @notice Secondary transfers of DSTOCK must fail when the recipient is not KYC'd.
    function invariant_transfersRequireKyc() public {
        address[] memory actors = _getActors();

        for (uint256 i = 0; i < actors.length; i++) {
            uint256 balance = tradeLayer.balanceOf(actors[i]);
            if (balance == 0 || actors.length < 2) continue;

            address recipient = actors[(i + 1) % actors.length];
            // Temporarily revoke recipient KYC to assert the compliance gate.
            dstock.revokeKyc(recipient);

            vm.prank(actors[i]);
            try dstock.transfer(recipient, 1) {
                fail("INVARIANT VIOLATED: transfer to non-KYC recipient should revert");
            } catch {
                // expected
            }

            dstock.grantKyc(recipient);
        }
    }

    /* ---------- INVARIANT 6: ACCOUNTING CONSISTENCY ---------- */

    /// @notice Ghost variable tracking should match actual state
    function invariant_ghostVariableConsistency() public view {
        // Total minted should equal total supply - total burned
        uint256 netSupply = handler.ghost_totalTokensMinted() - handler.ghost_totalTokensBurned();

        assertEq(
            netSupply, tradeLayer.totalSupply(), "INVARIANT VIOLATED: Ghost tracking inconsistent with actual supply"
        );
    }

    /* ---------- INVARIANT 7: NO DUPLICATE ORDER PROCESSING ---------- */

    /// @notice Each successful settlement marks exactly one new order processed, so
    /// the number of settlements the handler performed must equal the number of
    /// orderIds the contract has flagged as processed. Processing an order twice
    /// would increment the former without the latter.
    function invariant_noDuplicateOrderProcessing() public view {
        assertEq(
            handler.ghost_ordersProcessed(),
            handler.countProcessedOrders(),
            "INVARIANT VIOLATED: settlement count != processed order count"
        );
    }

    /* ---------- INVARIANT 8: BUY ESCROW IS SEGREGATED ---------- */

    /// @notice The contract's own accounting of USDC reserved against unsettled buy
    /// requests must equal the sum of those requests. Combined with invariant #1
    /// this is what makes escrow solvency structural rather than incidental: a
    /// redemption payout can only draw on the balance above `escrowedBuyUsdc`, so it
    /// cannot be funded out of another user's unfilled purchase.
    function invariant_buyEscrowSegregated() public view {
        assertEq(
            tradeLayer.escrowedBuyUsdc(),
            handler.getTotalPendingUsdc(),
            "INVARIANT VIOLATED: escrowedBuyUsdc != sum of pending buy orders"
        );
    }

    /* ---------- HELPERS ---------- */

    // Delegate to the handler so the actor/stock sets cannot drift apart.
    function _getActors() internal view returns (address[] memory) {
        return handler.getActors();
    }

    function _getStocks() internal view returns (string[] memory) {
        return handler.getStocks();
    }

    /* ---------- AFTER INVARIANT ---------- */

    function invariant_callSummary() public view {
        handler.callSummary();
    }
}
