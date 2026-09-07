/**
 * One-time HTS USDC token association for an account that will pay or receive
 * x402 payments. Hedera accounts must be associated with an HTS token before
 * it can be transferred to them (native HBAR needs no association).
 *
 * Env:
 *   HEDERA_ACCOUNT_ID    account to associate (0.0.x)
 *   HEDERA_PRIVATE_KEY   ECDSA private key for that account
 *   USDC_TOKEN_ID        default 0.0.429274 (Circle testnet USDC)
 *
 * Usage:
 *   cd backend && npx tsx scripts/associateUsdc.ts
 */
import "dotenv/config";
import { Hbar, TokenAssociateTransaction, AccountId, Client, PrivateKey } from "@hashgraph/sdk";

const USDC_TOKEN_ID = process.env.USDC_TOKEN_ID || "0.0.429274";

async function main() {
  const accountId = process.env.ASSOCIATE_ACCOUNT_ID ?? process.env.HEDERA_ACCOUNT_ID;
  const privateKey = process.env.ASSOCIATE_PRIVATE_KEY ?? process.env.HEDERA_PRIVATE_KEY;
  if (!accountId || !privateKey) {
    throw new Error("Set ASSOCIATE_ACCOUNT_ID and ASSOCIATE_PRIVATE_KEY");
  }

  const client = Client.forTestnet().setOperator(
    AccountId.fromString(accountId),
    PrivateKey.fromStringECDSA(privateKey),
  );
  client.setDefaultMaxTransactionFee(new Hbar(2));

  const tx = await new TokenAssociateTransaction()
    .setAccountId(AccountId.fromString(accountId))
    .setTokenIds([USDC_TOKEN_ID])
    .execute(client);
  const receipt = await tx.getReceipt(client);

  console.log(`Associated ${accountId} with HTS USDC ${USDC_TOKEN_ID}`);
  console.log("status:", receipt.status.toString());
  client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
