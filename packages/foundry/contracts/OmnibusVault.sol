// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";
import { EnclaveAuth } from "./EnclaveAuth.sol";
import { IOmnibusVault } from "./interfaces/IOmnibusVault.sol";
import { IAtsSecurityToken } from "./interfaces/IAtsSecurityToken.sol";
import { IOrgWalletRegistry } from "./interfaces/IOrgWalletRegistry.sol";
import { IHederaTokenService, HederaResponseCodes } from "./interfaces/IHederaTokenService.sol";

/// @notice The omnibus account: one pooled USDC reserve and every equity token, held on behalf of
/// every institution at once — the same way a broker holds shares in street name.
///
/// There is deliberately **no per-institution token and no wrapped settlement token**. Cash is
/// Circle's USDC, held as a single undifferentiated pool; which institution owns how much of it
/// exists only as the encrypted `cash` field in `ConfidentialLedger`. A uniquely named or
/// per-institution balance would publish exactly what this product exists to hide.
///
/// Equities are ATS security tokens, one per symbol and shared across every institution. The
/// vault is their sole holder and mints or burns them in **net batches** (H3), so many unrelated
/// trades collapse into one number per symbol and no single institution's activity is separable.
contract OmnibusVault is EnclaveAuth, ReentrancyGuard, Pausable, IOmnibusVault {
    using SafeERC20 for IERC20;

    bytes32 public constant ATS_MINT_TYPEHASH = keccak256("AtsMint(bytes32 symbol,uint256 amount,uint256 expectedSupply)");
    bytes32 public constant ATS_BURN_TYPEHASH = keccak256("AtsBurn(bytes32 symbol,uint256 amount,uint256 expectedSupply)");
    bytes32 public constant ATS_TRANSFER_TYPEHASH =
        keccak256("AtsTransfer(bytes32 symbol,address to,uint256 amount,uint256 nonce)");
    bytes32 public constant PAYOUT_TYPEHASH = keccak256("Payout(bytes32 orgId,address to,uint256 amount,uint256 nonce)");

    /// @dev 0x167 on Hedera. Used only to associate this contract with HTS tokens (USDC); the
    /// vault creates no token of its own and holds no supply keys over anything.
    IHederaTokenService public immutable hts;
    IERC20 public immutable usdc;
    IOrgWalletRegistry public immutable registry;
    address public escrow;

    mapping(bytes32 symbol => IAtsSecurityToken) public atsToken;
    /// @dev In-flight order value currently sitting in the escrow, so `available()` can exclude it.
    uint256 public committed;

    event EscrowUpdated(address indexed previous, address indexed next);
    event AtsRegistered(bytes32 indexed symbol, address indexed token);
    event Deposited(bytes32 indexed orgId, address indexed from, uint256 amount);
    event EscrowFunded(bytes32 indexed orderId, uint256 amount);
    event EscrowReturned(bytes32 indexed orderId, uint256 amount, uint256 spent);
    event AtsMinted(bytes32 indexed symbol, uint256 amount, uint256 newSupply, bytes32 digest);
    event AtsBurned(bytes32 indexed symbol, uint256 amount, uint256 newSupply, bytes32 digest);
    event AtsTransferred(bytes32 indexed symbol, address indexed to, uint256 amount, bytes32 digest);
    event Paid(bytes32 indexed orgId, address indexed to, uint256 amount, bytes32 digest);

    error NotEscrow(address caller);
    error NotRegistered(address account);
    error UnknownSymbol(bytes32 symbol);
    error AlreadyRegistered();
    error SupplyMismatch(bytes32 symbol, uint256 expected, uint256 actual);
    error InsufficientReserve(uint256 requested, uint256 available);
    error ZeroAmount();
    error AmountOverflow(uint256 amount);
    /// @dev op: 0 associate
    error HtsCallFailed(uint8 op, int64 responseCode);

    modifier onlyEscrow() {
        if (msg.sender != escrow) revert NotEscrow(msg.sender);
        _;
    }

    constructor(
        address initialOwner,
        address signer,
        IHederaTokenService hts_,
        IERC20 usdc_,
        IOrgWalletRegistry registry_
    ) EnclaveAuth(initialOwner, signer) {
        if (address(hts_) == address(0) || address(usdc_) == address(0) || address(registry_) == address(0)) {
            revert ZeroAddress();
        }
        hts = hts_;
        usdc = usdc_;
        registry = registry_;
        // Deliberately no HTS call here: `forge script` simulates locally before broadcasting and
        // the system contract does not exist in that EVM, so a constructor touching 0x167 could
        // never be deployed by a script. Call `associate(usdc)` right after deployment.
    }

    receive() external payable { }

    /* ---------- platform admin ---------- */

    /// @notice Associate the vault with an HTS token so it can hold it. Idempotent.
    function associate(address token) external onlyOwner {
        bytes memory data = abi.encodeCall(IHederaTokenService.associateToken, (address(this), token));
        (bool ok, bytes memory ret) = address(hts).call(data);
        int64 rc = ok && ret.length >= 32 ? abi.decode(ret, (int64)) : HederaResponseCodes.UNKNOWN;
        if (rc != HederaResponseCodes.SUCCESS && rc != HederaResponseCodes.TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT) {
            revert HtsCallFailed(0, rc);
        }
    }

    function setEscrow(address next) external onlyOwner {
        if (next == address(0)) revert ZeroAddress();
        emit EscrowUpdated(escrow, next);
        escrow = next;
    }

    /// @notice Register an equity under its ticker (bytes32, e.g. "TSLA"). The vault must hold
    /// AGENT_ROLE, KYC and control-list membership on the diamond; ComplianceRouter administers
    /// everyone else's access to it.
    function registerAts(bytes32 symbol, IAtsSecurityToken token) external onlyOwner {
        if (address(token) == address(0)) revert ZeroAddress();
        if (address(atsToken[symbol]) != address(0)) revert AlreadyRegistered();
        atsToken[symbol] = token;
        emit AtsRegistered(symbol, address(token));
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /* ---------- institution treasury ---------- */

    /// @notice Fund your institution. The USDC joins the shared pool; the enclave credits the
    /// institution's encrypted cash balance from the event. Nothing on-chain records which
    /// institution holds how much.
    function deposit(uint256 amount) external nonReentrant whenNotPaused returns (bytes32 orgId) {
        if (amount == 0) revert ZeroAmount();
        orgId = registry.orgOf(msg.sender);
        if (orgId == bytes32(0)) revert NotRegistered(msg.sender);
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(orgId, msg.sender, amount);
    }

    /* ---------- escrow hooks ---------- */

    /// @notice Move an order's value out of the pool and into the escrow. The employee never
    /// holds company cash — they are given authority by the private policy, not custody.
    function fundEscrow(bytes32 orderId, uint256 amount) external onlyEscrow nonReentrant whenNotPaused {
        uint256 free = available();
        if (amount > free) revert InsufficientReserve(amount, free);
        committed += amount;
        usdc.safeTransfer(escrow, amount);
        emit EscrowFunded(orderId, amount);
    }

    /// @notice Called by the escrow after it has transferred `amount` back. `spent` is the part
    /// that bought shares — recorded for the reserve check, but the cash never left the vault.
    function releaseEscrow(bytes32 orderId, uint256 amount, uint256 spent) external onlyEscrow {
        committed -= amount;
        emit EscrowReturned(orderId, amount, spent);
    }

    /* ---------- enclave-signed ---------- */

    /// @notice Net batch mint from H3. Applies only if on-chain supply still equals what the
    /// enclave observed, so two overlapping batch runs cannot double-mint.
    function mintAts(bytes32 symbol, uint256 amount, uint256 expectedSupply, bytes calldata sig)
        external
        nonReentrant
        whenNotPaused
    {
        IAtsSecurityToken token = _ats(symbol);
        if (amount == 0) revert ZeroAmount();
        uint256 supply = token.totalSupply();
        if (supply != expectedSupply) revert SupplyMismatch(symbol, expectedSupply, supply);
        bytes32 digest = _consume(keccak256(abi.encode(ATS_MINT_TYPEHASH, symbol, amount, expectedSupply)), sig);
        token.mint(address(this), amount);
        emit AtsMinted(symbol, amount, supply + amount, digest);
    }

    function burnAts(bytes32 symbol, uint256 amount, uint256 expectedSupply, bytes calldata sig)
        external
        nonReentrant
        whenNotPaused
    {
        IAtsSecurityToken token = _ats(symbol);
        if (amount == 0) revert ZeroAmount();
        uint256 supply = token.totalSupply();
        if (supply != expectedSupply) revert SupplyMismatch(symbol, expectedSupply, supply);
        bytes32 digest = _consume(keccak256(abi.encode(ATS_BURN_TYPEHASH, symbol, amount, expectedSupply)), sig);
        token.burn(address(this), amount);
        emit AtsBurned(symbol, amount, supply - amount, digest);
    }

    /// @notice Share withdrawal: move equity from the omnibus to an employee's wallet. The
    /// diamond enforces KYC / control list / freeze on `to` — access ComplianceRouter granted.
    function transferAts(bytes32 symbol, address to, uint256 amount, uint256 nonce, bytes calldata sig)
        external
        nonReentrant
        whenNotPaused
    {
        IAtsSecurityToken token = _ats(symbol);
        if (amount == 0) revert ZeroAmount();
        bytes32 digest = _consume(keccak256(abi.encode(ATS_TRANSFER_TYPEHASH, symbol, to, amount, nonce)), sig);
        IERC20(address(token)).safeTransfer(to, amount);
        emit AtsTransferred(symbol, to, amount, digest);
    }

    /// @notice Cash-out of private proceeds: USDC out of the pool. The amount is public but
    /// disconnected from any specific trade.
    function payout(bytes32 orgId, address to, uint256 amount, uint256 nonce, bytes calldata sig)
        external
        nonReentrant
        whenNotPaused
    {
        if (amount == 0) revert ZeroAmount();
        uint256 free = available();
        if (amount > free) revert InsufficientReserve(amount, free);
        bytes32 digest = _consume(keccak256(abi.encode(PAYOUT_TYPEHASH, orgId, to, amount, nonce)), sig);
        usdc.safeTransfer(to, amount);
        emit Paid(orgId, to, amount, digest);
    }

    /* ---------- views ---------- */

    /// @notice Everything under management: the pool plus whatever is currently sitting in the
    /// escrow against open orders. Platform-wide by design — it is one omnibus pool.
    function reserve() external view returns (uint256) {
        return usdc.balanceOf(address(this)) + committed;
    }

    /// @notice The part of the reserve free to commit to a new order. Funding an escrow moves
    /// USDC out of this contract, so the balance already excludes in-flight orders.
    function available() public view returns (uint256) {
        return usdc.balanceOf(address(this));
    }

    function atsSupply(bytes32 symbol) external view returns (uint256) {
        return _ats(symbol).totalSupply();
    }

    /* ---------- internal ---------- */

    function _ats(bytes32 symbol) internal view returns (IAtsSecurityToken token) {
        token = atsToken[symbol];
        if (address(token) == address(0)) revert UnknownSymbol(symbol);
    }
}
