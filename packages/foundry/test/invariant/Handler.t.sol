// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {TradeLayer} from "../../contracts/TradeLayer.sol";
import {MockUSDC} from "../MockUSDC.sol";
import {console} from "forge-std/console.sol";

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
    
    // Track pending orders, use orderId as key
    mapping(string => bool) public ghost_pendingBuyOrders;
    mapping(string => bool) public ghost_pendingRedeemOrders;
    mapping(string => uint256) public ghost_orderUsdcAmount;
    mapping(string => uint256) public ghost_orderTokenAmount;

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
        // no need for else block
        _;
    }
    
    constructor(TradeLayer _tradeLayer, MockUSDC _usdc) {
        tradeLayer = _tradeLayer;
        usdc = _usdc;
        
        // Create actors
        for (uint i = 0; i < 5; i++) {
            address actor = address(uint160(0x10000 + i));
            actors.push(actor);
            
            // Give each actor USDC and approve
            usdc.mint(actor, 1_000_000e6); // 1M USDC each
            vm.prank(actor);
            usdc.approve(address(tradeLayer), type(uint256).max);
        }
        
        // Stock symbols
        stockSymbols.push("AAPL");
        stockSymbols.push("GOOGL");
        stockSymbols.push("TSLA");
        stockSymbols.push("MSFT");
        stockSymbols.push("AMZN");
    }
    
    /* ---------- HANDLER FUNCTIONS ---------- */
    
    function buyStock(uint256 actorSeed, uint256 usdcAmount) 
        external 
        countCall("buyStock") 
    {
        // Bound inputs
        address actor = actors[bound(actorSeed, 0, actors.length - 1)]; // choose a random actor
        usdcAmount = bound(usdcAmount, 1e6, 10_000e6); // 1 to 10k USDC
        
        // Ensure actor has enough USDC
        uint256 balance = usdc.balanceOf(actor);
        if (balance < usdcAmount) {
            usdc.mint(actor, usdcAmount - balance);
        }
        
        // Generate unique order ID
        string memory orderId = _generateOrderId();
        string memory encryptedOrder = string(abi.encodePacked("encrypted_", orderId)); // no need to create an actual encrypted order with stock name, amount as this is just simulation, no real integration has been done with backend yet
        
        // Track ghost variables BEFORE the call
        ghost_totalUsdcDeposited += usdcAmount;
        ghost_pendingBuyOrders[orderId] = true;
        ghost_orderUsdcAmount[orderId] = usdcAmount;
        allOrderIds.push(orderId);
        
        // Execute buy
        vm.prank(actor);
        tradeLayer.buyStock(orderId, encryptedOrder, usdcAmount);
    }
    
    function fulfillBuyRequest(uint256 orderSeed, uint256 stockSeed, uint256 quantity) 
        external 
        countCall("fulfillBuy") 
    {
        if (allOrderIds.length == 0) return;
        
        // Bound inputs
        string memory orderId = allOrderIds[bound(orderSeed, 0, allOrderIds.length - 1)]; // pick a random order id(fulfilled or not, that will be taken care of in next 2 lines)
        
        // Only fulfill pending buy orders
        if (!ghost_pendingBuyOrders[orderId]) return;
        
        // Check if already processed
        if (tradeLayer.orderProcessed(orderId)) return;

        // if buy order and not processed, then proceed:
        
        // since encrypted order didnt contain stock name and amount, fulfill a random one with random quantity and amount
        string memory stockName = stockSymbols[bound(stockSeed, 0, stockSymbols.length - 1)];
        quantity = bound(quantity, 1, 1000);
        
        // Track ghost variables
        ghost_totalTokensMinted += quantity;
        ghost_pendingBuyOrders[orderId] = false;
        
        // Create result
        TradeLayer.Result memory result = TradeLayer.Result({
            orderId: orderId,
            stockName: stockName,
            stockQuantity: quantity,
            amountToRefund: 0
        });
        
        tradeLayer.fulfillRequest(orderId, abi.encode(result));
    }
    
    function redeemStock(uint256 actorSeed, uint256 amount) 
        external 
        countCall("redeemStock") 
    {
        // Bound inputs
        address actor = actors[bound(actorSeed, 0, actors.length - 1)];
        
        uint256 balance = tradeLayer.balanceOf(actor); // how many tokens he owns
        if (balance == 0) return;
        
        amount = bound(amount, 1, balance);
        
        // Generate unique order ID
        string memory orderId = _generateOrderId(); // generate a new unique id
        string memory encryptedOrder = string(abi.encodePacked("encrypted_", orderId));
        
        // Track ghost variables BEFORE burn
        // ghost_totalTokensBurned += amount;
        ghost_pendingRedeemOrders[orderId] = true;
        ghost_orderTokenAmount[orderId] = amount;
        allOrderIds.push(orderId);
        
        // Execute redeem
        vm.prank(actor);
        tradeLayer.redeemStock(orderId, encryptedOrder, amount);
    }
    
    function fulfillRedeemRequest(
        uint256 orderSeed, 
        uint256 stockSeed, 
        uint256 usdcToReturn
    ) 
        external 
        countCall("fulfillRedeem") 
    {
        if (allOrderIds.length == 0) return;
        
        // Bound inputs
        string memory orderId = allOrderIds[bound(orderSeed, 0, allOrderIds.length - 1)];
        
        // Only fulfill pending redeem orders
        if (!ghost_pendingRedeemOrders[orderId]) return;
        
        // Check if already processed
        if (tradeLayer.orderProcessed(orderId)) return;
        
        string memory stockName = stockSymbols[bound(stockSeed, 0, stockSymbols.length - 1)];
        
        // Get the request to know token amount
        (address requester, , uint256 tokenBalance, bool isRedeem) = tradeLayer.requests(orderId);
        if (requester == address(0) || !isRedeem) return;
        
        // Quantity should match what was burned
        uint256 quantity = tokenBalance;
        
        // USDC to return should be reasonable
        usdcToReturn = bound(usdcToReturn, 1e6, 100_000e6);
        
        // Track ghost variables
        ghost_totalTokensBurned += quantity;
        ghost_totalUsdcWithdrawn += usdcToReturn;
        ghost_pendingRedeemOrders[orderId] = false;
        
        // Create result
        TradeLayer.Result memory result = TradeLayer.Result({
            orderId: orderId,
            stockName: stockName,
            stockQuantity: quantity,
            amountToRefund: usdcToReturn
        });
        
        // Fulfill
        tradeLayer.fulfillRequest(orderId, abi.encode(result));
    }
    
    /* ---------- HELPER FUNCTIONS ---------- */
    
    function _generateOrderId() internal returns (string memory) {
        orderIdCounter++;
        return string(abi.encodePacked("order_", vm.toString(orderIdCounter)));
    }
    
    // Get total pending USDC (for invariants)
    function getTotalPendingUsdc() external view returns (uint256) {
        uint256 total = 0;
        for (uint i = 0; i < allOrderIds.length; i++) {
            string memory orderId = allOrderIds[i];
            if (ghost_pendingBuyOrders[orderId]) {
                total += ghost_orderUsdcAmount[orderId];
            }
        }
        return total;
    }
    
    // Get sum of all user holdings
    function getSumOfAllHoldings() external view returns (uint256) {
        uint256 sum = 0;
        for (uint i = 0; i < actors.length; i++) {
            for (uint j = 0; j < stockSymbols.length; j++) {
                sum += tradeLayer.totalHoldings(actors[i], stockSymbols[j]);
            }
        }
        return sum;
    }
    
    // Call summary for debugging
    function callSummary() external view {
        console.log("------- CALL SUMMARY -------");
        console.log("buyStock calls:", buyStockCalls);
        console.log("fulfillBuy calls:", fulfillBuyCalls);
        console.log("redeemStock calls:", redeemStockCalls);
        console.log("fulfillRedeem calls:", fulfillRedeemCalls);
        console.log("Total orders created:", allOrderIds.length);
        console.log("----------------------------");
    }
}