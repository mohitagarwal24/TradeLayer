// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { EnclaveAuth } from "./EnclaveAuth.sol";
import { IConfidentialLedger } from "./interfaces/IConfidentialLedger.sol";

/// @notice On-chain store of encrypted portfolios and organization policies.
///
/// Each account has one entry: `enclaveBlob` is AES-256-GCM under a key only the enclave can
/// derive; `userBlob` is the same portfolio encrypted to the account's own derived public key so
/// the wallet can read its balance without the enclave. Nothing here is readable by the chain,
/// the relayer, or the operator. Version numbers give optimistic concurrency: two enclave runs
/// touching the same account cannot both land.
///
/// Writes arrive two ways: enclave-signed `update`/`setPolicy` (relayed by anyone), or
/// `applyUpdate` from OrderEscrow inside an atomic settlement whose signature the escrow already
/// verified — that path exists so a fill can never credit shares without releasing escrow, or
/// vice versa.
contract ConfidentialLedger is EnclaveAuth, IConfidentialLedger {
    struct Entry {
        bytes enclaveBlob;
        bytes userBlob;
        uint64 version;
        bytes32 blobHash;
    }

    struct Policy {
        bytes blob;
        uint64 version;
    }

    bytes32 public constant LEDGER_UPDATE_TYPEHASH = keccak256(
        "LedgerUpdate(bytes32 accountId,bytes32 enclaveBlobHash,bytes32 userBlobHash,uint64 expectedVersion)"
    );
    bytes32 public constant POLICY_UPDATE_TYPEHASH =
        keccak256("PolicyUpdate(bytes32 orgId,bytes32 policyBlobHash,uint64 expectedVersion)");

    address public escrow;
    mapping(bytes32 accountId => Entry) private _entries;
    mapping(bytes32 orgId => Policy) private _policies;

    event EscrowUpdated(address indexed previous, address indexed next);
    event EntryUpdated(bytes32 indexed accountId, uint64 indexed version, bytes32 blobHash, bytes32 digest);
    event PolicyUpdated(bytes32 indexed orgId, uint64 indexed version, bytes32 digest);

    error NotEscrow(address caller);
    error VersionMismatch(bytes32 id, uint64 expected, uint64 actual);
    error EmptyBlob();

    modifier onlyEscrow() {
        if (msg.sender != escrow) revert NotEscrow(msg.sender);
        _;
    }

    constructor(address initialOwner, address signer) EnclaveAuth(initialOwner, signer) { }

    function setEscrow(address next) external onlyOwner {
        if (next == address(0)) revert ZeroAddress();
        emit EscrowUpdated(escrow, next);
        escrow = next;
    }

    /* ---------- enclave-signed writes (anyone may relay) ---------- */

    /// @notice Record a new portfolio version. Used by H1 to note a placed order and by H2 for
    /// sell-side updates that move no escrow.
    function update(
        bytes32 accountId,
        bytes calldata enclaveBlob,
        bytes calldata userBlob,
        uint64 expectedVersion,
        bytes calldata sig
    ) external {
        bytes32 structHash = keccak256(
            abi.encode(LEDGER_UPDATE_TYPEHASH, accountId, keccak256(enclaveBlob), keccak256(userBlob), expectedVersion)
        );
        bytes32 digest = _consume(structHash, sig);
        _apply(accountId, enclaveBlob, userBlob, expectedVersion, digest);
    }

    /// @notice Write an organization's encrypted trading policy (who may trade, caps, restricted
    /// tickers). Submitted by the org admin as a sealed intent and written by the enclave.
    function setPolicy(bytes32 orgId, bytes calldata blob, uint64 expectedVersion, bytes calldata sig) external {
        if (blob.length == 0) revert EmptyBlob();
        bytes32 structHash = keccak256(abi.encode(POLICY_UPDATE_TYPEHASH, orgId, keccak256(blob), expectedVersion));
        bytes32 digest = _consume(structHash, sig);
        Policy storage p = _policies[orgId];
        if (p.version != expectedVersion) revert VersionMismatch(orgId, expectedVersion, p.version);
        p.blob = blob;
        p.version = expectedVersion + 1;
        emit PolicyUpdated(orgId, p.version, digest);
    }

    /* ---------- trusted path from OrderEscrow.settle ---------- */

    function applyUpdate(bytes32 accountId, bytes calldata enclaveBlob, bytes calldata userBlob, uint64 expectedVersion)
        external
        onlyEscrow
    {
        _apply(accountId, enclaveBlob, userBlob, expectedVersion, bytes32(0));
    }

    /* ---------- views ---------- */

    function entry(bytes32 accountId) external view returns (Entry memory) {
        return _entries[accountId];
    }

    function version(bytes32 accountId) external view returns (uint64) {
        return _entries[accountId].version;
    }

    function policy(bytes32 orgId) external view returns (Policy memory) {
        return _policies[orgId];
    }

    /// @notice Deterministic account id used everywhere: keccak256 of the wallet address.
    function accountIdOf(address account) external pure returns (bytes32) {
        return keccak256(abi.encodePacked(account));
    }

    /* ---------- internal ---------- */

    function _apply(
        bytes32 accountId,
        bytes calldata enclaveBlob,
        bytes calldata userBlob,
        uint64 expectedVersion,
        bytes32 digest
    ) internal {
        if (enclaveBlob.length == 0) revert EmptyBlob();
        Entry storage e = _entries[accountId];
        if (e.version != expectedVersion) revert VersionMismatch(accountId, expectedVersion, e.version);
        e.enclaveBlob = enclaveBlob;
        e.userBlob = userBlob;
        e.version = expectedVersion + 1;
        e.blobHash = keccak256(enclaveBlob);
        emit EntryUpdated(accountId, e.version, e.blobHash, digest);
    }
}
