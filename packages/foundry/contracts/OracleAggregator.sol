// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IPyth} from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import {PythStructs} from "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";
import "forge-std/console.sol";
import {IOracleAggregator} from "./IOracleAggregator.sol";

interface IChainlinkAggregator {
    function latestRoundData() external view returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    );
    function decimals() external view returns (uint8);
}

contract OracleAggregator {
    
    // Oracle sources
    IPyth public immutable pyth;
    mapping(string => IChainlinkAggregator) public chainlinkFeeds; // FIXED: Now a mapping
    
    // Stock symbol -> Pyth price ID
    mapping(string => bytes32) public pythPriceIds;
    
    // TWAP tracking for anomaly detection
    struct TWAPData {
        uint256 cumulativePrice;
        uint256 lastUpdateTime;
        uint256 lastPrice;
        uint256 sampleCount;
    }
    
    mapping(string => TWAPData) public twapData;

    address public owner;

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }
    
    // Configuration
    uint256 public constant MAX_PRICE_AGE = 1 hours;
    uint256 public constant TWAP_WINDOW = 5 minutes;
    uint256 public constant MAX_DEVIATION_BPS = 3000; // 30%
    uint256 public constant SUDDEN_MOVE_THRESHOLD_BPS = 1000; // 10% in 5 mins
    uint256 public constant MIN_ORACLES_REQUIRED = 2;
    
    // Events
    event PriceAnomalyDetected(string symbol, uint256 price, string reason);
    event PriceValidated(string symbol, uint256 finalPrice, uint256 pythPrice, uint256 chainlinkPrice);
    event TWAPUpdated(string symbol, uint256 twap, uint256 currentPrice);
    
    constructor(address _pyth) {
        require(_pyth != address(0), "Invalid Pyth address");
        pyth = IPyth(_pyth);
        owner = msg.sender;
    }

    /// @notice Set Chainlink feed for a stock
    function setChainlinkFeed(string memory symbol, address feed) external onlyOwner {
        require(feed != address(0), "Invalid feed");
        chainlinkFeeds[symbol] = IChainlinkAggregator(feed); // FIXED: Use mapping
    }

    /// @notice Set Pyth price ID for a stock
    function setPythPriceId(string memory symbol, bytes32 priceId) external onlyOwner {
        require(priceId != bytes32(0), "Invalid price ID");
        pythPriceIds[symbol] = priceId;
    }
    
    /// @notice Get validated price with multi-oracle consensus
    function getValidatedPrice(
        string memory symbol,
        bytes[] calldata pythPriceUpdate
    ) external payable returns (uint256) {
        
        // Update Pyth price if data provided
        if (pythPriceUpdate.length > 0) {
            uint256 fee = pyth.getUpdateFee(pythPriceUpdate);
            require(msg.value >= fee, "Insufficient fee");
            pyth.updatePriceFeeds{value: fee}(pythPriceUpdate);
            
            // Refund excess
            if (msg.value > fee) {
                (bool success, ) = msg.sender.call{value: msg.value - fee}("");
                require(success, "Refund failed");
            }
        }
        
        // Fetch prices from both oracles
        (uint256 pythPrice, bool pythValid) = _getPythPrice(symbol);
        (uint256 chainlinkPrice, bool chainlinkValid) = _getChainlinkPrice(symbol);
        
        // Check how many valid oracles we have
        uint256 validOracleCount = 0;
        if (pythValid) validOracleCount++;
        if (chainlinkValid) validOracleCount++;
        
        require(validOracleCount >= 1, "No valid oracles");
        
        uint256 finalPrice;
        
        // PROTECTION #1: Use median if both oracles available
        if (validOracleCount == 2) {
            // Check if prices agree (within 30% deviation)
            uint256 deviation = _calculateDeviation(pythPrice, chainlinkPrice);
            
            if (deviation > MAX_DEVIATION_BPS) {
                // Oracles disagree significantly - use TWAP as tiebreaker
                emit PriceAnomalyDetected(
                    symbol, 
                    pythPrice, 
                    "Oracle disagreement > 30%"
                );
                
                finalPrice = _resolvePriceConflict(symbol, pythPrice, chainlinkPrice);
            } else {
                // Oracles agree - use median (average of 2)
                finalPrice = (pythPrice + chainlinkPrice) / 2;
            }
        } else {
            // Only one oracle available - validate against TWAP
            finalPrice = pythValid ? pythPrice : chainlinkPrice;
            
            // PROTECTION #2: Check against TWAP
            if (!_validateAgainstTWAP(symbol, finalPrice)) {
                revert("Price deviates from TWAP");
            }
        }
        
        // PROTECTION #3: Check for sudden price movements
        if (!_checkSuddenMovement(symbol, finalPrice)) {
            emit PriceAnomalyDetected(
                symbol,
                finalPrice,
                "Sudden price movement > 10%"
            );
            revert("Sudden price movement detected");
        }
        
        // Update TWAP
        _updateTWAP(symbol, finalPrice);
        
        emit PriceValidated(symbol, finalPrice, pythPrice, chainlinkPrice);
        
        return finalPrice;
    }
    
    /// @notice Get price from Pyth oracle
    function _getPythPrice(string memory symbol) internal view returns (uint256, bool) {
        bytes32 priceId = pythPriceIds[symbol];
        if (priceId == bytes32(0)) return (0, false);
        
        try pyth.getPriceNoOlderThan(priceId, MAX_PRICE_AGE) returns (
            PythStructs.Price memory price
        ) {
            if (price.price <= 0) return (0, false);
            
            // Convert to 18 decimals
            uint256 scaledPrice = _scalePythPrice(price.price, price.expo);
            return (scaledPrice, true);
        } catch {
            return (0, false);
        }
    }
    
    /// @notice Get price from Chainlink oracle
    function _getChainlinkPrice(string memory symbol) internal view returns (uint256, bool) {
        IChainlinkAggregator feed = chainlinkFeeds[symbol]; // FIXED: Get specific feed
        if (address(feed) == address(0)) return (0, false);
        
        try feed.latestRoundData() returns (
            uint80 roundId,
            int256 answer,
            uint256,
            uint256 updatedAt,
            uint80 answeredInRound
        ) {
            // Staleness check
            if (block.timestamp - updatedAt > MAX_PRICE_AGE) return (0, false);
            if (answer <= 0) return (0, false);
            if (answeredInRound < roundId) return (0, false);
            
            // Convert to 18 decimals
            uint8 decimals = feed.decimals();
            uint256 scaledPrice = _scaleChainlinkPrice(uint256(uint256(answer)), decimals);
            return (scaledPrice, true);
        } catch {
            return (0, false);
        }
    }
    
    /// @notice Resolve price conflict using TWAP as tiebreaker
    function _resolvePriceConflict(
        string memory symbol,
        uint256 pythPrice,
        uint256 chainlinkPrice
    ) internal view returns (uint256) {
        TWAPData memory twap = twapData[symbol];
        
        // If no TWAP data, use median
        if (twap.sampleCount == 0) {
            return (pythPrice + chainlinkPrice) / 2;
        }
        
        uint256 currentTWAP = twap.cumulativePrice / twap.sampleCount;
        
        // Use the price closer to TWAP
        uint256 pythDiff = pythPrice > currentTWAP 
            ? pythPrice - currentTWAP 
            : currentTWAP - pythPrice;
        
        uint256 chainlinkDiff = chainlinkPrice > currentTWAP
            ? chainlinkPrice - currentTWAP
            : currentTWAP - chainlinkPrice;
        
        return pythDiff < chainlinkDiff ? pythPrice : chainlinkPrice;
    }
    
    /// @notice Validate price against TWAP
    function _validateAgainstTWAP(string memory symbol, uint256 price) internal view returns (bool) {
        TWAPData memory twap = twapData[symbol];
        
        // Skip check if not enough data
        if (twap.sampleCount < 3) return true;
        
        uint256 currentTWAP = twap.cumulativePrice / twap.sampleCount;
        uint256 deviation = _calculateDeviation(price, currentTWAP);
        
        // Price shouldn't deviate more than 30% from TWAP
        return deviation <= MAX_DEVIATION_BPS;
    }
    
    /// @notice Check for sudden price movements
    function _checkSuddenMovement(string memory symbol, uint256 newPrice) internal view returns (bool) {
        TWAPData memory twap = twapData[symbol];
        
        // Skip check if first update
        if (twap.lastUpdateTime == 0) return true;
        
        // Only check if last update was within TWAP window
        if (block.timestamp - twap.lastUpdateTime > TWAP_WINDOW) return true;
        
        uint256 deviation = _calculateDeviation(newPrice, twap.lastPrice);
        
        // Allow max 10% movement within 5 minutes
        return deviation <= SUDDEN_MOVE_THRESHOLD_BPS;
    }
    
    /// @notice Update TWAP data
    function _updateTWAP(string memory symbol, uint256 price) internal {
        TWAPData storage twap = twapData[symbol];
        
        // Reset TWAP if window expired
        if (block.timestamp - twap.lastUpdateTime > TWAP_WINDOW) {
            twap.cumulativePrice = price;
            twap.sampleCount = 1;
        } else {
            twap.cumulativePrice += price;
            twap.sampleCount++;
        }
        
        twap.lastPrice = price;
        twap.lastUpdateTime = block.timestamp;
        
        emit TWAPUpdated(symbol, twap.cumulativePrice / twap.sampleCount, price);
    }
    
    /// @notice Calculate percentage deviation between two prices
    function _calculateDeviation(uint256 price1, uint256 price2) internal pure returns (uint256) {
        if (price1 == price2) return 0;
        
        uint256 diff = price1 > price2 ? price1 - price2 : price2 - price1;
        uint256 avg = (price1 + price2) / 2;
        
        return (diff * 10000) / avg;
    }
    
    /// @notice Scale Pyth price to 18 decimals
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
    
    /// @notice Scale Chainlink price to 18 decimals
    function _scaleChainlinkPrice(uint256 price, uint8 decimals) internal pure returns (uint256) {
        if (decimals == 18) return price;
        
        if (decimals < 18) {
            return price * (10 ** (18 - decimals));
        } else {
            return price / (10 ** (decimals - 18));
        }
    }
    
    /// @notice Get current TWAP for a symbol
    function getTWAP(string memory symbol) external view returns (uint256) {
        TWAPData memory twap = twapData[symbol];
        require(twap.sampleCount > 0, "No TWAP data");
        return twap.cumulativePrice / twap.sampleCount;
    }
}