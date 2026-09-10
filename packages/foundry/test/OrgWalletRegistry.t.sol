// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { BaseTest } from "./Base.t.sol";
import { OrgWalletRegistry } from "../contracts/OrgWalletRegistry.sol";

/// @dev Membership is the one public fact about a wallet, and it takes two signatures to create.
/// These tests exist because the whole compliance story rests on it being unforgeable.
contract OrgWalletRegistryTest is BaseTest {
    address internal newcomer;

    function setUp() public override {
        super.setUp();
        newcomer = makeAddr("newcomer");
    }

    /* ---------- registration ---------- */

    function test_registerOrgBindsTheCallerAsAdminAndMember() public {
        address founder = makeAddr("founder");
        vm.prank(founder);
        registry.registerOrg(bytes32("NEWCO"));

        assertEq(registry.adminOf(bytes32("NEWCO")), founder);
        assertEq(registry.orgOf(founder), bytes32("NEWCO"), "the founder is a member of their own org");
        assertTrue(registry.isOrgAdmin(founder));
        assertEq(registry.walletCountOf(bytes32("NEWCO")), 1);
    }

    function test_registerOrgRejectsDuplicatesReservedAndEmptyIds() public {
        bytes32 platform = registry.PLATFORM();

        vm.prank(makeAddr("squatter"));
        vm.expectRevert(abi.encodeWithSelector(OrgWalletRegistry.OrgExists.selector, ORG));
        registry.registerOrg(ORG);

        vm.prank(makeAddr("squatter2"));
        vm.expectRevert(OrgWalletRegistry.ReservedOrgId.selector);
        registry.registerOrg(platform);

        vm.prank(makeAddr("squatter3"));
        vm.expectRevert(OrgWalletRegistry.ZeroOrgId.selector);
        registry.registerOrg(bytes32(0));
    }

    function test_oneWalletCannotRunTwoInstitutions() public {
        vm.expectRevert(abi.encodeWithSelector(OrgWalletRegistry.AlreadyBound.selector, address(this), ORG));
        registry.registerOrg(bytes32("SECOND"));
    }

    /* ---------- mutual consent ---------- */

    function test_proposeAloneDoesNotBind() public {
        vm.prank(newcomer);
        registry.proposeJoin(ORG);

        assertEq(registry.orgOf(newcomer), bytes32(0), "a proposal must not bind anything on its own");
        (bool pending, bytes32 orgId) = registry.pendingJoin(newcomer);
        assertTrue(pending);
        assertEq(orgId, ORG);
    }

    function test_approveAloneIsImpossible() public {
        vm.expectRevert(abi.encodeWithSelector(OrgWalletRegistry.NoProposalFrom.selector, newcomer));
        registry.approveJoin(newcomer);
    }

    function test_bothHalvesBind() public {
        vm.prank(newcomer);
        registry.proposeJoin(ORG);
        registry.approveJoin(newcomer);

        assertEq(registry.orgOf(newcomer), ORG);
        (bool pending,) = registry.pendingJoin(newcomer);
        assertFalse(pending, "the request is no longer pending once approved");
    }

    /// @dev The attack the registry exists to stop: an institution cannot claim a wallet it does
    /// not control, because binding requires that wallet's own signature first.
    function test_rivalInstitutionCannotClaimAnotherOrgsProposer() public {
        vm.prank(newcomer);
        registry.proposeJoin(ORG);

        vm.prank(rivalAdmin);
        vm.expectRevert(abi.encodeWithSelector(OrgWalletRegistry.NotOrgAdmin.selector, ORG, rivalAdmin));
        registry.approveJoin(newcomer);

        assertEq(registry.orgOf(newcomer), bytes32(0));
    }

    function test_nonAdminMemberCannotApprove() public {
        vm.prank(newcomer);
        registry.proposeJoin(ORG);
        vm.prank(alice); // a member, but not the admin
        vm.expectRevert(abi.encodeWithSelector(OrgWalletRegistry.NotOrgAdmin.selector, ORG, alice));
        registry.approveJoin(newcomer);
    }

    function test_proposeToUnknownOrgReverts() public {
        vm.prank(newcomer);
        vm.expectRevert(abi.encodeWithSelector(OrgWalletRegistry.UnknownOrg.selector, bytes32("GHOST")));
        registry.proposeJoin(bytes32("GHOST"));
    }

    function test_alreadyBoundWalletCannotBeRebound() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(OrgWalletRegistry.AlreadyBound.selector, alice, ORG));
        registry.proposeJoin(RIVAL);
    }

    /* ---------- leaving ---------- */

    function test_revokeMembershipRemovesTheWallet() public {
        uint256 before = registry.walletCountOf(ORG);
        registry.revokeMembership(alice);
        assertEq(registry.orgOf(alice), bytes32(0));
        assertEq(registry.walletCountOf(ORG), before - 1);

        // …and they can then join somewhere else.
        vm.prank(alice);
        registry.proposeJoin(RIVAL);
        vm.prank(rivalAdmin);
        registry.approveJoin(alice);
        assertEq(registry.orgOf(alice), RIVAL);
    }

    function test_rivalCannotRevokeAnotherOrgsMember() public {
        vm.prank(rivalAdmin);
        vm.expectRevert(abi.encodeWithSelector(OrgWalletRegistry.NotOrgAdmin.selector, ORG, rivalAdmin));
        registry.revokeMembership(alice);
        assertEq(registry.orgOf(alice), ORG);
    }

    function test_adminCannotRevokeThemselves() public {
        vm.expectRevert(abi.encodeWithSelector(OrgWalletRegistry.NotOrgAdmin.selector, ORG, address(this)));
        registry.revokeMembership(address(this));
    }

    /* ---------- handover ---------- */

    function test_transferOrgAdminRequiresAnExistingMember() public {
        vm.expectRevert(
            abi.encodeWithSelector(OrgWalletRegistry.ProposalForDifferentOrg.selector, outsider, bytes32(0), ORG)
        );
        registry.transferOrgAdmin(ORG, outsider);

        registry.transferOrgAdmin(ORG, alice);
        assertEq(registry.adminOf(ORG), alice);
        assertTrue(registry.isOrgAdmin(alice));
        assertFalse(registry.isOrgAdmin(address(this)));
    }

    /* ---------- platform accounts ---------- */

    function test_platformAccountsAreBoundWithoutConsent() public view {
        assertEq(registry.orgOf(address(vault)), registry.PLATFORM());
        assertEq(registry.orgOf(address(escrow)), registry.PLATFORM());
    }

    function test_onlyOwnerBindsPlatformAccounts() public {
        vm.prank(alice);
        vm.expectRevert();
        registry.bindPlatformAccount(makeAddr("rogue-infra"));
    }
}
