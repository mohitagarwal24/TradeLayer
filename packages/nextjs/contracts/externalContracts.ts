import { GenericContractsDeclaration } from "~~/utils/scaffold-eth/contract";

/**
 * Real tokens/protocols that exist independently of our deployments.
 * Hedera testnet (296): Circle's native USDC, HTS token 0.0.429274,
 * surfaced at its long-zero EVM address by the JSON-RPC relay.
 */
const externalContracts = {
  296: {
    MockUSDC: {
      address: "0x0000000000000000000000000000000000068cDa",
      abi: [
        {
          type: "function",
          name: "balanceOf",
          stateMutability: "view",
          inputs: [{ name: "account", type: "address" }],
          outputs: [{ type: "uint256" }],
        },
        {
          type: "function",
          name: "allowance",
          stateMutability: "view",
          inputs: [
            { name: "owner", type: "address" },
            { name: "spender", type: "address" },
          ],
          outputs: [{ type: "uint256" }],
        },
        {
          type: "function",
          name: "approve",
          stateMutability: "nonpayable",
          inputs: [
            { name: "spender", type: "address" },
            { name: "amount", type: "uint256" },
          ],
          outputs: [{ type: "bool" }],
        },
        {
          type: "function",
          name: "transfer",
          stateMutability: "nonpayable",
          inputs: [
            { name: "to", type: "address" },
            { name: "amount", type: "uint256" },
          ],
          outputs: [{ type: "bool" }],
        },
      ] as const,
    },
  },
} as const;

export default externalContracts satisfies Partial<GenericContractsDeclaration>;
