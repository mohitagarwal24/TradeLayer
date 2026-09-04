// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import {IPyth} from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import {PythStructs} from "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";

/// @title PythOracle
/// @notice Oracle implementation using Pyth Network price feeds
contract PythOracle{
    IPyth public immutable pyth;
    bytes32 public immutable priceId; // Pyth price feed ID for the asset
    uint256 public immutable baseDecimals; // Decimals for price output (36 for our protocol)
    
    // Price staleness threshold (default: 60 seconds)
    uint256 public constant MAX_AGE = 3600;
    
    event PriceUpdated(int64 price, uint256 publishTime);
    
    /// @param _pyth Address of Pyth contract
    /// @param _priceId Pyth price feed ID (e.g., ETH/USD)
    /// @param _baseDecimals Output decimals (use 36 for our protocol)
    constructor(address _pyth, bytes32 _priceId, uint256 _baseDecimals) payable{
        require(_pyth != address(0), "Invalid Pyth address");
        pyth = IPyth(_pyth);
        priceId = _priceId;
        baseDecimals = _baseDecimals;
    }
    
    /// @notice Get the current price (must be called after updatePrice)
    /// @return price The current price scaled to baseDecimals (36 decimals)
    function price() external view returns (uint256) {
        PythStructs.Price memory pythPrice = pyth.getPriceNoOlderThan(priceId, MAX_AGE);
        
        require(pythPrice.price > 0, "Invalid price");
        
        // Pyth returns price with expo decimals
        // We need to convert to our baseDecimals (36)
        return _scalePrice(pythPrice.price, pythPrice.expo, int32(int256(baseDecimals)));
    }
    
    /// @notice Update the price feed (must be called before price())
    /// @param priceUpdate Price update data from Pyth API
    function updatePrice(bytes[] calldata priceUpdate) external payable {
        // Get the fee required for this update
        uint256 fee = pyth.getUpdateFee(priceUpdate);
        require(msg.value >= fee, "Insufficient fee");
        
        // Update the price feed
        pyth.updatePriceFeeds{value: fee}(priceUpdate);
        
        // Refund excess payment
        if (msg.value > fee) {
            (bool success, ) = msg.sender.call{value: msg.value - fee}("");
            require(success, "Refund failed");
        }
        
        // Get the updated price for logging
        PythStructs.Price memory pythPrice = pyth.getPriceNoOlderThan(priceId, MAX_AGE);
        emit PriceUpdated(pythPrice.price, pythPrice.publishTime);
    }
    
    /// @notice Get the latest price without age check (use with caution!)
    function getLatestPrice() external view returns (int64 price, uint256 publishTime) {
        PythStructs.Price memory pythPrice = pyth.getPriceNoOlderThan(priceId, MAX_AGE);
        return (pythPrice.price, pythPrice.publishTime);
    }
    
    /// @notice Scale price from Pyth decimals to target decimals
    function _scalePrice(int64 price, int32 expo, int32 targetDecimals) internal pure returns (uint256) {
        require(price > 0, "Negative price");
        
        // Convert price to uint256
        uint256 priceUint = uint256(uint64(price));
        
        // Calculate scaling factor
        // expo is negative (e.g., -8 for 8 decimals)
        // targetDecimals is positive (e.g., 36)
        int32 scalingExponent = targetDecimals + expo;
        
        if (scalingExponent >= 0) {
            // Scale up
            return priceUint * (10 ** uint32(scalingExponent));
        } else {
            // Scale down
            return priceUint / (10 ** uint32(-scalingExponent));
        }
    }
}