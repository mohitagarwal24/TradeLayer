import "dotenv/config";
import { AccountId, Client, PrivateKey, TopicCreateTransaction } from "@hashgraph/sdk";

async function main() {
  const accountId = process.env.HCS_OPERATOR_ACCOUNT_ID ?? process.env.HEDERA_ACCOUNT_ID;
  const privateKey = process.env.HCS_OPERATOR_PRIVATE_KEY ?? process.env.HEDERA_PRIVATE_KEY;
  if (!accountId || !privateKey) throw new Error("Set HCS_OPERATOR_ACCOUNT_ID and HCS_OPERATOR_PRIVATE_KEY");

  const client = Client.forTestnet().setOperator(
    AccountId.fromString(accountId),
    PrivateKey.fromStringECDSA(privateKey),
  );
  try {
    const response = await new TopicCreateTransaction()
      .setTopicMemo("TradeLayer x402 payment audit receipts")
      .execute(client);
    const receipt = await response.getReceipt(client);
    if (!receipt.topicId) throw new Error("Hedera returned no topic ID");
    console.log(receipt.topicId.toString());
  } finally {
    client.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
