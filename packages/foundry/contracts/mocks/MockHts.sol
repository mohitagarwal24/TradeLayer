// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { IHederaTokenService, HederaResponseCodes } from "../interfaces/IHederaTokenService.sol";

/// @notice Local stand-in for the HTS system contract at `0x167`.
///
/// TradeLayer issues no HTS token of its own, so the only thing the vault and escrow ever ask of
/// `0x167` is association — permission to hold Circle's USDC. Everything else the interface
/// declares exists for completeness and is unreachable from our contracts.
contract MockHts {
    mapping(address account => mapping(address token => bool)) public associated;

    event Associated(address indexed account, address indexed token);

    function associateToken(address account, address token) external returns (int64) {
        if (associated[account][token]) return HederaResponseCodes.TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT;
        associated[account][token] = true;
        emit Associated(account, token);
        return HederaResponseCodes.SUCCESS;
    }

    /// @dev Anything else a caller reaches for is a mistake we want to see loudly in tests.
    fallback() external payable {
        revert("MockHts: TradeLayer should only ever associate");
    }

    receive() external payable {
        revert("MockHts: not payable");
    }
}
