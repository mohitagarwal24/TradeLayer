import * as chains from "viem/chains";
import scaffoldConfig from "~~/scaffold.config";

type ChainAttributes = {
  // color | [lightThemeColor, darkThemeColor]
  color: string | [string, string];
  // Used to fetch price by providing mainnet token address
  // for networks having native currency other than ETH
  nativeCurrencyTokenAddress?: string;
};

export type ChainWithAttributes = chains.Chain & Partial<ChainAttributes>;
export type AllowedChainIds = (typeof scaffoldConfig.targetNetworks)[number]["id"];

export const NETWORKS_EXTRA_DATA: Record<string, ChainAttributes> = {
  // foundry and hardhat share chain id 31337
  [chains.foundry.id]: {
    color: "#b8af0c",
  },
  [chains.mainnet.id]: {
    color: "#ff8b9e",
  },
  [chains.sepolia.id]: {
    color: ["#5f4bb6", "#87ff65"],
  },
  [chains.base.id]: {
    color: "#0052ff",
  },
  [chains.baseSepolia.id]: {
    color: "#0052ff",
  },
  [chains.optimism.id]: {
    color: "#f01a37",
  },
  [chains.arbitrum.id]: {
    color: "#28a0f0",
  },
};

/**
 * Gives the block explorer transaction URL. HashScan for Hedera chains,
 * empty string if the network has no explorer.
 */
export function getBlockExplorerTxLink(chainId: number, txnHash: string) {
  if (chainId === HEDERA_TESTNET_ID || chainId === HEDERA_MAINNET_ID) {
    return `https://hashscan.io/${chainId === HEDERA_TESTNET_ID ? "testnet" : "mainnet"}/transaction/${txnHash}`;
  }

  const chainNames = Object.keys(chains) as (keyof typeof chains)[];
  const targetChain = chainNames.find(chainName => chains[chainName].id === chainId);
  const blockExplorerTxURL = targetChain ? chains[targetChain]?.blockExplorers?.default?.url : undefined;

  if (!blockExplorerTxURL) {
    return "";
  }

  return `${blockExplorerTxURL}/tx/${txnHash}`;
}

/** Hedera chain ids (the JSON-RPC relay exposes Hedera as an EVM network). */
export const HEDERA_TESTNET_ID = 296;
export const HEDERA_MAINNET_ID = 295;

/**
 * @returns the first targetNetwork from scaffold.config including extra network metadata.
 */
export function getTargetNetwork(): ChainWithAttributes {
  const targetNetwork = scaffoldConfig.targetNetworks[0];
  return { ...targetNetwork, ...NETWORKS_EXTRA_DATA[targetNetwork.id] };
}

/**
 * @returns targetNetworks array containing networks configured in scaffold.config including extra network metadata
 */
export function getTargetNetworks(): ChainWithAttributes[] {
  return scaffoldConfig.targetNetworks.map(targetNetwork => ({
    ...targetNetwork,
    ...NETWORKS_EXTRA_DATA[targetNetwork.id],
  }));
}
