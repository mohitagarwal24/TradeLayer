// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import { Ownable, Ownable2Step } from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @notice Shared authorization for state changes decided inside the Chainlink Confidential
/// Workflow (TEE). The enclave signs an EIP-712 struct; anyone may relay it; the contract
/// verifies the signer and consumes the digest. A relayer can therefore censor, but never forge.
///
/// Domain: name "TradeLayer", version "1", chainId, verifyingContract — so a signature for one
/// contract or chain is meaningless on another. Every struct is single-use: either it carries a
/// field that changes on apply (expectedVersion / expectedSupply / orderId) or an explicit nonce,
/// and `usedDigest` rejects any exact replay regardless.
abstract contract EnclaveAuth is EIP712, Ownable2Step {
    address public enclaveSigner;
    mapping(bytes32 digest => bool) public usedDigest;

    event EnclaveSignerUpdated(address indexed previous, address indexed next);

    error ZeroAddress();
    error InvalidEnclaveSignature(address recovered);
    error DigestAlreadyUsed(bytes32 digest);

    constructor(address initialOwner, address signer) EIP712("TradeLayer", "1") Ownable(initialOwner) {
        if (signer == address(0)) revert ZeroAddress();
        enclaveSigner = signer;
        emit EnclaveSignerUpdated(address(0), signer);
    }

    /// @notice Rotate the enclave signing key (e.g. after a key ceremony or enclave rebuild).
    function setEnclaveSigner(address next) external onlyOwner {
        if (next == address(0)) revert ZeroAddress();
        emit EnclaveSignerUpdated(enclaveSigner, next);
        enclaveSigner = next;
    }

    /// @notice EIP-712 domain separator, exposed so off-chain signers can cross-check.
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    /// @dev Verify `sig` over `structHash` and mark the digest consumed. Reverts on bad signer
    /// or replay. Returns the digest for event emission.
    function _consume(bytes32 structHash, bytes calldata sig) internal returns (bytes32 digest) {
        digest = _hashTypedDataV4(structHash);
        if (usedDigest[digest]) revert DigestAlreadyUsed(digest);
        address recovered = ECDSA.recover(digest, sig);
        if (recovered != enclaveSigner) revert InvalidEnclaveSignature(recovered);
        usedDigest[digest] = true;
    }
}
