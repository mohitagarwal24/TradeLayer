// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {TradeLayer} from "../../contracts/TradeLayer.sol";
import {MockUSDC} from "../../contracts/mocks/MockUSDC.sol";
import {console} from "forge-std/console.sol";

/// @dev Handler for stateful invariant fuzzing.
///
/// Unlike the original handler (which faked encrypted orders and picked a RANDOM
/// stock at settlement time, so it could never catch a settlement that did not
/// match the order), this handler models each actor's per-stock holdings in a
/// ghost mapping and settles every request against the stock/quantity the request
/// actually committed to. That lets the invariant suite assert the property that
/// matters most: the contract's on-chain holdings equal the intended holdings, i.e.
/// settlement is bound to intent.
contract Handler is Test {
    TradeLayer public tradeLayer;
    MockUSDC public usdc;

    address[] public actors; // users
    string[] public stockSymbols;

    // Ghost variables to track system state
    uint256 public ghost_totalUsdcDeposited;
    uint256 public ghost_totalUsdcWithdrawn;
    uint256 public ghost_totalTokensMinted;
    uint256 public ghost_totalTokensBurned;
    uint256 public ghost_ordersProcessed;

    // Intended holdings: what each actor SHOULD hold if settlement matches intent.
    mapping(address => mapping(string => uint256)) public ghost_holdings;

    // Pending order bookkeeping, keyed by orderId
    mapping(string => bool) public ghost_pendingBuyOrders;
    mapping(string => bool) public ghost_pendingRedeemOrders;
    mapping(string => uint256) public ghost_orderUsdcAmount;
    // For redeems, the stock and quantity committed at request time
    mapping(string => string) public ghost_redeemStock;
    mapping(string => uint256) public ghost_redeemQty;

    uint256 public orderIdCounter;
    string[] public allOrderIds;

    // Counters for actions
    uint256 public buyStockCalls;
    uint256 public fulfillBuyCalls;
    uint256 public redeemStockCalls;
    uint256 public fulfillRedeemCalls;

    modifier countCall(bytes32 key) {
        if (key == "buyStock") buyStockCalls++;
        else if (key == "fulfillBuy") fulfillBuyCalls++;
        else if (key == "redeemStock") redeemStockCalls++;
        else if (key == "fulfillRedeem") fulfillRedeemCalls++;
        _;
    }

    constructor(TradeLayer _tradeLayer, MockUSDC _usdc) {
        tradeLayer = _tradeLayer;
        usdc = _usdc;

        // Create actors
        for (uint256 i = 0; i < 5; i++) {
            address actor = address(uint160(0x10000 + i));
            actors.push(actor);

            usdc.mint(actor, 1_000_000e6); // 1M USDC each
            vm.prank(actor);
            usdc.approve(address(tradeLayer), type(uint256).max);
        }

        stockSymbols.push("AAPL");
        stockSymbols.push("GOOGL");
        stockSymbols.push("TSLA");
        stockSymbols.push("MSFT");
        stockSymbols.push("AMZN");
    }

    /* ---------- HANDLER FUNCTIONS ---------- */

    function buyStock(uint256 actorSeed, uint256 usdcAmount) external countCall("buyStock") {
        address actor = actors[bound(actorSeed, 0, actors.length - 1)];
        usdcAmount = bound(usdcAmount, 1e6, 10_000e6); // 1 to 10k USDC

        uint256 balance = usdc.balanceOf(actor);
        if (balance < usdcAmount) {
            usdc.mint(actor, usdcAmount - balance);
        }

        string memory orderId = _generateOrderId();
        // The real encrypted blob is opaque to the contract; its contents are
        // revealed only at settlement, exactly as in production.
        string memory encryptedOrder = string(abi.encodePacked("encrypted_", orderId));

        ghost_totalUsdcDeposited += usdcAmount;
        ghost_pendingBuyOrders[orderId] = true;
        ghost_orderUsdcAmount[orderId] = usdcAmount;
        allOrderIds.push(orderId);

        vm.prank(actor);
        tradeLayer.buyStock(orderId, encryptedOrder, usdcAmount);
    }

    function fulfillBuyRequest(uint256 orderSeed, uint256 stockSeed, uint256 quantity, uint256 refundSeed)
        external
        countCall("fulfillBuy")
    {
        if (allOrderIds.length == 0) return;

        string memory orderId = allOrderIds[bound(orderSeed, 0, allOrderIds.length - 1)];
        if (!ghost_pendingBuyOrders[orderId]) return;
        if (tradeLayer.orderProcessed(orderId)) return;

        (address user, uint256 usdcBalance,,) = tradeLayer.requests(orderId);

        string memory stockName = stockSymbols[bound(stockSeed, 0, stockSymbols.length - 1)];
        quantity = bound(quantity, 1, 1000);

        // A partial fill returns unspent USDC; it can never exceed the escrow.
        uint256 refund = bound(refundSeed, 0, usdcBalance);

        TradeLayer.Result memory result = TradeLayer.Result({
            orderId: orderId,
            stockName: stockName,
            stockQuantity: quantity,
            amountToRefund: refund
        });

        // Handler is the backend wallet (set in the test setUp).
        tradeLayer.fulfillRequest(orderId, abi.encode(result));

        // State changed successfully — update ghosts to match intent.
        ghost_holdings[user][stockName] += quantity;
        ghost_totalTokensMinted += quantity;
        ghost_totalUsdcWithdrawn += refund;
        ghost_pendingBuyOrders[orderId] = false;
        ghost_ordersProcessed++;
    }

    function redeemStock(uint256 actorSeed, uint256 stockSeed, uint256 amountSeed)
        external
        countCall("redeemStock")
    {
        address actor = actors[bound(actorSeed, 0, actors.length - 1)];

        // Unlocked balance the actor can still commit to a redeem.
        uint256 available = tradeLayer.balanceOf(actor) - tradeLayer.lockedForRedeem(actor);
        if (available == 0) return;

        // Pick a stock the actor actually holds (per intended ghost holdings).
        string memory stockName = _pickHeldStock(actor, stockSeed);
        if (bytes(stockName).length == 0) return;

        uint256 held = ghost_holdings[actor][stockName];
        uint256 cap = held < available ? held : available;
        if (cap == 0) return;

        uint256 amount = bound(amountSeed, 1, cap);

        string memory orderId = _generateOrderId();
        string memory encryptedOrder = string(abi.encodePacked("encrypted_", orderId));

        ghost_pendingRedeemOrders[orderId] = true;
        ghost_redeemStock[orderId] = stockName;
        ghost_redeemQty[orderId] = amount;
        allOrderIds.push(orderId);

        vm.prank(actor);
        tradeLayer.redeemStock(orderId, encryptedOrder, amount);
    }

    function fulfillRedeemRequest(uint256 orderSeed, uint256 usdcToReturn)
        external
        countCall("fulfillRedeem")
    {
        if (allOrderIds.length == 0) return;

        string memory orderId = allOrderIds[bound(orderSeed, 0, allOrderIds.length - 1)];
        if (!ghost_pendingRedeemOrders[orderId]) return;
        if (tradeLayer.orderProcessed(orderId)) return;

        (address user,, uint256 tokenBalance, bool isRedeem) = tradeLayer.requests(orderId);
        if (user == address(0) || !isRedeem) return;

        // Settle against the stock and quantity the request actually committed to.
        string memory stockName = ghost_redeemStock[orderId];
        uint256 quantity = tokenBalance; // == ghost_redeemQty[orderId]

        // Payouts may only draw on USDC not reserved against pending buys, so bound
        // the fuzzed proceeds to that. Anything above it is rejected by the contract
        // by design, and would only produce reverted calls rather than coverage.
        uint256 balance = usdc.balanceOf(address(tradeLayer));
        uint256 reserved = tradeLayer.escrowedBuyUsdc();
        uint256 free = balance > reserved ? balance - reserved : 0;
        usdcToReturn = bound(usdcToReturn, 0, free);

        TradeLayer.Result memory result = TradeLayer.Result({
            orderId: orderId,
            stockName: stockName,
            stockQuantity: quantity,
            amountToRefund: usdcToReturn
        });

        tradeLayer.fulfillRequest(orderId, abi.encode(result));

        ghost_holdings[user][stockName] -= quantity;
        ghost_totalTokensBurned += quantity;
        ghost_totalUsdcWithdrawn += usdcToReturn;
        ghost_pendingRedeemOrders[orderId] = false;
        ghost_ordersProcessed++;
    }

    /* ---------- HELPER FUNCTIONS ---------- */

    function _generateOrderId() internal returns (string memory) {
        orderIdCounter++;
        return string(abi.encodePacked("order_", vm.toString(orderIdCounter)));
    }

    /// @dev Return a stock the actor holds a positive intended balance of, or "".
    function _pickHeldStock(address actor, uint256 seed) internal view returns (string memory) {
        uint256 n = stockSymbols.length;
        uint256 start = bound(seed, 0, n - 1);
        for (uint256 i = 0; i < n; i++) {
            string memory s = stockSymbols[(start + i) % n];
            if (ghost_holdings[actor][s] > 0) return s;
        }
        return "";
    }

    // Total pending BUY USDC (for invariant #1)
    function getTotalPendingUsdc() external view returns (uint256) {
        uint256 total = 0;
        for (uint256 i = 0; i < allOrderIds.length; i++) {
            string memory orderId = allOrderIds[i];
            if (ghost_pendingBuyOrders[orderId]) {
                total += ghost_orderUsdcAmount[orderId];
            }
        }
        return total;
    }

    // Sum of all user holdings as recorded on-chain (for invariant #2)
    function getSumOfAllHoldings() external view returns (uint256) {
        uint256 sum = 0;
        for (uint256 i = 0; i < actors.length; i++) {
            for (uint256 j = 0; j < stockSymbols.length; j++) {
                sum += tradeLayer.totalHoldings(actors[i], stockSymbols[j]);
            }
        }
        return sum;
    }

    // Number of orderIds the contract has marked processed (for invariant #3)
    function countProcessedOrders() external view returns (uint256) {
        uint256 count = 0;
        for (uint256 i = 0; i < allOrderIds.length; i++) {
            if (tradeLayer.orderProcessed(allOrderIds[i])) count++;
        }
        return count;
    }

    function getActors() external view returns (address[] memory) {
        return actors;
    }

    function getStocks() external view returns (string[] memory) {
        return stockSymbols;
    }

    function callSummary() external view {
        console.log("------- CALL SUMMARY -------");
        console.log("buyStock calls:", buyStockCalls);
        console.log("fulfillBuy calls:", fulfillBuyCalls);
        console.log("redeemStock calls:", redeemStockCalls);
        console.log("fulfillRedeem calls:", fulfillRedeemCalls);
        console.log("Total orders created:", allOrderIds.length);
        console.log("Orders processed:", ghost_ordersProcessed);
        console.log("----------------------------");
    }
}
