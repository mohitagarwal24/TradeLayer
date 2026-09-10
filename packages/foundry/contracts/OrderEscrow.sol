// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";
import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import { EnclaveAuth } from "./EnclaveAuth.sol";
import { IConfidentialLedger } from "./interfaces/IConfidentialLedger.sol";
import { IOmnibusVault } from "./interfaces/IOmnibusVault.sol";
import { IOrgWalletRegistry } from "./interfaces/IOrgWalletRegistry.sol";
import { IHederaScheduleService } from "./interfaces/IHederaScheduleService.sol";

/// @notice Order state machine for sealed buy orders.
///
/// An employee opens an order against a sealed intent whose ciphertext hash (`commit`) anchors it
/// to exactly one envelope the enclave will later open. The chain sees an institution, an amount
/// and a deadline — never the symbol, quantity or limit.
///
/// The money is the **institution's**, not the employee's: opening an order draws USDC from the
/// omnibus pool, and every exit path returns it there. An employee is given authority by the
/// institution's private policy, never custody of its cash — the same separation a trading desk
/// runs on. The enclave enforces the limits; this contract only checks membership.
///
/// Every order leaves OPEN exactly once:
///   settle  — enclave-signed, atomic with the ledger write (shares credited ⇔ escrow released)
///   cancel  — enclave-signed, immediate return (policy rejection, broker rejection)
///   refund  — permissionless after `expiry`; also the target of the HIP-1215 scheduled call the
///             contract registers for itself, so an abandoned order unwinds with no keeper.
contract OrderEscrow is EnclaveAuth, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;
    using EnumerableSet for EnumerableSet.Bytes32Set;

    enum Status {
        NONE,
        OPEN,
        SETTLED,
        CANCELLED,
        REFUNDED
    }

    struct Order {
        address requester;
        bytes32 accountId;
        bytes32 orgId;
        uint256 amount;
        bytes32 commit;
        uint64 expiry;
        Status status;
        address schedule;
    }

    bytes32 public constant SETTLEMENT_TYPEHASH = keccak256(
        "Settlement(bytes32 orderId,uint256 spent,bytes32 enclaveBlobHash,bytes32 userBlobHash,uint64 expectedVersion)"
    );
    bytes32 public constant CANCEL_TYPEHASH = keccak256("Cancel(bytes32 orderId)");

    /// @dev Contract-level floor; the enclave enforces the product minimum so a fill has time to
    /// settle before the scheduled refund fires.
    uint64 public constant MIN_EXPIRY_WINDOW = 5 minutes;

    /// @dev The scheduled refund is registered for this long *after* `expiry`.
    ///
    /// Scheduling it exactly at `expiry` races this contract's own `block.timestamp < expiry`
    /// check. Hedera executes the scheduled call in the block at that second, but the EVM
    /// `block.timestamp` it sees can still be the previous second — so `refund` reverts
    /// `NotExpired` and the order stays open until someone calls it by hand. Observed on testnet:
    /// a schedule fired at expiry and came back CONTRACT_REVERT_EXECUTED, while the identical
    /// call seconds later succeeded. A small buffer removes the boundary entirely.
    uint64 public constant REFUND_SCHEDULE_BUFFER = 30 seconds;

    IConfidentialLedger public immutable ledger;
    IOmnibusVault public immutable vault;
    IOrgWalletRegistry public immutable registry;
    IERC20 public immutable usdc;
    /// @dev 0x16b on Hedera; address(0) disables scheduling.
    IHederaScheduleService public immutable scheduleService;

    uint256 public refundGasLimit = 300_000;
    mapping(bytes32 orderId => Order) private _orders;
    EnumerableSet.Bytes32Set private _open;

    event OrderOpened(
        bytes32 indexed orderId,
        address indexed requester,
        bytes32 indexed orgId,
        uint256 amount,
        bytes32 commit,
        uint64 expiry,
        address schedule
    );
    event ScheduleFailed(bytes32 indexed orderId, int64 responseCode);
    event OrderSettled(bytes32 indexed orderId, uint256 spent, uint256 returned, bytes32 digest);
    event OrderCancelled(bytes32 indexed orderId, uint256 returned, bytes32 digest);
    event OrderRefunded(bytes32 indexed orderId, uint256 returned);
    event RefundGasLimitUpdated(uint256 gasLimit);

    error OrderExists(bytes32 orderId);
    error OrderNotOpen(bytes32 orderId, Status status);
    error NotRegistered(address account);
    error ZeroAmount();
    error ZeroCommit();
    error ExpiryTooSoon(uint64 expiry, uint64 minimum);
    error SpentExceedsEscrow(uint256 spent, uint256 escrowed);
    error NotExpired(bytes32 orderId, uint64 expiry);

    constructor(
        address initialOwner,
        address signer,
        IConfidentialLedger ledger_,
        IOmnibusVault vault_,
        IOrgWalletRegistry registry_,
        IERC20 usdc_,
        IHederaScheduleService scheduleService_
    ) EnclaveAuth(initialOwner, signer) {
        if (
            address(ledger_) == address(0) || address(vault_) == address(0) || address(registry_) == address(0)
                || address(usdc_) == address(0)
        ) revert ZeroAddress();
        ledger = ledger_;
        vault = vault_;
        registry = registry_;
        usdc = usdc_;
        scheduleService = scheduleService_;
    }

    /// @dev Holds HBAR: on Hedera the scheduling contract pays for its own scheduled calls.
    receive() external payable { }

    /* ---------- admin ---------- */

    /// @notice Associate the escrow with an HTS token so it can hold in-flight order value. On
    /// Hedera only the account itself may associate, hence a function here. Uses the HIP-719
    /// facade; a token without it simply has no such function.
    function associate(address token) external onlyOwner {
        (bool ok, bytes memory ret) = token.call(abi.encodeWithSignature("associate()"));
        // 22 = SUCCESS, 194 = already associated.
        if (ok && ret.length >= 32) {
            uint256 rc = abi.decode(ret, (uint256));
            require(rc == 22 || rc == 194, "associate failed");
        }
    }

    function setRefundGasLimit(uint256 gasLimit) external onlyOwner {
        refundGasLimit = gasLimit;
        emit RefundGasLimitUpdated(gasLimit);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /* ---------- employee ---------- */

    /// @notice Open a buy against sealed intent `commit`, drawing `maxSpend` from the caller's
    /// institution. The only on-chain check is membership — whether this person may spend this
    /// much on this symbol is private, and the enclave decides it moments later, cancelling and
    /// returning the funds if not.
    function openBuy(bytes32 orderId, uint256 maxSpend, bytes32 commit, uint64 expiry)
        external
        whenNotPaused
        nonReentrant
    {
        if (_orders[orderId].status != Status.NONE) revert OrderExists(orderId);
        if (maxSpend == 0) revert ZeroAmount();
        if (commit == bytes32(0)) revert ZeroCommit();
        uint64 minimum = uint64(block.timestamp) + MIN_EXPIRY_WINDOW;
        if (expiry < minimum) revert ExpiryTooSoon(expiry, minimum);

        bytes32 orgId = registry.orgOf(msg.sender);
        if (orgId == bytes32(0)) revert NotRegistered(msg.sender);

        uint256 before = usdc.balanceOf(address(this));
        vault.fundEscrow(orderId, maxSpend);
        uint256 received = usdc.balanceOf(address(this)) - before;
        if (received == 0) revert ZeroAmount();

        Order storage o = _orders[orderId];
        o.requester = msg.sender;
        o.accountId = keccak256(abi.encodePacked(msg.sender));
        o.orgId = orgId;
        o.amount = received;
        o.commit = commit;
        o.expiry = expiry;
        o.status = Status.OPEN;
        _open.add(orderId);

        address schedule = _scheduleRefund(orderId, expiry);
        o.schedule = schedule;

        emit OrderOpened(orderId, msg.sender, orgId, received, commit, expiry, schedule);
    }

    /* ---------- enclave-signed ---------- */

    /// @notice Atomic fill settlement: credit the new encrypted portfolio and unwind the escrow
    /// in one transaction. All of it returns to the omnibus — `spent` is the part that bought
    /// shares, recorded so the reserve check can see it, and the rest rejoins the free pool.
    function settle(
        bytes32 orderId,
        uint256 spent,
        bytes calldata enclaveBlob,
        bytes calldata userBlob,
        uint64 expectedVersion,
        bytes calldata sig
    ) external nonReentrant whenNotPaused {
        Order storage o = _orders[orderId];
        if (o.status != Status.OPEN) revert OrderNotOpen(orderId, o.status);
        if (spent > o.amount) revert SpentExceedsEscrow(spent, o.amount);

        bytes32 structHash = keccak256(
            abi.encode(
                SETTLEMENT_TYPEHASH, orderId, spent, keccak256(enclaveBlob), keccak256(userBlob), expectedVersion
            )
        );
        bytes32 digest = _consume(structHash, sig);

        o.status = Status.SETTLED;
        _open.remove(orderId);

        ledger.applyUpdate(o.accountId, enclaveBlob, userBlob, expectedVersion);
        _returnToVault(orderId, o.amount, spent);

        emit OrderSettled(orderId, spent, o.amount - spent, digest);
    }

    /// @notice Enclave-decided rejection (policy check failed, broker rejected). Nothing spent.
    function cancel(bytes32 orderId, bytes calldata sig) external nonReentrant {
        Order storage o = _orders[orderId];
        if (o.status != Status.OPEN) revert OrderNotOpen(orderId, o.status);
        bytes32 digest = _consume(keccak256(abi.encode(CANCEL_TYPEHASH, orderId)), sig);

        o.status = Status.CANCELLED;
        _open.remove(orderId);
        _returnToVault(orderId, o.amount, 0);
        emit OrderCancelled(orderId, o.amount, digest);
    }

    /* ---------- permissionless ---------- */

    /// @notice Unwind an order that was never settled by its deadline. Anyone may call; the
    /// Hedera Schedule Service calls it automatically at `expiry` when scheduling succeeded.
    function refund(bytes32 orderId) external nonReentrant {
        Order storage o = _orders[orderId];
        if (o.status != Status.OPEN) revert OrderNotOpen(orderId, o.status);
        if (block.timestamp < o.expiry) revert NotExpired(orderId, o.expiry);

        o.status = Status.REFUNDED;
        _open.remove(orderId);
        _returnToVault(orderId, o.amount, 0);
        emit OrderRefunded(orderId, o.amount);
    }

    /* ---------- views ---------- */

    function order(bytes32 orderId) external view returns (Order memory) {
        return _orders[orderId];
    }

    function openCount() external view returns (uint256) {
        return _open.length();
    }

    function openAt(uint256 index) external view returns (bytes32) {
        return _open.at(index);
    }

    /// @notice Page of open order ids for the reconcile handler, which is stateless.
    function openOrders(uint256 start, uint256 count) external view returns (bytes32[] memory ids) {
        uint256 len = _open.length();
        if (start >= len) return ids;
        uint256 end = start + count;
        if (end > len) end = len;
        ids = new bytes32[](end - start);
        for (uint256 i = start; i < end; i++) {
            ids[i - start] = _open.at(i);
        }
    }

    /* ---------- internal ---------- */

    function _returnToVault(bytes32 orderId, uint256 amount, uint256 spent) internal {
        if (amount > 0) usdc.safeTransfer(address(vault), amount);
        vault.releaseEscrow(orderId, amount, spent);
    }

    function _scheduleRefund(bytes32 orderId, uint64 expiry) internal returns (address schedule) {
        if (address(scheduleService) == address(0)) return address(0);
        bytes memory callData = abi.encodeCall(this.refund, (orderId));
        uint64 fireAt = expiry + REFUND_SCHEDULE_BUFFER;
        if (!scheduleService.hasScheduleCapacity(fireAt, refundGasLimit)) {
            emit ScheduleFailed(orderId, 0);
            return address(0);
        }
        (int64 rc, address addr) = scheduleService.scheduleCall(address(this), fireAt, refundGasLimit, 0, callData);
        if (rc != 22 || addr == address(0)) {
            emit ScheduleFailed(orderId, rc);
            return address(0);
        }
        return addr;
    }
}
