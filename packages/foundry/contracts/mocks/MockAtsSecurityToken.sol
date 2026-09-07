// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IAtsSecurityToken } from "../interfaces/IAtsSecurityToken.sol";

/// @notice Local stand-in for an ATS ERC-3643 equity token.
/// Agent (TradeLayer) can mint/burn; transfers require KYC and reject frozen
/// or paused state — same lifecycle surface we exercise on Hedera testnet.
contract MockAtsSecurityToken is ERC20, IAtsSecurityToken {
    address public owner;
    address public agent;
    bool public paused;

    mapping(address => bool) public kyc;
    mapping(address => bool) public frozen;
    mapping(address => uint256) public frozenAmount;

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier onlyAgent() {
        require(msg.sender == agent || msg.sender == owner, "Not agent");
        _;
    }

    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {
        owner = msg.sender;
        agent = msg.sender;
        // Owner is KYC'd so demo transfers from the issuer work immediately.
        kyc[msg.sender] = true;
    }

    function setAgent(address _agent) external onlyOwner {
        require(_agent != address(0), "bad agent");
        agent = _agent;
    }

    function mint(address to, uint256 amount) external override onlyAgent {
        require(kyc[to], "KYC required");
        require(!frozen[to], "frozen");
        require(!paused, "paused");
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external override onlyAgent {
        require(balanceOf(from) >= amount, "insufficient unfrozen balance");
        _burn(from, amount);
    }

    function freezePartialTokens(address account, uint256 amount) external override onlyAgent {
        require(amount > 0, "zero freeze");
        require(balanceOf(account) >= amount, "insufficient unfrozen balance");
        frozenAmount[account] += amount;
    }

    function unfreezePartialTokens(address account, uint256 amount) external override onlyAgent {
        require(frozenAmount[account] >= amount, "insufficient frozen balance");
        frozenAmount[account] -= amount;
    }

    function grantKyc(address account) external onlyOwner {
        kyc[account] = true;
    }

    function revokeKyc(address account) external onlyOwner {
        kyc[account] = false;
    }

    function isKyc(address account) external view returns (bool) {
        return kyc[account];
    }

    function setAddressFrozen(address account, bool _frozen) external onlyOwner {
        frozen[account] = _frozen;
    }

    function isFrozen(address account) external view returns (bool) {
        return frozen[account];
    }

    function pause() external onlyOwner {
        paused = true;
    }

    function unpause() external onlyOwner {
        paused = false;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        _complianceCheck(msg.sender, to, amount);
        return super.transfer(to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        _complianceCheck(from, to, amount);
        return super.transferFrom(from, to, amount);
    }

    function decimals() public pure override(ERC20, IAtsSecurityToken) returns (uint8) {
        return 0;
    }

    function name() public view override(ERC20, IAtsSecurityToken) returns (string memory) {
        return super.name();
    }

    function symbol() public view override(ERC20, IAtsSecurityToken) returns (string memory) {
        return super.symbol();
    }

    function totalSupply() public view override(ERC20, IAtsSecurityToken) returns (uint256) {
        return super.totalSupply();
    }

    function balanceOf(address account) public view override(ERC20, IAtsSecurityToken) returns (uint256) {
        return super.balanceOf(account) - frozenAmount[account];
    }

    function _complianceCheck(address from, address to, uint256 amount) internal view {
        require(!paused, "paused");
        require(kyc[from] && kyc[to], "KYC required");
        require(!frozen[from] && !frozen[to], "frozen");
        require(balanceOf(from) >= amount, "insufficient unfrozen balance");
    }
}
