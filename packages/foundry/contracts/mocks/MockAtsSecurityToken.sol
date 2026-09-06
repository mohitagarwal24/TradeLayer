// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IAtsSecurityToken} from "../interfaces/IAtsSecurityToken.sol";

/// @notice Local stand-in for an ATS ERC-3643 equity token.
/// Agent (TradeLayer) can mint/burn; transfers require KYC and reject frozen
/// or paused state — same lifecycle surface we exercise on Hedera testnet.
contract MockAtsSecurityToken is ERC20, IAtsSecurityToken {
    address public owner;
    address public agent;
    bool public paused;

    mapping(address => bool) public kyc;
    mapping(address => bool) public frozen;

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
        _burn(from, amount);
    }

    function grantKyc(address account) external override onlyOwner {
        kyc[account] = true;
    }

    function revokeKyc(address account) external override onlyOwner {
        kyc[account] = false;
    }

    function isKyc(address account) external view override returns (bool) {
        return kyc[account];
    }

    function setAddressFrozen(address account, bool _frozen) external override onlyOwner {
        frozen[account] = _frozen;
    }

    function isFrozen(address account) external view override returns (bool) {
        return frozen[account];
    }

    function pause() external override onlyOwner {
        paused = true;
    }

    function unpause() external override onlyOwner {
        paused = false;
    }

    function transfer(address to, uint256 amount) public override(ERC20, IAtsSecurityToken) returns (bool) {
        _complianceCheck(msg.sender, to);
        return super.transfer(to, amount);
    }

    function transferFrom(address from, address to, uint256 amount)
        public
        override(ERC20, IAtsSecurityToken)
        returns (bool)
    {
        _complianceCheck(from, to);
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
        return super.balanceOf(account);
    }

    function _complianceCheck(address from, address to) internal view {
        require(!paused, "paused");
        require(kyc[from] && kyc[to], "KYC required");
        require(!frozen[from] && !frozen[to], "frozen");
    }
}
