/**
 * Lifecycle demo against a deployed ATS / MockAts security token:
 *   grant KYC → mint (as agent) → compliance-checked transfer → freeze check.
 *
 * Works on Anvil (MockAtsSecurityToken) and Hedera testnet (ATS diamond that
 * exposes the same agent surface). This is the "lifecycle operation" required
 * by the Hedera Tokenization prize.
 *
 * Env:
 *   RPC_URL          default http://127.0.0.1:8545
 *   PRIVATE_KEY      issuer / agent key
 *   ATS_DSTOCK       security token address
 *   DEMO_RECIPIENT   address to KYC + receive a transfer (optional)
 */
import "dotenv/config";
import { Contract, JsonRpcProvider, Wallet, parseUnits } from "ethers";
import { ATS_SECURITY_ABI } from "./config.js";

async function main() {
  const rpc = process.env.RPC_URL ?? "http://127.0.0.1:8545";
  const pk = process.env.PRIVATE_KEY;
  const tokenAddr = process.env.ATS_DSTOCK;
  if (!pk || !tokenAddr) {
    throw new Error("Set PRIVATE_KEY and ATS_DSTOCK in the environment");
  }

  const provider = new JsonRpcProvider(rpc);
  const wallet = new Wallet(pk.startsWith("0x") ? pk : `0x${pk}`, provider);
  const token = new Contract(tokenAddr, ATS_SECURITY_ABI, wallet);

  const name = await token.name();
  const symbol = await token.symbol();
  console.log(`Token ${name} (${symbol}) at ${tokenAddr}`);
  console.log(`Issuer/agent: ${wallet.address}`);

  const recipient = process.env.DEMO_RECIPIENT ?? Wallet.createRandom().address;
  console.log(`\n1. Grant KYC → ${recipient}`);
  await (await token.grantKyc(recipient)).wait();
  console.log("   isKyc:", await token.isKyc(recipient));

  if (!(await token.isKyc(wallet.address))) {
    console.log("2. Grant KYC → issuer");
    await (await token.grantKyc(wallet.address)).wait();
  }

  const mintAmount = 10n;
  console.log(`\n3. Mint ${mintAmount} to issuer (agent/owner role)`);
  try {
    await (await token.mint(wallet.address, mintAmount)).wait();
  } catch (err) {
    console.warn("   mint skipped/failed:", (err as Error).message.split("\n")[0]);
  }
  console.log("   issuer balance:", (await token.balanceOf(wallet.address)).toString());

  console.log(`\n4. Compliance transfer 1 ${symbol} → recipient`);
  await (await token.transfer(recipient, 1n)).wait();
  console.log("   recipient balance:", (await token.balanceOf(recipient)).toString());

  console.log("\n5. Freeze recipient, assert transfer reverts, then unfreeze");
  await (await token.setAddressFrozen(recipient, true)).wait();
  let blocked = false;
  try {
    // Force a fresh estimate so a revert surfaces cleanly.
    await token.transfer.staticCall(recipient, 1n);
  } catch {
    blocked = true;
  }
  console.log("   transfer while frozen blocked:", blocked);
  await (await token.setAddressFrozen(recipient, false)).wait();

  console.log("\nLifecycle demo complete — KYC grant + transfer + freeze exercised.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
