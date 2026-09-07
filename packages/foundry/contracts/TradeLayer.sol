// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IPyth } from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import { PythStructs } from "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";
import { IAtsSecurityToken } from "./interfaces/IAtsSecurityToken.sol";

/// @notice Escrow + settlement orchestrator for equity positions.
/// One integer DSTOCK unit represents $0.01 of deposited portfolio value
/// (100 units = $1.00 of USDC escrowed and spent at buy settlement).
/// Per-stock allocations remain in the private backend ledger.
contract TradeLayer {
    error TradeLayer__OrderIdUsed(string id);

    using SafeERC20 for IERC20;

    /// @dev USDC has 6 decimals; one cent is 10_000 base units.
    uint256 public constant USDC_PER_CENT = 10_000;
    /// @dev Alpaca fractional notional orders require at least $1.
    uint256 public constant MIN_BUY_USDC = 1e6;

    IERC20 public immutable usdc;
    IPyth public immutable pyth;
    IAtsSecurityToken public immutable dstock;
    address public owner;
    address public backendWallet;

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

    /// @notice Settlement payload. `dstockUnits` is receipt units ($0.01 each).
    struct Result {
        uint256 dstockUnits;
        uint256 amountToRefund;
        bytes32 executionCommitment;
    }

    mapping(string => Request) public requests;

    event RequestCreated(string orderId, string encryptedOrder);
    event OrderCancelled(string indexed orderId, address indexed user, bool isRedeem);
    event OrderSettled(
        string indexed orderId,
        address indexed user,
        bool isRedeem,
        uint256 dstockUnits,
        uint256 usdcAmount,
        bytes32 indexed executionCommitment
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
        // Pyth trial-entitled equity feeds (Hedera / Hermes).
        stockPriceIds["TSLA"] = 0x16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1;
        stockPriceIds["VOO"] = 0x236b30dd09a9c00dfeec156c7b1efd646c0f01825a1758e3e4a0679e3bdff179;
        stockPriceIds["QQQ"] = 0x9695e2b96ea7b3859da9ed25b7a46a920a776e2fdae19a7bcfdf2b219230452d;
    }

    /* ---------- POSITION TOKEN VIEWS (proxy ATS) ---------- */

    function balanceOf(address account) external view returns (uint256) {
        return dstock.balanceOf(account) + lockedForRedeem[account];
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
            pyth.updatePriceFeeds{ value: fee }(priceUpdate);
            if (msg.value > fee) {
                (bool success,) = msg.sender.call{ value: msg.value - fee }("");
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
        require(amountOfUsdc >= MIN_BUY_USDC, "amount below $1 minimum");
        require(amountOfUsdc % USDC_PER_CENT == 0, "amount must be whole cents");

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
        require(dstock.balanceOf(msg.sender) >= amount, "not enough unlocked DSTOCK");

        orderIdUsed[orderId] = true;
        lockedForRedeem[msg.sender] += amount;
        requests[orderId] = Request({ requester: msg.sender, usdcBalance: 0, tokenBalance: amount, isRedeem: true });
        dstock.freezePartialTokens(msg.sender, amount);
        emit RequestCreated(orderId, encryptedOrder);
    }

    /* ---------- BACKEND SETTLEMENT ---------- */

    function fulfillRequest(string memory orderId, bytes memory result) external onlyBackend {
        Request memory req = requests[orderId];
        require(req.requester != address(0), "invalid order");
        require(!orderProcessed[orderId], "Order already processed");
        orderProcessed[orderId] = true;

        Result memory settled = abi.decode(result, (Result));
        require(settled.dstockUnits > 0, "units cannot be zero");

        if (req.isRedeem) {
            _processRedemption(orderId, settled);
        } else {
            _processPurchase(orderId, settled);
        }

        emit OrderSettled(
            orderId,
            req.requester,
            req.isRedeem,
            req.isRedeem ? req.tokenBalance : settled.dstockUnits,
            req.isRedeem ? settled.amountToRefund : (req.usdcBalance - settled.amountToRefund),
            settled.executionCommitment
        );
    }

    function cancelRequest(string memory orderId) external onlyBackend {
        Request memory req = requests[orderId];
        require(req.requester != address(0), "invalid order");
        require(!orderProcessed[orderId], "Order already processed");
        orderProcessed[orderId] = true;

        if (req.isRedeem) {
            lockedForRedeem[req.requester] -= req.tokenBalance;
            dstock.unfreezePartialTokens(req.requester, req.tokenBalance);
        } else {
            escrowedBuyUsdc -= req.usdcBalance;
            usdc.safeTransfer(req.requester, req.usdcBalance);
        }

        emit OrderCancelled(orderId, req.requester, req.isRedeem);
    }

    function _processPurchase(string memory orderId, Result memory res) internal {
        uint256 units = res.dstockUnits;
        Request memory req = requests[orderId];
        address user = req.requester;

        uint256 escrowed = req.usdcBalance;
        uint256 refund = res.amountToRefund;
        require(refund <= escrowed, "refund exceeds escrow");
        require(refund % USDC_PER_CENT == 0, "refund must be whole cents");
        uint256 netSpent = escrowed - refund;
        require(netSpent >= MIN_BUY_USDC, "net spend below $1");
        require(units == netSpent / USDC_PER_CENT, "units must equal net cents");
        require(netSpent % USDC_PER_CENT == 0, "net spend must be whole cents");

        escrowedBuyUsdc -= escrowed;

        // ATS mint requires the user to be KYC'd; the backend / issuer grants
        // KYC before settlement in the Hedera flow (tests grant in the handler).
        dstock.mint(user, units);

        if (refund > 0) {
            usdc.safeTransfer(user, refund);
        }
    }

    function _processRedemption(string memory orderId, Result memory res) internal {
        Request memory req = requests[orderId];
        address user = req.requester;

        uint256 units = req.tokenBalance;
        require(res.dstockUnits == units, "units mismatch");
        uint256 balance = usdc.balanceOf(address(this));
        uint256 reserved = escrowedBuyUsdc;
        uint256 free = balance > reserved ? balance - reserved : 0;
        require(res.amountToRefund <= free, "insufficient free USDC");

        lockedForRedeem[user] -= units;
        dstock.unfreezePartialTokens(user, units);
        dstock.burn(user, units);
        usdc.safeTransfer(user, res.amountToRefund);
    }
}
