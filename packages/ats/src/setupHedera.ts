/**
 * Post-deploy setup on Hedera testnet — the steps that touch the HTS system contract at `0x167`,
 * which `forge script` cannot broadcast because it simulates against a local EVM where that
 * precompile does not exist.
 *
 *   yarn ats:setup-hedera
 *
 * Associates the vault and the escrow with USDC so they can hold it. That is all: TradeLayer
 * issues no HTS token of its own. Settlement is Circle's USDC used as-is — we hold no keys over
 * it, and who may trade is decided by OrgWalletRegistry plus the enclave's private policy, never
 * by holding or lacking a token of ours.
 *
 * Env (packages/ats/.env): PRIVATE_KEY (owner of the vault and escrow), OMNIBUS_VAULT,
 * ORDER_ESCROW, optional RPC_URL and USDC.
 */
import "dotenv/config";
import { Contract, JsonRpcProvider, Wallet } from "ethers";

const RPC = process.env.RPC_URL ?? "https://testnet.hashio.io/api";
/** Circle's native USDC on Hedera testnet (HTS 0.0.429274) at its long-zero EVM address. */
const USDC = process.env.USDC ?? "0x0000000000000000000000000000000000068cDa";

const VAULT_ABI = [
  "function associate(address token)",
  "function owner() view returns (address)",
  "function escrow() view returns (address)",
  "function enclaveSigner() view returns (address)",
  "function reserve() view returns (uint256)",
];
const ESCROW_ABI = ["function associate(address token)", "function owner() view returns (address)"];
/** HIP-719: every HTS token address exposes `associate()` so an account can associate itself. */
const HRC719_ABI = ["function associate() returns (uint256)"];

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Set ${name} in packages/ats/.env`);
  return v;
}

async function main() {
  const provider = new JsonRpcProvider(RPC, { chainId: 296, name: "hedera-testnet" }, { staticNetwork: true, batchMaxCount: 1 });
  const wallet = new Wallet(env("PRIVATE_KEY").replace(/^(?!0x)/, "0x"), provider);
  const vault = new Contract(env("OMNIBUS_VAULT"), VAULT_ABI, wallet);
  const escrow = new Contract(env("ORDER_ESCROW"), ESCROW_ABI, wallet);

  console.log(`operator  ${wallet.address}`);
  console.log(`vault     ${await vault.getAddress()}  owner ${await vault.owner()}`);
  console.log(`escrow    ${await escrow.getAddress()}  linked ${await vault.escrow()}`);
  console.log(`enclave   ${await vault.enclaveSigner()}`);
  console.log(`usdc      ${USDC}\n`);

  const send = async (label: string, fn: () => Promise<{ hash: string; wait: () => Promise<unknown> }>) => {
    process.stdout.write(`  ${label.padEnd(34)}`);
    try {
      const tx = await fn();
      await tx.wait();
      console.log(`ok  ${tx.hash}`);
    } catch (error) {
      console.log(`FAILED  ${(error as Error).message.slice(0, 160)}`);
    }
  };

  await send("associate vault ↔ USDC", () => vault.associate(USDC, { gasLimit: 1_000_000 }));
  await send("associate escrow ↔ USDC", () => escrow.associate(USDC, { gasLimit: 1_000_000 }));
  // Whoever funds an institution needs to be associated too, or the transfer in will fail.
  await send("associate operator ↔ USDC", () =>
    new Contract(USDC, HRC719_ABI, wallet).associate({ gasLimit: 1_000_000 }),
  );

  console.log(`\nvault reserve: ${await vault.reserve()}`);
  console.log("Next: yarn ats:grant-router-roles  (ATS roles for the vault and the router)");
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
