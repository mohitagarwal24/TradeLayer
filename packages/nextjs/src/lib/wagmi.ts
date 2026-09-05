import { http, createConfig } from "wagmi";
import { foundry } from "wagmi/chains";
import { injected } from "wagmi/connectors";
import { hederaTestnet } from "~~/scaffold.config";

const targetNetworks = [foundry, hederaTestnet] as const;

export const config = createConfig({
  chains: targetNetworks,
  connectors: [injected()],
  transports: {
    [foundry.id]: http("http://127.0.0.1:8545"),
    [hederaTestnet.id]: http("https://testnet.hashio.io/api"),
  },
});

export { targetNetworks };
