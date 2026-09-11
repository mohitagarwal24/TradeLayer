/**
 * What the world can see, versus what the employee can see.
 *
 *   bun scripts/status.ts
 *
 * Prints the public on-chain state (escrow, balances, supplies, ciphertext versions) and then
 * decrypts the employee's own portfolio copy with the key their wallet derives — demonstrating
 * that positions are readable by exactly one party and nobody else.
 */
import { createPublicClient, http, parseAbi, keccak256 as viemKeccak, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { chainFor } from "./chain";
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
import { accountIdOf, bytes32, decryptUserBlob, fromHex, toHex, toValidPrivateKey, unitsToShares } from "../src/crypto";

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Set ${name}`);
  return v;
}
const EMPLOYEE_KEY = env("EMPLOYEE_KEY").replace(/^(?!0x)/, "0x") as Hex;
const PORTFOLIO_KEY_MESSAGE = "TradeLayer portfolio key v1";

const ERC20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
]);
const VAULT = parseAbi([
  "function atsToken(bytes32) view returns (address)",
  "function atsSupply(bytes32) view returns (uint256)",
  "function reserve() view returns (uint256)",
  "function available() view returns (uint256)",
  "function committed() view returns (uint256)",
]);
const REGISTRY = parseAbi(["function orgOf(address) view returns (bytes32)"]);
const LEDGER = parseAbi([
  "function entry(bytes32) view returns ((bytes enclaveBlob, bytes userBlob, uint64 version, bytes32 blobHash))",
]);
const ESCROW = parseAbi(["function openCount() view returns (uint256)"]);

const usd = (v: bigint) => (Number(v) / 1e6).toFixed(2);

async function main() {
  const { hedera } = config;
  const client = createPublicClient({ chain: chainFor(hedera.chainId, hedera.rpcUrl), transport: http(hedera.rpcUrl) });
  const account = privateKeyToAccount(EMPLOYEE_KEY);
  const read = <T>(address: Hex, abi: never, functionName: string, args: unknown[] = []) =>
    client.readContract({ address, abi, functionName, args } as never) as Promise<T>;

  console.log("\n=== PUBLIC — what any observer sees =========================================");
  console.log(`  omnibus reserve        ${usd(await read<bigint>(hedera.vault as Hex, VAULT as never, "reserve"))} USDC`);
  console.log(`  …of which committed    ${usd(await read<bigint>(hedera.vault as Hex, VAULT as never, "committed"))} USDC`);
  console.log(`  → one pool. No public field says which institution owns any of it.`);
  console.log(`  this wallet's institution ${await read<Hex>(hedera.registry as Hex, REGISTRY as never, "orgOf", [account.address])}`);
  console.log(`  open escrows           ${await read<bigint>(hedera.escrow as Hex, ESCROW as never, "openCount")}`);
  for (const symbol of Object.keys(hedera.symbols)) {
    const token = await read<Hex>(hedera.vault as Hex, VAULT as never, "atsToken", [toHex(bytes32(symbol))]);
    const supply = await read<bigint>(hedera.vault as Hex, VAULT as never, "atsSupply", [toHex(bytes32(symbol))]);
    const held = await read<bigint>(token, ERC20 as never, "balanceOf", [hedera.vault as Hex]);
    console.log(`  ${(symbol + "-t").padEnd(8)}              supply ${supply}, vault holds ${held}`);
  }

  const accountId = toHex(accountIdOf(account.address));
  const entry = await read<{ enclaveBlob: Hex; userBlob: Hex; version: bigint; blobHash: Hex }>(
    hedera.ledger as Hex,
    LEDGER as never,
    "entry",
    [accountId],
  );
  console.log(`  ledger entry           v${entry.version}, ${(entry.enclaveBlob.length - 2) / 2} bytes of ciphertext`);
  console.log(`  → symbol, quantity, price, position: NOT VISIBLE ANYWHERE ABOVE`);

  console.log("\n=== PRIVATE — only this employee's wallet can decrypt =======================");
  if (entry.version === 0n || entry.userBlob === "0x") {
    console.log("  (no entry yet)");
  } else {
    const walletSig = await account.signMessage({ message: PORTFOLIO_KEY_MESSAGE });
    const priv = toValidPrivateKey(fromHex(viemKeccak(walletSig)));
    const p = JSON.parse(new TextDecoder().decode(decryptUserBlob(priv, fromHex(entry.userBlob))));
    console.log(`  positions              ${JSON.stringify(Object.fromEntries(Object.entries(p.positions).map(([k, v]) => [k, unitsToShares(BigInt((v as {qty:string}).qty))])))}`);
    console.log(`  open orders            ${Object.keys(p.openOrders).length}`);
    console.log(`  private cash           ${usd(BigInt(p.cash))} USDC`);

    const stranger = toValidPrivateKey(fromHex(viemKeccak(new TextEncoder().encode("not the employee"))));
    try {
      decryptUserBlob(stranger, fromHex(entry.userBlob));
      console.log("  stranger decrypt       ⚠ SUCCEEDED — this must never happen");
    } catch {
      console.log("  stranger decrypt       correctly rejected");
    }
  }
  console.log();
}

main().catch(e => {
  console.error("FAILED:", e.shortMessage ?? e.message ?? e);
  process.exit(1);
});
