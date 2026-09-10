// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { EnclaveAuth } from "../../contracts/EnclaveAuth.sol";
import { ConfidentialLedger } from "../../contracts/ConfidentialLedger.sol";
import { OrderEscrow } from "../../contracts/OrderEscrow.sol";
import { OmnibusVault } from "../../contracts/OmnibusVault.sol";
import { ComplianceRouter } from "../../contracts/ComplianceRouter.sol";
import { MockUSDC } from "../../contracts/mocks/MockUSDC.sol";
import { MockAts } from "../../contracts/mocks/MockAts.sol";
import { MockScheduleService } from "../../contracts/mocks/MockScheduleService.sol";

/// @dev Stateful fuzz driver. Plays the institution admin, its employees and the enclave. Every
/// action either applies or returns early — with `fail_on_revert = true` any revert is a finding.
/// Ghost variables record what *should* be true so invariants compare intent with state.
contract Handler is Test {
    uint256 internal constant ENCLAVE_KEY = 0xE1C1A7E;
    bytes32 internal constant ORG = "FUZZ";

    ConfidentialLedger public ledger;
    OrderEscrow public escrow;
    OmnibusVault public vault;
    ComplianceRouter public router;
    MockUSDC public usdc;
    MockAts[] public equities;
    bytes32[] public symbols;
    MockScheduleService public hss;

    address[] public actors;
    bytes32[] public allOrders;
    bytes32[] internal _openIds;

    // ghosts
    uint256 public ghost_deposited;
    uint256 public ghost_spent;
    uint256 public ghost_paidOut;
    uint256 public ghost_openEscrow;
    mapping(bytes32 => uint256) public ghost_minted;
    mapping(bytes32 => uint256) public ghost_burned;
    mapping(bytes32 => uint256) public ghost_transferredOut;
    mapping(bytes32 => uint8) public ghost_terminalCount;
    mapping(bytes32 => uint64) public ghost_ledgerVersion;
    uint256 public ghost_scheduledRefundsFired;
    uint256 public transferNonce;

    /// @dev Struct hashes already signed. Every other action carries a strictly-increasing
    /// anti-replay field or is per-order and terminal; only the ATS batch pair can reproduce a
    /// digest, since `expectedSupply` moves back down after a burn. Re-signing an identical
    /// triple is exactly what EnclaveAuth rejects — the enclave would not do it either.
    mapping(bytes32 => bool) internal _authSigned;

    mapping(bytes32 => uint256) public calls;

    constructor(
        ConfidentialLedger ledger_,
        OrderEscrow escrow_,
        OmnibusVault vault_,
        ComplianceRouter router_,
        MockUSDC usdc_,
        MockAts[] memory equities_,
        bytes32[] memory symbols_,
        MockScheduleService hss_,
        address[] memory actors_
    ) {
        ledger = ledger_;
        escrow = escrow_;
        vault = vault_;
        router = router_;
        usdc = usdc_;
        equities = equities_;
        symbols = symbols_;
        hss = hss_;
        actors = actors_;
    }

    /* ---------- treasury ---------- */

    function deposit(uint256 amount) external {
        amount = bound(amount, 1e6, 50_000e6);
        if (usdc.balanceOf(address(this)) < amount) return;
        calls["deposit"]++;
        usdc.approve(address(vault), amount);
        vault.deposit(amount);
        ghost_deposited += amount;
    }

    /* ---------- orders ---------- */

    function openBuy(uint256 actorSeed, uint256 amount, uint256 ttl) external {
        address who = actors[actorSeed % actors.length];
        uint256 free = vault.available();
        if (free < 1e6) return;
        amount = bound(amount, 1e6, free);
        ttl = bound(ttl, escrow.MIN_EXPIRY_WINDOW(), 3 days);
        bytes32 orderId = keccak256(abi.encodePacked("order", allOrders.length, who));
        if (escrow.order(orderId).status != OrderEscrow.Status.NONE) return;

        calls["openBuy"]++;
        vm.prank(who);
        escrow.openBuy(orderId, amount, keccak256(abi.encodePacked("ct", orderId)), uint64(block.timestamp + ttl));
        allOrders.push(orderId);
        _openIds.push(orderId);
        ghost_openEscrow += amount;
    }

    function settle(uint256 idx, uint256 spent) external {
        if (_openIds.length == 0) return;
        idx = idx % _openIds.length;
        bytes32 orderId = _openIds[idx];
        OrderEscrow.Order memory o = escrow.order(orderId);
        if (o.status != OrderEscrow.Status.OPEN) return;
        spent = bound(spent, 0, o.amount);
        uint64 version = ledger.version(o.accountId);

        bytes memory eBlob = abi.encodePacked("e", orderId, version);
        bytes memory uBlob = abi.encodePacked("u", orderId, version);
        calls["settle"]++;
        bytes memory sig = _sign(escrow, _settlementHash(orderId, spent, eBlob, uBlob, version));
        escrow.settle(orderId, spent, eBlob, uBlob, version, sig);

        _removeOpen(idx);
        ghost_openEscrow -= o.amount;
        ghost_spent += spent;
        ghost_terminalCount[orderId]++;
        ghost_ledgerVersion[o.accountId] = version + 1;
    }

    function cancel(uint256 idx) external {
        if (_openIds.length == 0) return;
        idx = idx % _openIds.length;
        bytes32 orderId = _openIds[idx];
        OrderEscrow.Order memory o = escrow.order(orderId);
        if (o.status != OrderEscrow.Status.OPEN) return;
        calls["cancel"]++;
        escrow.cancel(orderId, _sign(escrow, keccak256(abi.encode(escrow.CANCEL_TYPEHASH(), orderId))));
        _removeOpen(idx);
        ghost_openEscrow -= o.amount;
        ghost_terminalCount[orderId]++;
    }

    function expireAndRefund(uint256 idx, bool viaSchedule) external {
        if (_openIds.length == 0) return;
        idx = idx % _openIds.length;
        bytes32 orderId = _openIds[idx];
        OrderEscrow.Order memory o = escrow.order(orderId);
        if (o.status != OrderEscrow.Status.OPEN) return;
        // The schedule fires a buffer *after* expiry (see OrderEscrow.REFUND_SCHEDULE_BUFFER),
        // so warp past that, not merely to expiry.
        uint64 due = viaSchedule && o.schedule != address(0)
            ? o.expiry + escrow.REFUND_SCHEDULE_BUFFER()
            : o.expiry;
        if (block.timestamp < due) vm.warp(due);

        calls["refund"]++;
        if (viaSchedule && o.schedule != address(0)) {
            hss.fireBySchedule(o.schedule);
            ghost_scheduledRefundsFired++;
        } else {
            escrow.refund(orderId);
        }
        _removeOpen(idx);
        ghost_openEscrow -= o.amount;
        ghost_terminalCount[orderId]++;
    }

    /* ---------- enclave ---------- */

    function ledgerUpdate(uint256 actorSeed) external {
        address who = actors[actorSeed % actors.length];
        bytes32 id = keccak256(abi.encodePacked(who));
        uint64 version = ledger.version(id);
        bytes memory eBlob = abi.encodePacked("open", id, version);
        bytes memory uBlob = abi.encodePacked("usr", id, version);
        calls["ledgerUpdate"]++;
        ledger.update(id, eBlob, uBlob, version, _sign(ledger, _ledgerHash(id, eBlob, uBlob, version)));
        ghost_ledgerVersion[id] = version + 1;
    }

    function mintAts(uint256 symSeed, uint256 amount) external {
        bytes32 sym = symbols[symSeed % symbols.length];
        amount = bound(amount, 1, 1_000);
        uint256 supply = vault.atsSupply(sym);
        bytes32 structHash = keccak256(abi.encode(vault.ATS_MINT_TYPEHASH(), sym, amount, supply));
        if (_authSigned[structHash]) return;
        _authSigned[structHash] = true;
        calls["mintAts"]++;
        vault.mintAts(sym, amount, supply, _sign(vault, structHash));
        ghost_minted[sym] += amount;
    }

    function burnAts(uint256 symSeed, uint256 amount) external {
        bytes32 sym = symbols[symSeed % symbols.length];
        MockAts token = equities[symSeed % symbols.length];
        uint256 held = token.balanceOf(address(vault));
        if (held == 0) return;
        amount = bound(amount, 1, held);
        uint256 supply = token.totalSupply();
        bytes32 structHash = keccak256(abi.encode(vault.ATS_BURN_TYPEHASH(), sym, amount, supply));
        if (_authSigned[structHash]) return;
        _authSigned[structHash] = true;
        calls["burnAts"]++;
        vault.burnAts(sym, amount, supply, _sign(vault, structHash));
        ghost_burned[sym] += amount;
    }

    function transferAts(uint256 symSeed, uint256 actorSeed, uint256 amount) external {
        bytes32 sym = symbols[symSeed % symbols.length];
        uint256 held = equities[symSeed % symbols.length].balanceOf(address(vault));
        if (held == 0) return;
        amount = bound(amount, 1, held);
        calls["transferAts"]++;
        // Split out: signing inline here overflows the stack.
        _withdrawShares(sym, actors[actorSeed % actors.length], amount);
        ghost_transferredOut[sym] += amount;
    }

    function _withdrawShares(bytes32 sym, address to, uint256 amount) internal {
        uint256 nonce = ++transferNonce;
        vault.transferAts(sym, to, amount, nonce, _sign(vault, _transferHash(sym, to, amount, nonce)));
    }

    function payout(uint256 actorSeed, uint256 amount) external {
        address to = actors[actorSeed % actors.length];
        uint256 free = vault.available();
        if (free == 0) return;
        amount = bound(amount, 1, free);
        uint256 nonce = ++transferNonce;
        calls["payout"]++;
        vault.payout(ORG, to, amount, nonce, _sign(vault, keccak256(abi.encode(vault.PAYOUT_TYPEHASH(), ORG, to, amount, nonce))));
        ghost_paidOut += amount;
    }

    /* ---------- views for invariants ---------- */

    function openCount() external view returns (uint256) {
        return _openIds.length;
    }

    function openId(uint256 i) external view returns (bytes32) {
        return _openIds[i];
    }

    function orderCount() external view returns (uint256) {
        return allOrders.length;
    }

    function actorCount() external view returns (uint256) {
        return actors.length;
    }

    /* ---------- internal ---------- */

    function _removeOpen(uint256 idx) internal {
        _openIds[idx] = _openIds[_openIds.length - 1];
        _openIds.pop();
    }

    function _digest(EnclaveAuth target, bytes32 structHash) internal view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", target.domainSeparator(), structHash));
    }

    function _sign(EnclaveAuth target, bytes32 structHash) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ENCLAVE_KEY, _digest(target, structHash));
        return abi.encodePacked(r, s, v);
    }

    function _ledgerHash(bytes32 id, bytes memory e, bytes memory u, uint64 version) internal view returns (bytes32) {
        return keccak256(abi.encode(ledger.LEDGER_UPDATE_TYPEHASH(), id, keccak256(e), keccak256(u), version));
    }

    function _settlementHash(bytes32 orderId, uint256 spent, bytes memory e, bytes memory u, uint64 version)
        internal
        view
        returns (bytes32)
    {
        return keccak256(abi.encode(escrow.SETTLEMENT_TYPEHASH(), orderId, spent, keccak256(e), keccak256(u), version));
    }

    function _transferHash(bytes32 sym, address to, uint256 amount, uint256 nonce) internal view returns (bytes32) {
        return keccak256(abi.encode(vault.ATS_TRANSFER_TYPEHASH(), sym, to, amount, nonce));
    }
}
