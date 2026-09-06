// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IPyth } from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import { PythStructs } from "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";

contract TradeLayer is ERC20("dstock", "DSTOCK") {
    error TradeLayer__OrderIdUsed(string id);

    using SafeERC20 for IERC20;

    IERC20 public immutable usdc;
    IPyth public immutable pyth;
    address public owner;
    address public backendWallet; // may call fulfillRequest

    mapping(address => mapping(string => uint256)) public totalHoldings;
    mapping(address => string[]) public stockHoldings;
    mapping(string => bool) public orderProcessed; // settled exactly once
    mapping(string => bool) public orderIdUsed;
    mapping(string => bytes32) public stockPriceIds;

    /// @notice DSTOCK committed to an in-flight redeem request, so the same
    /// balance cannot back two redemptions at once.
    mapping(address => uint256) public lockedForRedeem;

    /// @notice USDC escrowed against buy requests that have not settled yet.
    /// Redemption payouts may only draw on the balance above this figure, so a
    /// redeem can never be funded out of another user's unfilled purchase.
    uint256 public escrowedBuyUsdc;

    modifier onlyBackend() {
        require(msg.sender == backendWallet, "Not backend");
        _;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    struct Request {
        address requester;
        uint256 usdcBalance;
        uint256 tokenBalance;
        bool isRedeem;
    }

    struct Result {
        string orderId;
        string stockName;
        uint256 stockQuantity;
        uint256 amountToRefund;
    }

    mapping(string => Request) public requests;

    event RequestCreated(string orderId, string encryptedOrder);
    event OrderSettled(
        string indexed orderId,
        address indexed user,
        bool isRedeem,
        string stockName,
        uint256 stockQuantity,
        uint256 usdcAmount
    );

    constructor(address _usdc, address _pyth) {
        require(_usdc != address(0), "Invalid USDC address");
        require(_pyth != address(0), "Invalid Pyth address");
        usdc = IERC20(_usdc);
        pyth = IPyth(_pyth);
        owner = msg.sender;
        backendWallet = msg.sender;
        stockPriceIds["AAPL"] = 0x49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688;
        stockPriceIds["GOOGL"] = 0x5a48c03e9b9cb337801073ed9d166817473697efff0d138874e0f6a33d6d5aa6;
        stockPriceIds["TSLA"] = 0x16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1;
        stockPriceIds["MSFT"] = 0xd0ca23c1cc005e004ccf1db5bf76aeb6a49218f43dac3d4b275e92de12ded4d1;
    }

    /* ---------- ORACLE FUNCTIONS ---------- */

    /// @notice Get current price for a stock from Pyth
    /// @param stockSymbol Stock ticker (e.g., "AAPL", "GOOGL", "TSLA", "MSFT")
    /// @param priceUpdate Price update data from Pyth Hermes API
    /// @return price Current price in USD with 18 decimals
    function getStockPrice(string memory stockSymbol, bytes[] calldata priceUpdate)
        external
        payable
        returns (uint256)
    {
        bytes32 priceId = stockPriceIds[stockSymbol];
        require(priceId != bytes32(0), "Stock not supported");

        // Update price feed if data provided
        if (priceUpdate.length > 0) {
            uint256 fee = pyth.getUpdateFee(priceUpdate);
            require(msg.value >= fee, "Insufficient fee");

            pyth.updatePriceFeeds{ value: fee }(priceUpdate);

            // Refund excess
            if (msg.value > fee) {
                (bool success,) = msg.sender.call{ value: msg.value - fee }("");
                require(success, "Refund failed");
            }
        }

        // Get price (must be < 60 seconds old)
        PythStructs.Price memory pythPrice = pyth.getPriceNoOlderThan(priceId, 60);
        require(pythPrice.price > 0, "Invalid price");

        // Convert to 18 decimals
        uint256 price = _scalePythPrice(pythPrice.price, pythPrice.expo);

        // emit StockPriceQueried(stockSymbol, price, block.timestamp);

        return price;
    }

    /// @notice Get latest price without age check (use cautiously!)
    function getStockPriceUnsafe(string memory stockSymbol) external view returns (uint256) {
        bytes32 priceId = stockPriceIds[stockSymbol];
        require(priceId != bytes32(0), "Stock not supported");

        PythStructs.Price memory pythPrice = pyth.getPrice(priceId);
        require(pythPrice.price > 0, "Invalid price");

        return _scalePythPrice(pythPrice.price, pythPrice.expo);
    }

    /// @notice Add support for a new stock
    function addStock(string memory symbol, bytes32 priceId) external onlyOwner {
        require(priceId != bytes32(0), "Invalid price ID");
        stockPriceIds[symbol] = priceId;
    }

    /// @notice Rotate the wallet allowed to settle requests
    function setBackendWallet(address _backendWallet) external onlyOwner {
        require(_backendWallet != address(0), "Invalid backend");
        backendWallet = _backendWallet;
    }

    /// @notice Check if a stock is supported
    function isStockSupported(string memory symbol) external view returns (bool) {
        return stockPriceIds[symbol] != bytes32(0);
    }

    /* ---------- INTERNAL HELPERS ---------- */

    function _scalePythPrice(int64 price, int32 expo) internal pure returns (uint256) {
        require(price > 0, "Negative price");

        uint256 priceUint = uint256(uint64(price));
        int32 targetDecimals = 18;
        int32 scalingExponent = targetDecimals + expo;

        if (scalingExponent >= 0) {
            return priceUint * (10 ** uint32(scalingExponent));
        } else {
            return priceUint / (10 ** uint32(-scalingExponent));
        }
    }

    /* ---------- USER ACTIONS ---------- */

    function buyStock(string memory orderId, string memory encryptedOrder, uint256 amountOfUsdc) external {
        require(!orderIdUsed[orderId], TradeLayer__OrderIdUsed(orderId));
        require(amountOfUsdc > 0, "amount cannot be zero");

        orderIdUsed[orderId] = true;

        usdc.safeTransferFrom(msg.sender, address(this), amountOfUsdc);
        escrowedBuyUsdc += amountOfUsdc;

        requests[orderId] =
            Request({ requester: msg.sender, usdcBalance: amountOfUsdc, tokenBalance: 0, isRedeem: false });

        emit RequestCreated(orderId, encryptedOrder);
    }

    function redeemStock(string memory orderId, string memory encryptedOrder, uint256 amount) external {
        require(!orderIdUsed[orderId], TradeLayer__OrderIdUsed(orderId));
        require(amount > 0, "amount cannot be zero");

        // Lock rather than burn: the encrypted order does not reveal which stock
        // is being sold, so totalHoldings cannot be decremented until settlement.
        // Locking keeps totalSupply == sum(totalHoldings) intact while still
        // preventing the same balance from backing two redeem requests.
        require(balanceOf(msg.sender) - lockedForRedeem[msg.sender] >= amount, "not enough unlocked DSTOCK");

        orderIdUsed[orderId] = true;
        lockedForRedeem[msg.sender] += amount;

        requests[orderId] = Request({ requester: msg.sender, usdcBalance: 0, tokenBalance: amount, isRedeem: true });

        emit RequestCreated(orderId, encryptedOrder);
    }

    /* ---------- BACKEND ORACLE CALL ---------- */

    function fulfillRequest(string memory orderId, bytes memory result) external onlyBackend {
        Request memory req = requests[orderId];
        require(req.requester != address(0), "invalid order");

        require(!orderProcessed[orderId], "Order already processed"); // prevent incorrect accounting
        orderProcessed[orderId] = true;

        if (req.isRedeem) {
            _processRedemption(orderId, result);
        } else {
            _processPurchase(orderId, result);
        }

        Result memory settled = abi.decode(result, (Result));
        emit OrderSettled(
            orderId,
            req.requester,
            req.isRedeem,
            settled.stockName,
            req.isRedeem ? req.tokenBalance : settled.stockQuantity,
            req.isRedeem ? settled.amountToRefund : (req.usdcBalance - settled.amountToRefund)
        );
    }

    /* ---------- INTERNAL LOGIC ---------- */

    function _processPurchase(string memory orderId, bytes memory result) internal {
        Result memory res = abi.decode(result, (Result));

        uint256 qty = res.stockQuantity;
        // Read the request by the caller-supplied orderId, not res.orderId, so a
        // settlement cannot be attributed to a different user's order.
        Request memory req = requests[orderId];
        address user = req.requester;

        // A partial fill leaves unspent USDC that belongs to the user. The refund
        // can never exceed what this order actually escrowed.
        uint256 escrowed = req.usdcBalance;
        uint256 refund = res.amountToRefund;
        require(refund <= escrowed, "refund exceeds escrow");

        // The order is settled, so its escrow is no longer reserved: the refund
        // goes back to the user and the remainder becomes free protocol balance.
        escrowedBuyUsdc -= escrowed;

        // Track stock positions
        if (!_ownsStock(user, res.stockName)) {
            stockHoldings[user].push(res.stockName);
        }

        totalHoldings[user][res.stockName] += qty;

        // Mint non-transferable DSTOCK item tokens
        _mint(user, qty);

        if (refund > 0) {
            usdc.safeTransfer(user, refund);
        }
    }

    function _processRedemption(string memory orderId, bytes memory result) internal {
        Result memory res = abi.decode(result, (Result));

        Request memory req = requests[orderId];
        address user = req.requester;

        // The settled quantity must match what the user committed at request time.
        uint256 qty = req.tokenBalance;
        require(res.stockQuantity == qty, "quantity mismatch");
        require(totalHoldings[user][res.stockName] >= qty, "insufficient holdings");

        // Only the balance not reserved against pending buys may be paid out.
        uint256 balance = usdc.balanceOf(address(this));
        uint256 reserved = escrowedBuyUsdc;
        uint256 free = balance > reserved ? balance - reserved : 0;
        require(res.amountToRefund <= free, "insufficient free USDC");

        totalHoldings[user][res.stockName] -= qty;
        lockedForRedeem[user] -= qty;

        // Send the sale proceeds reported by the backend.
        usdc.safeTransfer(user, res.amountToRefund);
        _burn(user, qty);
    }

    /* ---------- HELPERS ---------- */

    /// @notice Full stock list for a user. The auto-generated getter for the
    /// public mapping only exposes element-by-element access.
    function getStockHoldings(address user) external view returns (string[] memory) {
        return stockHoldings[user];
    }

    function _ownsStock(address user, string memory stockName) internal view returns (bool) {
        string[] memory list = stockHoldings[user];
        for (uint256 i = 0; i < list.length; i++) {
            if (keccak256(bytes(list[i])) == keccak256(bytes(stockName))) {
                return true;
            }
        }
        return false;
    }

    function transfer(address to, uint256 amount) public virtual override returns (bool) {
        revert("Transfers are disabled");
    }

    function transferFrom(address from, address to, uint256 amount) public virtual override returns (bool) {
        revert("Transfers are disabled");
    }

    function decimals() public pure override returns (uint8) {
        return 0; // whole stock units only
    }
}
