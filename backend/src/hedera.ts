import { Contract, JsonRpcProvider, Wallet } from "ethers";
import { config } from "./config";
import {
  COMPLIANCE_ROUTER_ABI,
  CONFIDENTIAL_LEDGER_ABI,
  OMNIBUS_VAULT_ABI,
  ORDER_ESCROW_ABI,
  ORG_REGISTRY_ABI,
} from "./abis";

// Hashio rejects eth_getFilterChanges inside JSON-RPC batches and is happiest with a pinned
// network, so batching is disabled and the network is static.
export const provider = new JsonRpcProvider(
  config.hedera.rpcUrl,
  { chainId: config.hedera.chainId, name: `chain-${config.hedera.chainId}` },
  { staticNetwork: true, batchMaxCount: 1 },
);

const pk = config.relayerPrivateKey.startsWith("0x") ? config.relayerPrivateKey : `0x${config.relayerPrivateKey}`;
export const relayerWallet = new Wallet(pk, provider);

export const escrow = new Contract(config.contracts.escrow, ORDER_ESCROW_ABI, relayerWallet);
export const ledger = new Contract(config.contracts.ledger, CONFIDENTIAL_LEDGER_ABI, relayerWallet);
export const vault = new Contract(config.contracts.vault, OMNIBUS_VAULT_ABI, relayerWallet);
export const registry = new Contract(config.contracts.registry, ORG_REGISTRY_ABI, provider);
export const router = new Contract(config.contracts.router, COMPLIANCE_ROUTER_ABI, provider);

export const contractByTarget = { escrow, ledger, vault } as const;
export const addressByTarget = {
  escrow: config.contracts.escrow,
  ledger: config.contracts.ledger,
  vault: config.contracts.vault,
} as const;
