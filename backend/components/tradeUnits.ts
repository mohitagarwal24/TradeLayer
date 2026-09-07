/** One DSTOCK receipt unit = $0.01 of deposited USDC value. */
export const USDC_PER_CENT = 10_000n; // USDC has 6 decimals
export const MIN_BUY_USDC = 1_000_000n; // $1.00 Alpaca notional floor
/** Share atoms: 1e9 atoms = 1 whole share (covers Alpaca's 9 decimal qty). */
export const SHARE_ATOMS_PER_SHARE = 1_000_000_000n;

export function usdcToReceiptUnits(usdcBaseUnits: bigint): number {
  if (usdcBaseUnits < 0n || usdcBaseUnits % USDC_PER_CENT !== 0n) {
    throw new Error("USDC amount must be whole cents");
  }
  const units = usdcBaseUnits / USDC_PER_CENT;
  if (units > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("receipt units overflow");
  return Number(units);
}

export function receiptUnitsToUsdc(units: number): bigint {
  if (!Number.isSafeInteger(units) || units <= 0) throw new Error("receipt units must be a positive integer");
  return BigInt(units) * USDC_PER_CENT;
}

export function sharesToAtoms(shares: number): bigint {
  if (!Number.isFinite(shares) || shares <= 0) throw new Error("share quantity must be positive");
  const atoms = BigInt(Math.round(shares * Number(SHARE_ATOMS_PER_SHARE)));
  if (atoms <= 0n) throw new Error("share quantity rounds to zero atoms");
  return atoms;
}

export function atomsToShares(atoms: bigint): number {
  if (atoms <= 0n) throw new Error("share atoms must be positive");
  return Number(atoms) / Number(SHARE_ATOMS_PER_SHARE);
}

/** Proportional share atoms for redeeming `redeemUnits` of `positionReceiptUnits`. */
export function proportionalShareAtoms(
  positionShareAtoms: bigint,
  positionReceiptUnits: number,
  redeemUnits: number,
): bigint {
  if (!Number.isSafeInteger(positionReceiptUnits) || positionReceiptUnits <= 0) {
    throw new Error("position receipt units must be positive");
  }
  if (!Number.isSafeInteger(redeemUnits) || redeemUnits <= 0 || redeemUnits > positionReceiptUnits) {
    throw new Error("redeem units out of range");
  }
  if (positionShareAtoms <= 0n) throw new Error("position has no shares");
  // Round down so we never sell more than held; dust stays with remaining units.
  return (positionShareAtoms * BigInt(redeemUnits)) / BigInt(positionReceiptUnits);
}
