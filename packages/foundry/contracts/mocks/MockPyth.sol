// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {PythStructs} from "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";

/// @dev Local-dev stand-in for the Pyth oracle. Implements exactly the
/// surface TradeLayer touches. Never deploy this to anything real.
contract MockPyth {
    mapping(bytes32 => PythStructs.Price) private prices;

    event PriceSet(bytes32 indexed id, int64 price, int32 expo);

    function setPrice(bytes32 id, int64 price, int32 expo) external {
        require(price > 0, "MockPyth: bad price");
        prices[id] = PythStructs.Price({price: price, conf: 0, expo: expo, publishTime: block.timestamp});
        emit PriceSet(id, price, expo);
    }

    function getPrice(bytes32 id) external view returns (PythStructs.Price memory) {
        return _live(id);
    }

    function getPriceNoOlderThan(bytes32 id, uint256) external view returns (PythStructs.Price memory) {
        return _live(id);
    }

    function getUpdateFee(bytes[] calldata) external pure returns (uint256) {
        return 0;
    }

    function updatePriceFeeds(bytes[] calldata) external payable {}

    function _live(bytes32 id) internal view returns (PythStructs.Price memory p) {
        p = prices[id];
        require(p.price > 0, "MockPyth: price not set");
    }
}
