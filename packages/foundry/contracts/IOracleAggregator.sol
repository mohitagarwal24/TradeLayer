interface IOracleAggregator {
    function getValidatedPrice(
        string memory symbol,
        bytes[] calldata pythPriceUpdate
    ) external payable returns (uint256);
    
    function getTWAP(string memory symbol) external view returns (uint256);
}