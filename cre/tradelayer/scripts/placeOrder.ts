/**
 * Headless employee client — does exactly what the Trade screen does, so the whole flow can be
 * driven and tested without a browser.
 *
 *   bun scripts/placeOrder.ts [SYMBOL] [USD_AMOUNT]      e.g. placeOrder.ts TSLA 20
 *
 * 1. derive the portfolio key from a wallet signature over a fixed message
 * 2. build + EIP-712-sign the intent
 * 3. seal it to the enclave's public key (ECIES + AES-GCM)
 * 4. openBuy — the vault moves the institution's USDC into escrow against keccak256(ct‖tag).
 *    The employee approves nothing and spends nothing of their own.
 * 5. POST the sealed envelope to the intake API, which triggers H1 in the enclave
 * 6. poll until the escrow leaves OPEN
 *
 * Config comes from $CRE_CONFIG (default config/config.testnet.json); the signer from $EMPLOYEE_KEY.
 */
import { createPublicClient, createWalletClient, http, parseAbi, keccak256 as viemKeccak, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { chainFor } from "./chain";
import { randomBytes } from "@noble/hashes/utils";
const config = (await import(process.env.CRE_CONFIG ?? "../config/config.testnet.json")).default as {
  hedera: {
    chainId: number;
    rpcUrl: string;
    escrow: string;
    ledger: string;
    vault: string;
    registry: string;
    symbols: Record<string, string>;
  };
};
import {
  accountIdOf,
  bytes32ToText,
  bytes32,
  decryptUserBlob,
  envelopeCommit,
  fromHex,
  publicKeyOf,
  sealEnvelope,
  toHex,
  toValidPrivateKey,
  type Intent,
} from "../src/crypto";

const INTAKE = process.env.INTAKE_URL ?? "http://localhost:8000";
function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Set ${name}`);
  return v;
}
const EMPLOYEE_KEY = env("EMPLOYEE_KEY").replace(/^(?!0x)/, "0x") as Hex;
const PORTFOLIO_KEY_MESSAGE = "TradeLayer portfolio key v1";

const ERC20 = parseAbi(["function balanceOf(address owner) view returns (uint256)"]);
const ESCROW = parseAbi([
  "function openBuy(bytes32 orderId, uint256 maxSpend, bytes32 commit, uint64 expiry)",
  "function order(bytes32 orderId) view returns ((address requester, bytes32 accountId, bytes32 orgId, uint256 amount, bytes32 commit, uint64 expiry, uint8 status, address schedule))",
]);
const VAULT = parseAbi([
  "function available() view returns (uint256)",
  "function atsSupply(bytes32 symbol) view returns (uint256)",
]);
const REGISTRY = parseAbi(["function orgOf(address wallet) view returns (bytes32)"]);
const LEDGER = parseAbi([
  "function entry(bytes32 accountId) view returns ((bytes enclaveBlob, bytes userBlob, uint64 version, bytes32 blobHash))",
]);

const STATUS = ["NONE", "OPEN", "SETTLED", "CANCELLED", "REFUNDED"];
const log = (...a: unknown[]) => console.log(...a);

async function main() {
  const symbol = (process.argv[2] ?? "TSLA").toUpperCase();
  const usd = process.argv[3] ?? process.env.SPEND_USD ?? "20";
  const { hedera } = config;

  const account = privateKeyToAccount(EMPLOYEE_KEY);
  const transport = http(hedera.rpcUrl);
  const publicClient = createPublicClient({ chain: chainFor(hedera.chainId, hedera.rpcUrl), transport });
  const wallet = createWalletClient({ account, chain: chainFor(hedera.chainId, hedera.rpcUrl), transport });
  log(`employee      ${account.address}`);

  // 1. Portfolio key — deterministic from a wallet signature, never leaves this process.
  const walletSig = await account.signMessage({ message: PORTFOLIO_KEY_MESSAGE });
  const portfolioPriv = toValidPrivateKey(fromHex(viemKeccak(walletSig)));
  const userPubKey = toHex(publicKeyOf(portfolioPriv, true));
  log(`portfolio key ${userPubKey.slice(0, 20)}…`);

  // 2. Enclave public key.
  const enclave = (await (await fetch(`${INTAKE}/enclave-key`)).json()) as { intentPublicKey: Hex; chainId: number };
  log(`enclave key   ${enclave.intentPublicKey.slice(0, 20)}…`);

  // The wallet must belong to an institution — the escrow resolves this and refuses otherwise.
  const orgId = await publicClient.readContract({
    address: hedera.registry as Hex,
    abi: REGISTRY,
    functionName: "orgOf",
    args: [account.address],
  });
  if (/^0x0+$/.test(orgId)) throw new Error("this wallet has not joined an institution");
  const available = await publicClient.readContract({
    address: hedera.vault as Hex,
    abi: VAULT,
    functionName: "available",
  });
  log(`institution   ${bytes32ToText(fromHex(orgId))}  pool available ${Number(available) / 1e6} USDC`);

  // 3. Intent. maxSpend is padded over the expected fill so a moving market still settles.
  const nonce = Math.floor(Date.now() / 1000);
  const orderId = toHex(fromHex(viemKeccak(new TextEncoder().encode(`${account.address}:${nonce}:${Math.random()}`))));
  const expiry = nonce + 2 * 60 * 60;
  // Buying by amount: this is exactly what the broker will spend, so nothing needs padding.
  const [whole, frac = ""] = usd.split(".");
  const maxSpend = BigInt(whole) * 1_000_000n + BigInt((frac + "000000").slice(0, 6));
  if (maxSpend < 1_000_000n) throw new Error("the broker's minimum order is $1");
  if (available < maxSpend) throw new Error(`institution pool ${available} < ${maxSpend} requested`);

  const unsigned: Omit<Intent, "sig"> = {
    v: 1,
    orderId,
    account: account.address,
    orgId: bytes32ToText(fromHex(orgId)),
    side: "BUY",
    symbol,
    maxSpend: maxSpend.toString(),
    expiry,
    nonce,
    userPubKey,
  };
  const sig = await account.signTypedData({
    domain: { name: "TradeLayerIntent", version: "1", chainId: hedera.chainId, verifyingContract: hedera.escrow as Hex },
    types: {
      Intent: [
        { name: "orderId", type: "bytes32" },
        { name: "account", type: "address" },
        { name: "orgId", type: "bytes32" },
        { name: "side", type: "string" },
        { name: "symbol", type: "string" },
        { name: "maxSpend", type: "uint256" },
        { name: "expiry", type: "uint64" },
        { name: "nonce", type: "uint256" },
        { name: "userPubKey", type: "bytes" },
      ],
    },
    primaryType: "Intent",
    message: {
      orderId,
      account: account.address,
      orgId,
      side: "BUY",
      symbol,
      maxSpend,
      expiry: BigInt(expiry),
      nonce: BigInt(nonce),
      userPubKey,
    },
  });

  // 4. Seal. Only ciphertext ever leaves this process.
  const intent: Intent = { ...unsigned, sig: sig as Hex };
  const envelope = sealEnvelope(
    new TextEncoder().encode(JSON.stringify(intent)),
    fromHex(enclave.intentPublicKey),
    toValidPrivateKey(randomBytes(32)),
    randomBytes(12),
  );
  const commit = envelopeCommit(envelope);
  log(`\norder         ${orderId}`);
  log(`  sealed      $${usd} of ${symbol} → ciphertext ${envelope.ct.length}b, commit ${commit.slice(0, 18)}…`);
  log(`  on-chain    ${Number(maxSpend) / 1e6} USDC of the institution's money reserved until ${new Date(expiry * 1000).toLocaleTimeString()}`);

  // 5. Escrow. No approval: the funds come from the vault's pool, not this wallet.
  const openHash = await wallet.writeContract({
    address: hedera.escrow as Hex,
    abi: ESCROW,
    functionName: "openBuy",
    args: [orderId, maxSpend, commit, BigInt(expiry)],
  });
  await publicClient.waitForTransactionReceipt({ hash: openHash });
  log(`  openBuy     ${openHash.slice(0, 12)}…`);

  // 6. Hand the envelope to the intake API → H1 in the enclave.
  const res = await fetch(`${INTAKE}/orders`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ orderId, envelope }),
  });
  log(`  intake      ${res.status} ${JSON.stringify(await res.json())}`);

  // 7. Watch.
  log("\nwaiting for the enclave…");
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 3_000));
    const o = await publicClient.readContract({ address: hedera.escrow as Hex, abi: ESCROW, functionName: "order", args: [orderId] });
    const entry = await publicClient.readContract({
      address: hedera.ledger as Hex,
      abi: LEDGER,
      functionName: "entry",
      args: [toHex(accountIdOf(account.address))],
    });
    const supply = await publicClient.readContract({ address: hedera.vault as Hex, abi: VAULT, functionName: "atsSupply", args: [toHex(bytes32(symbol))] });
    log(`  [${String(i * 3).padStart(3)}s] escrow=${STATUS[Number(o.status)]} ledger=v${entry.version} ats=${supply}`);

    if (entry.version > 0n && entry.userBlob !== "0x") {
      const p = JSON.parse(new TextDecoder().decode(decryptUserBlob(portfolioPriv, fromHex(entry.userBlob))));
      log(`         private portfolio: positions=${JSON.stringify(p.positions)} open=${Object.keys(p.openOrders).length}`);
    }
    if (Number(o.status) !== 1) {
      log(`\nterminal: ${STATUS[Number(o.status)]}`);
      return;
    }
  }
  log("\nstill OPEN after 120s — run H2 (trigger-index 1) to reconcile the fill.");
}

main().catch(e => {
  console.error("FAILED:", e.shortMessage ?? e.message ?? e);
  process.exit(1);
});
