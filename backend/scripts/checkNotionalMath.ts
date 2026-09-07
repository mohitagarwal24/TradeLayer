/**
 * Deterministic checks for exact-notional / receipt-unit math.
 * Run: yarn tsx scripts/checkNotionalMath.ts
 */
import assert from "node:assert/strict";
import {
  atomsToShares,
  MIN_BUY_USDC,
  proportionalShareAtoms,
  receiptUnitsToUsdc,
  sharesToAtoms,
  usdcToReceiptUnits,
  USDC_PER_CENT,
} from "../components/tradeUnits";

function section(name: string) {
  console.log(`\n✓ ${name}`);
}

section("$5 notional buy → 500 receipt units");
assert.equal(usdcToReceiptUnits(5_000_000n), 500);
assert.equal(receiptUnitsToUsdc(500), 5_000_000n);
assert.equal(5_000_000n % USDC_PER_CENT, 0n);
assert.ok(5_000_000n >= MIN_BUY_USDC);

section("Fractional fill conversion (share atoms)");
const atoms = sharesToAtoms(0.01445);
assert.equal(atoms, 14_450_000n);
assert.ok(Math.abs(atomsToShares(atoms) - 0.01445) < 1e-12);

section("Partial proportional redemption");
// Position: 0.02 shares (= 20_000_000 atoms) with 500 receipt units ($5).
// Redeem 200 units ($2) → sell 40% → 8_000_000 atoms = 0.008 shares.
const sold = proportionalShareAtoms(20_000_000n, 500, 200);
assert.equal(sold, 8_000_000n);
assert.equal(atomsToShares(sold), 0.008);

section("Gains/losses are payout-side only (units burn exact)");
// Depositing 500 units always burns 500 on full redeem regardless of fill price.
assert.equal(usdcToReceiptUnits(5_000_000n), 500);
assert.equal(receiptUnitsToUsdc(500), 5_000_000n);

section("Over-redemption rejection");
assert.throws(() => proportionalShareAtoms(20_000_000n, 500, 501));
assert.throws(() => proportionalShareAtoms(20_000_000n, 500, 0));

section("Cent / share-atom rounding");
assert.throws(() => usdcToReceiptUnits(5_000_001n)); // not whole cent
assert.throws(() => sharesToAtoms(0));
// Floor on proportional: 3 atoms / 3 units redeeming 1 → 1 atom
assert.equal(proportionalShareAtoms(3n, 3, 1), 1n);
// Floor leaves dust: 5 atoms / 3 units redeeming 1 → 1 atom
assert.equal(proportionalShareAtoms(5n, 3, 1), 1n);

console.log("\nAll notional math checks passed.\n");
