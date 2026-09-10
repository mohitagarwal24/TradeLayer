// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice The sliver of the Hedera Token Service system contract (`0x167`) TradeLayer uses.
///
/// Deliberately tiny. TradeLayer issues no HTS token of its own — settlement is Circle's USDC,
/// used as-is, over which we hold no supply, KYC or freeze keys. The only thing our contracts
/// ever ask of `0x167` is permission to hold that token. Compliance lives on the ATS equities
/// instead, administered through ComplianceRouter.
///
/// Response codes come back as return values, not reverts, so callers decode the first word.
interface IHederaTokenService {
    /// @notice Associate `account` with `token` so it may hold a balance.
    function associateToken(address account, address token) external returns (int64 responseCode);
}

library HederaResponseCodes {
    int64 internal constant UNKNOWN = 21;
    int64 internal constant SUCCESS = 22;
    int64 internal constant TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT = 194;
}
