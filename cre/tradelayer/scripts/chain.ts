import { defineChain } from "viem";

/** A viem chain for whatever the workflow config points at — Anvil or Hedera testnet. */
export function chainFor(chainId: number, rpcUrl: string) {
  return defineChain({
    id: chainId,
    name: chainId === 296 ? "Hedera Testnet" : `chain-${chainId}`,
    nativeCurrency: chainId === 296 ? { name: "HBAR", symbol: "HBAR", decimals: 18 } : { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
    ...(chainId === 296 ? { blockExplorers: { default: { name: "HashScan", url: "https://hashscan.io/testnet" } } } : {}),
  });
}
