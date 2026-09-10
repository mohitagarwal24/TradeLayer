// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { BaseTest } from "./Base.t.sol";
import { ComplianceRouter } from "../contracts/ComplianceRouter.sol";
import { MockAts } from "../contracts/mocks/MockAts.sol";

/// @dev The router is the only path to KYC and freeze on the equities. Its reason to exist is the
/// last test group here: without it, one institution could freeze a competitor's employee.
contract ComplianceRouterTest is BaseTest {
    /* ---------- admitting your own people ---------- */

    function test_adminAdmitsOwnMemberAcrossEveryEquity() public {
        router.admitMember(alice);

        (bool kyc, bool listed, bool frozen) = router.statusOf(TSLA, alice);
        assertTrue(kyc, "KYC not granted on TSLA");
        assertTrue(listed, "not added to the control list on TSLA");
        assertFalse(frozen);

        (kyc, listed,) = router.statusOf(VOO, alice);
        assertTrue(kyc && listed, "the second equity was skipped");
    }

    function test_admitIsIdempotent() public {
        router.admitMember(alice);
        // The diamond reverts on a repeat grant, so the router must check before writing.
        router.admitMember(alice);
        (bool kyc, bool listed,) = router.statusOf(TSLA, alice);
        assertTrue(kyc && listed);
    }

    function test_revokeMemberWithdrawsAccess() public {
        router.admitMember(alice);
        router.revokeMember(alice);
        (bool kyc, bool listed,) = router.statusOf(TSLA, alice);
        assertFalse(kyc, "KYC should be revoked");
        assertFalse(listed, "should be off the control list");
    }

    function test_freezeAndUnfreezeOwnMember() public {
        router.admitMember(alice);
        router.setMemberFrozen(alice, true);
        (,, bool frozen) = router.statusOf(TSLA, alice);
        assertTrue(frozen);

        router.setMemberFrozen(alice, false);
        (,, frozen) = router.statusOf(TSLA, alice);
        assertFalse(frozen);
    }

    /* ---------- the attack this contract prevents ---------- */

    function test_rivalInstitutionCannotFreezeYourEmployee() public {
        router.admitMember(alice);
        vm.prank(rivalAdmin);
        vm.expectRevert(abi.encodeWithSelector(ComplianceRouter.NotYourWallet.selector, alice, ORG, RIVAL));
        router.setMemberFrozen(alice, true);

        (,, bool frozen) = router.statusOf(TSLA, alice);
        assertFalse(frozen, "a competitor froze our employee");
    }

    function test_rivalInstitutionCannotAdmitOrRevokeYourEmployee() public {
        vm.prank(rivalAdmin);
        vm.expectRevert(abi.encodeWithSelector(ComplianceRouter.NotYourWallet.selector, alice, ORG, RIVAL));
        router.admitMember(alice);

        router.admitMember(alice);
        vm.prank(rivalAdmin);
        vm.expectRevert(abi.encodeWithSelector(ComplianceRouter.NotYourWallet.selector, alice, ORG, RIVAL));
        router.revokeMember(alice);
        (bool kyc,,) = router.statusOf(TSLA, alice);
        assertTrue(kyc, "a competitor revoked our employee's access");
    }

    function test_nonAdminMemberCannotAdmitAnyone() public {
        vm.prank(alice); // a member of ACME, but not its admin
        vm.expectRevert(abi.encodeWithSelector(ComplianceRouter.NotOrgAdmin.selector, alice));
        router.admitMember(bob);
    }

    function test_strangerCannotAdmitAnyone() public {
        vm.prank(outsider);
        vm.expectRevert(abi.encodeWithSelector(ComplianceRouter.NotOrgAdmin.selector, outsider));
        router.admitMember(alice);
    }

    function test_cannotAdmitAWalletThatJoinedNoInstitution() public {
        vm.expectRevert(abi.encodeWithSelector(ComplianceRouter.NotYourWallet.selector, outsider, bytes32(0), ORG));
        router.admitMember(outsider);
    }

    function test_eachAdminAdmitsTheirOwnPeopleIndependently() public {
        router.admitMember(alice);
        vm.prank(rivalAdmin);
        router.admitMember(rivalStaff);

        (bool aliceKyc,,) = router.statusOf(TSLA, alice);
        (bool rivalKyc,,) = router.statusOf(TSLA, rivalStaff);
        assertTrue(aliceKyc && rivalKyc, "both institutions should manage their own staff");
    }

    /* ---------- platform emergency path ---------- */

    function test_emergencyFreezeIsOwnerOnlyAndIgnoresOwnership() public {
        router.admitMember(alice);
        // Deliberately not gated on ownership: sanctions are not the institution's call.
        router.emergencyFreeze(alice, "court order 1234");
        (,, bool frozen) = router.statusOf(TSLA, alice);
        assertTrue(frozen);
    }

    function test_institutionAdminCannotUseTheEmergencyPath() public {
        vm.prank(rivalAdmin);
        vm.expectRevert();
        router.emergencyFreeze(alice, "nice try");
    }

    /* ---------- wiring ---------- */

    function test_grantKycFailsIfTheIssuerIsNotRegisteredOnTheDiamond() public {
        // The `issuer` argument must be a registered SSI issuer — the constraint most easily
        // missed when wiring a new deployment, so it is asserted here rather than discovered live.
        router.setAtsIssuer(makeAddr("unregistered-issuer"));
        vm.expectRevert(abi.encodeWithSelector(MockAts.AccountIsNotIssuer.selector, makeAddr("unregistered-issuer")));
        router.admitMember(alice);
    }

    function test_registerTokenIsOwnerOnlyAndRejectsDuplicates() public {
        vm.prank(alice);
        vm.expectRevert();
        router.registerToken(bytes32("NEW"), tsla);

        vm.expectRevert(abi.encodeWithSelector(ComplianceRouter.AlreadyRegistered.selector, TSLA));
        router.registerToken(TSLA, tsla);
    }

    function test_symbolsAreEnumerable() public view {
        bytes32[] memory s = router.symbols();
        assertEq(s.length, 2);
        assertEq(router.symbolCount(), 2);
    }

    function test_statusOfUnknownSymbolReverts() public {
        vm.expectRevert(abi.encodeWithSelector(ComplianceRouter.UnknownSymbol.selector, bytes32("NOPE")));
        router.statusOf(bytes32("NOPE"), alice);
    }
}
