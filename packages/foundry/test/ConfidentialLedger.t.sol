// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { BaseTest } from "./Base.t.sol";
import { EnclaveAuth } from "../contracts/EnclaveAuth.sol";
import { ConfidentialLedger } from "../contracts/ConfidentialLedger.sol";

contract ConfidentialLedgerTest is BaseTest {
    bytes internal constant E1 = hex"01020304";
    bytes internal constant U1 = hex"0a0b0c0d";
    bytes internal constant E2 = hex"11121314";
    bytes internal constant U2 = hex"1a1b1c1d";

    function test_updateWritesEntryAndBumpsVersion() public {
        bytes32 id = _accountId(alice);
        ledger.update(id, E1, U1, 0, _sign(ledger, _ledgerUpdateHash(id, E1, U1, 0)));

        ConfidentialLedger.Entry memory e = ledger.entry(id);
        assertEq(e.version, 1);
        assertEq(e.enclaveBlob, E1);
        assertEq(e.userBlob, U1);
        assertEq(e.blobHash, keccak256(E1));
        assertEq(ledger.version(id), 1);
    }

    function test_versionMustMatch() public {
        bytes32 id = _accountId(alice);
        ledger.update(id, E1, U1, 0, _sign(ledger, _ledgerUpdateHash(id, E1, U1, 0)));

        bytes memory stale = _sign(ledger, _ledgerUpdateHash(id, E2, U2, 0));
        vm.expectRevert(abi.encodeWithSelector(ConfidentialLedger.VersionMismatch.selector, id, 0, 1));
        ledger.update(id, E2, U2, 0, stale);

        ledger.update(id, E2, U2, 1, _sign(ledger, _ledgerUpdateHash(id, E2, U2, 1)));
        assertEq(ledger.version(id), 2);
    }

    function test_replayRejected() public {
        bytes32 id = _accountId(alice);
        bytes32 structHash = _ledgerUpdateHash(id, E1, U1, 0);
        bytes memory sig = _sign(ledger, structHash);
        bytes32 digest = _digest(ledger, structHash);
        ledger.update(id, E1, U1, 0, sig);
        // The digest is consumed before any state check, so a replay is rejected as such.
        vm.expectRevert(abi.encodeWithSelector(EnclaveAuth.DigestAlreadyUsed.selector, digest));
        ledger.update(id, E1, U1, 0, sig);
        assertTrue(ledger.usedDigest(digest));
    }

    function test_wrongSignerRejected() public {
        bytes32 id = _accountId(alice);
        bytes memory sig = _signWith(ROGUE_KEY, ledger, _ledgerUpdateHash(id, E1, U1, 0));
        vm.expectRevert(abi.encodeWithSelector(EnclaveAuth.InvalidEnclaveSignature.selector, vm.addr(ROGUE_KEY)));
        ledger.update(id, E1, U1, 0, sig);
    }

    function test_signatureBoundToBlobContents() public {
        bytes32 id = _accountId(alice);
        bytes memory sig = _sign(ledger, _ledgerUpdateHash(id, E1, U1, 0));
        // Relayer swaps the blob: recovered signer no longer matches.
        vm.expectRevert();
        ledger.update(id, E2, U1, 0, sig);
    }

    function test_applyUpdateOnlyEscrow() public {
        bytes32 id = _accountId(alice);
        vm.expectRevert(abi.encodeWithSelector(ConfidentialLedger.NotEscrow.selector, address(this)));
        ledger.applyUpdate(id, E1, U1, 0);

        vm.prank(address(escrow));
        ledger.applyUpdate(id, E1, U1, 0);
        assertEq(ledger.version(id), 1);
    }

    function test_emptyEnclaveBlobRejected() public {
        bytes32 id = _accountId(alice);
        bytes memory sig = _sign(ledger, _ledgerUpdateHash(id, "", U1, 0));
        vm.expectRevert(ConfidentialLedger.EmptyBlob.selector);
        ledger.update(id, "", U1, 0, sig);
    }

    function test_setPolicyVersioned() public {
        bytes memory p1 = hex"aa";
        bytes memory p2 = hex"bb";
        ledger.setPolicy(ORG, p1, 0, _sign(ledger, keccak256(abi.encode(ledger.POLICY_UPDATE_TYPEHASH(), ORG, keccak256(p1), 0))));
        assertEq(ledger.policy(ORG).version, 1);
        assertEq(ledger.policy(ORG).blob, p1);

        bytes memory stale = _sign(ledger, keccak256(abi.encode(ledger.POLICY_UPDATE_TYPEHASH(), ORG, keccak256(p2), 0)));
        vm.expectRevert(abi.encodeWithSelector(ConfidentialLedger.VersionMismatch.selector, ORG, 0, 1));
        ledger.setPolicy(ORG, p2, 0, stale);
    }

    function test_signerRotationInvalidatesOldKey() public {
        uint256 nextKey = 0xC0FFEE;
        ledger.setEnclaveSigner(vm.addr(nextKey));
        bytes32 id = _accountId(alice);

        bytes memory old = _sign(ledger, _ledgerUpdateHash(id, E1, U1, 0));
        vm.expectRevert(abi.encodeWithSelector(EnclaveAuth.InvalidEnclaveSignature.selector, enclave));
        ledger.update(id, E1, U1, 0, old);

        ledger.update(id, E1, U1, 0, _signWith(nextKey, ledger, _ledgerUpdateHash(id, E1, U1, 0)));
        assertEq(ledger.version(id), 1);
    }

    function test_accountIdOf() public view {
        assertEq(ledger.accountIdOf(alice), keccak256(abi.encodePacked(alice)));
    }
}
