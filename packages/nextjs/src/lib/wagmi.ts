import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { defineChain } from "viem";

/**
 * Hedera testnet only. The local dev chain used to appear in the network picker, which meant a
 * user could select a network the app could not actually settle on.
 */
export const hederaTestnet = defineChain({
  id: 296,
  name: "Hedera Testnet",
  nativeCurrency: { name: "HBAR", symbol: "HBAR", decimals: 18 },
  rpcUrls: { default: { http: ["https://testnet.hashio.io/api"] } },
  blockExplorers: { default: { name: "HashScan", url: "https://hashscan.io/testnet" } },
  testnet: true,
});

export const config = createConfig({
  chains: [hederaTestnet],
  connectors: [injected()],
  transports: { [hederaTestnet.id]: http("https://testnet.hashio.io/api", { batch: false }) },
});
