// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Exact ATS v8 surface used by TradeLayer.
/// ATS administration (roles, KYC and freeze) is deliberately kept out of this
/// interface because those operations are performed by the issuer through the
/// ATS SDK. The diamond exposes mint/burn to an account with AGENT_ROLE.
interface IAtsSecurityToken {
    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
    function decimals() external view returns (uint8);
    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);

    function mint(address to, uint256 amount) external;
    function burn(address from, uint256 amount) external;
    function freezePartialTokens(address account, uint256 amount) external;
    function unfreezePartialTokens(address account, uint256 amount) external;
}
