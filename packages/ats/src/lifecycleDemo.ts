/**
 * Lifecycle demo against a deployed ATS / MockAts security token:
 *   verify real KYC → mint → compliance-checked transfer → freeze check.
 *
 * Env:
 *   RPC_URL          default Hedera testnet Hashio
 *   PRIVATE_KEY      issuer / agent key
 *   ATS_DSTOCK       security token address
 *   DEMO_RECIPIENT   previously KYC-approved recipient address
 */
import "dotenv/config";
import { Contract, JsonRpcProvider, Wallet } from "ethers";
import { ATS_SECURITY_ABI } from "./config.js";

async function main() {
  const rpc = process.env.RPC_URL ?? "https://testnet.hashio.io/api";
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

  const recipient = process.env.DEMO_RECIPIENT;
  if (!recipient) throw new Error("Set DEMO_RECIPIENT to a real ATS KYC-approved account");

  console.log(`\n1. Verify ATS KYC for issuer and recipient ${recipient}`);
  const issuerKyc = Number(await token.getKycStatusFor(wallet.address));
  const recipientKyc = Number(await token.getKycStatusFor(recipient));
  if (issuerKyc !== 1 || recipientKyc !== 1) {
    throw new Error(`ATS KYC required before lifecycle execution (issuer=${issuerKyc}, recipient=${recipientKyc})`);
  }
  console.log("   issuer KYC: granted; recipient KYC: granted");

  const mintAmount = 10n;
  console.log(`\n2. Mint ${mintAmount} to issuer`);
  await (await token.mint(wallet.address, mintAmount)).wait();
  console.log("   issuer balance:", (await token.balanceOf(wallet.address)).toString());

  console.log(`\n3. Compliance transfer 1 ${symbol} → recipient`);
  await (await token.transfer(recipient, 1n)).wait();
  console.log("   recipient balance:", (await token.balanceOf(recipient)).toString());

  console.log("\n4. Freeze recipient, assert transfer reverts, then unfreeze");
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

  console.log("\n5. Burn demo units to restore pre-demo balances");
  await (await token.burn(recipient, 1n)).wait();
  await (await token.burn(wallet.address, mintAmount - 1n)).wait();

  console.log("\nLifecycle demo complete — KYC, mint, transfer, freeze and burn exercised.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
