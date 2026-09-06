// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IPyth} from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import {PythStructs} from "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";
import {IAtsSecurityToken} from "./interfaces/IAtsSecurityToken.sol";

/// @notice Escrow + settlement orchestrator for equity positions.
/// DSTOCK is an external ATS / ERC-3643 security token (MockAtsSecurityToken
/// locally; Asset Tokenization Studio diamond on Hedera testnet). TradeLayer
/// must hold the agent/minter role on that token.
contract TradeLayer {
    error TradeLayer__OrderIdUsed(string id);

    using SafeERC20 for IERC20;

    IERC20 public immutable usdc;
    IPyth public immutable pyth;
    IAtsSecurityToken public immutable dstock;
    address public owner;
    address public backendWallet;

    mapping(address => mapping(string => uint256)) public totalHoldings;
    mapping(address => string[]) public stockHoldings;
    mapping(string => bool) public orderProcessed;
    mapping(string => bool) public orderIdUsed;
    mapping(string => bytes32) public stockPriceIds;

    mapping(address => uint256) public lockedForRedeem;
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

    constructor(address _usdc, address _pyth, address _dstock) {
        require(_usdc != address(0), "Invalid USDC address");
        require(_pyth != address(0), "Invalid Pyth address");
        require(_dstock != address(0), "Invalid DSTOCK address");
        usdc = IERC20(_usdc);
        pyth = IPyth(_pyth);
        dstock = IAtsSecurityToken(_dstock);
        owner = msg.sender;
        backendWallet = msg.sender;
        stockPriceIds["AAPL"] = 0x49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688;
        stockPriceIds["GOOGL"] = 0x5a48c03e9b9cb337801073ed9d166817473697efff0d138874e0f6a33d6d5aa6;
        stockPriceIds["TSLA"] = 0x16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1;
        stockPriceIds["MSFT"] = 0xd0ca23c1cc005e004ccf1db5bf76aeb6a49218f43dac3d4b275e92de12ded4d1;
    }

    /* ---------- POSITION TOKEN VIEWS (proxy ATS) ---------- */

    function balanceOf(address account) external view returns (uint256) {
        return dstock.balanceOf(account);
    }

    function totalSupply() external view returns (uint256) {
        return dstock.totalSupply();
    }

    function decimals() external view returns (uint8) {
        return dstock.decimals();
    }

    function name() external view returns (string memory) {
        return dstock.name();
    }

    function symbol() external view returns (string memory) {
        return dstock.symbol();
    }

    /* ---------- ORACLE ---------- */

    function getStockPrice(string memory stockSymbol, bytes[] calldata priceUpdate)
        external
        payable
        returns (uint256)
    {
        bytes32 priceId = stockPriceIds[stockSymbol];
        require(priceId != bytes32(0), "Stock not supported");

        if (priceUpdate.length > 0) {
            uint256 fee = pyth.getUpdateFee(priceUpdate);
            require(msg.value >= fee, "Insufficient fee");
            pyth.updatePriceFeeds{value: fee}(priceUpdate);
            if (msg.value > fee) {
                (bool success,) = msg.sender.call{value: msg.value - fee}("");
                require(success, "Refund failed");
            }
        }

        PythStructs.Price memory pythPrice = pyth.getPriceNoOlderThan(priceId, 60);
        require(pythPrice.price > 0, "Invalid price");
        return _scalePythPrice(pythPrice.price, pythPrice.expo);
    }

    function getStockPriceUnsafe(string memory stockSymbol) external view returns (uint256) {
        bytes32 priceId = stockPriceIds[stockSymbol];
        require(priceId != bytes32(0), "Stock not supported");
        PythStructs.Price memory pythPrice = pyth.getPrice(priceId);
        require(pythPrice.price > 0, "Invalid price");
        return _scalePythPrice(pythPrice.price, pythPrice.expo);
    }

    function addStock(string memory symbol_, bytes32 priceId) external onlyOwner {
        require(priceId != bytes32(0), "Invalid price ID");
        stockPriceIds[symbol_] = priceId;
    }

    function setBackendWallet(address _backendWallet) external onlyOwner {
        require(_backendWallet != address(0), "Invalid backend");
        backendWallet = _backendWallet;
    }

    function isStockSupported(string memory symbol_) external view returns (bool) {
        return stockPriceIds[symbol_] != bytes32(0);
    }

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
            Request({requester: msg.sender, usdcBalance: amountOfUsdc, tokenBalance: 0, isRedeem: false});
        emit RequestCreated(orderId, encryptedOrder);
    }

    function redeemStock(string memory orderId, string memory encryptedOrder, uint256 amount) external {
        require(!orderIdUsed[orderId], TradeLayer__OrderIdUsed(orderId));
        require(amount > 0, "amount cannot be zero");
        require(dstock.balanceOf(msg.sender) - lockedForRedeem[msg.sender] >= amount, "not enough unlocked DSTOCK");

        orderIdUsed[orderId] = true;
        lockedForRedeem[msg.sender] += amount;
        requests[orderId] = Request({requester: msg.sender, usdcBalance: 0, tokenBalance: amount, isRedeem: true});
        emit RequestCreated(orderId, encryptedOrder);
    }

    /* ---------- BACKEND SETTLEMENT ---------- */

    function fulfillRequest(string memory orderId, bytes memory result) external onlyBackend {
        Request memory req = requests[orderId];
        require(req.requester != address(0), "invalid order");
        require(!orderProcessed[orderId], "Order already processed");
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

    function _processPurchase(string memory orderId, bytes memory result) internal {
        Result memory res = abi.decode(result, (Result));
        uint256 qty = res.stockQuantity;
        Request memory req = requests[orderId];
        address user = req.requester;

        uint256 escrowed = req.usdcBalance;
        uint256 refund = res.amountToRefund;
        require(refund <= escrowed, "refund exceeds escrow");
        escrowedBuyUsdc -= escrowed;

        if (!_ownsStock(user, res.stockName)) {
            stockHoldings[user].push(res.stockName);
        }
        totalHoldings[user][res.stockName] += qty;

        // ATS mint requires the user to be KYC'd; the backend / issuer grants
        // KYC before settlement in the Hedera flow (tests grant in the handler).
        dstock.mint(user, qty);

        if (refund > 0) {
            usdc.safeTransfer(user, refund);
        }
    }

    function _processRedemption(string memory orderId, bytes memory result) internal {
        Result memory res = abi.decode(result, (Result));
        Request memory req = requests[orderId];
        address user = req.requester;

        uint256 qty = req.tokenBalance;
        require(res.stockQuantity == qty, "quantity mismatch");
        require(totalHoldings[user][res.stockName] >= qty, "insufficient holdings");

        uint256 balance = usdc.balanceOf(address(this));
        uint256 reserved = escrowedBuyUsdc;
        uint256 free = balance > reserved ? balance - reserved : 0;
        require(res.amountToRefund <= free, "insufficient free USDC");

        totalHoldings[user][res.stockName] -= qty;
        lockedForRedeem[user] -= qty;

        usdc.safeTransfer(user, res.amountToRefund);
        dstock.burn(user, qty);
    }

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
}
