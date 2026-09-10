// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

/// @notice The ATS v8 equity-diamond surface OmnibusVault touches.
/// The vault is the sole omnibus holder: it mints on net inflow, burns on net outflow, and
/// transfers to a KYC'd employee on share withdrawal. Compliance (KYC registry, control list,
/// freeze, pause) is enforced inside the diamond and administered by the issuer via the ATS
/// SDK — deliberately not part of this interface. `mint`/`burn` require AGENT_ROLE.
/// Note: `balanceOf` is the full balance (ERC-20 semantics); frozen amounts are separate.
interface IAtsSecurityToken is IERC20Metadata {
    function mint(address to, uint256 amount) external;
    function burn(address from, uint256 amount) external;
}
