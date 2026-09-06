// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Minimal surface TradeLayer needs from an ATS / ERC-3643 security token.
/// Real Hedera deployments use Asset Tokenization Studio diamonds; local Anvil
/// uses MockAtsSecurityToken which implements the same agent mint/burn + KYC.
interface IAtsSecurityToken {
    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
    function decimals() external view returns (uint8);
    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);

    function mint(address to, uint256 amount) external;
    function burn(address from, uint256 amount) external;

    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);

    function grantKyc(address account) external;
    function revokeKyc(address account) external;
    function isKyc(address account) external view returns (bool);

    function setAddressFrozen(address account, bool frozen) external;
    function isFrozen(address account) external view returns (bool);

    function pause() external;
    function unpause() external;
    function paused() external view returns (bool);
}
